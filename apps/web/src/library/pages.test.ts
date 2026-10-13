import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CATEGORIES, LIBRARY_GROUPS, LIBRARY_SLUGS } from './catalog';
import { collectLinks, parseInline, parsePage, type Inline } from './markdown';
import { rawPages } from './pages';

describe('páginas da Biblioteca', () => {
  const pages = rawPages();
  const dataSources = readFileSync(
    new URL('../../../../docs/DATA_SOURCES.md', import.meta.url),
    'utf8',
  );

  it('cada slug da lista mestre tem página e cada página está na lista', () => {
    const files = Object.keys(pages).sort();
    expect(files).toEqual([...LIBRARY_SLUGS].sort());
    expect(new Set(LIBRARY_SLUGS).size).toBe(LIBRARY_SLUGS.length);
    expect(LIBRARY_GROUPS.length).toBeGreaterThan(0);
  });

  for (const [slug, raw] of Object.entries(pages)) {
    describe(slug, () => {
      const p = parsePage(raw);
      it('cabeçalho válido', () => {
        expect(p.meta.titulo.length).toBeGreaterThan(0);
        expect(CATEGORIES).toContain(p.meta.categoria);
        expect(p.meta.resumo.length).toBeGreaterThan(0);
        expect(p.meta.resumo.length).toBeLessThanOrEqual(200);
        for (const r of p.meta.relacionados) expect(LIBRARY_SLUGS).toContain(r);
      });
      it('só usa a sintaxe permitida', () => {
        const body = raw.replace(/^---[\s\S]*?\n---\n/, '');
        expect(body).not.toMatch(/^# /m);
        expect(body).not.toMatch(/<[a-zA-Z!/]/);
        expect(body).not.toMatch(/!\[/);
        for (const b of p.blocks) {
          if (b.t === 'marker') expect(['laboratorio', 'cdi']).toContain(b.name);
        }
        // nenhum ** ou ` sobrando (marcação desbalanceada)
        const texts: string[] = [];
        for (const b of p.blocks) {
          if (b.t === 'p') texts.push(b.text);
          else if (b.t === 'ul' || b.t === 'ol') texts.push(...b.items);
          else if (b.t === 'quote') texts.push(...b.paras);
        }
        const leftovers = (xs: Inline[]): string[] =>
          xs.flatMap((x) =>
            x.t === 'text' ? (/\*\*|`/.test(x.v) ? [x.v] : []) : 'c' in x ? leftovers(x.c) : [],
          );
        expect(texts.flatMap((t) => leftovers(parseInline(t)))).toEqual([]);
      });
      it('links apontam para páginas existentes ou fontes registradas', () => {
        for (const href of collectLinks(p.blocks)) {
          if (href.startsWith('/biblioteca/')) {
            const target = href.slice('/biblioteca/'.length).split('#')[0]!;
            expect(LIBRARY_SLUGS, `${slug} → ${href}`).toContain(target);
          } else if (href.startsWith('https://')) {
            const host = new URL(href).host;
            expect(dataSources.includes(host), `${slug}: ${host} não está em DATA_SOURCES.md`).toBe(
              true,
            );
          } else {
            expect(href, `${slug}: rota interna`).toMatch(
              /^\/(grafico|fontes|sobre|listas|setups\/parametros|diario|calculadora)/,
            );
          }
        }
      });
      if (p.meta.categoria === 'setup' || p.meta.categoria === 'indicador') {
        it('tem as seções obrigatórias (SPEC §16)', () => {
          const h2 = p.blocks.filter((b) => b.t === 'h2').map((b) => (b.t === 'h2' ? b.text : ''));
          expect(h2.some((t) => /regras exatas/i.test(t))).toBe(true);
          expect(h2.some((t) => /cr[ií]ticas/i.test(t))).toBe(true);
          expect(h2.some((t) => /quando (falha|engana)/i.test(t))).toBe(true);
          if (p.meta.categoria === 'setup') {
            expect(h2.some((t) => /lacunas/i.test(t))).toBe(true);
            expect(p.blocks.some((b) => b.t === 'marker' && b.name === 'laboratorio')).toBe(true);
          }
        });
      }
    });
  }
});
