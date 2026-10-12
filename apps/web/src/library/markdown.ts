/**
 * Leitor do subconjunto de Markdown usado nas páginas da Biblioteca. Propositalmente pequeno: nada de
 * HTML, imagens ou listas aninhadas — o texto vira estrutura e o React desenha (sem innerHTML).
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'b'; c: Inline[] }
  | { t: 'i'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] };

export type Block =
  | { t: 'h2' | 'h3'; text: string; id: string }
  | { t: 'p'; text: string }
  | { t: 'ul' | 'ol'; items: string[] }
  | { t: 'quote'; paras: string[] }
  | { t: 'table'; head: string[]; rows: string[][] }
  | { t: 'marker'; name: string };

export interface PageMeta {
  titulo: string;
  categoria: string;
  resumo: string;
  relacionados: string[];
}

export interface ParsedPage {
  meta: PageMeta;
  blocks: Block[];
}

/** "Regras exatas no Radar" → "regras-exatas-no-radar" (âncoras dos títulos). */
export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function parseFrontmatter(raw: string): { fields: Record<string, string>; body: string } {
  const text = raw.replace(/\r\n?/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { fields: {}, body: text };
  const fields: Record<string, string> = {};
  for (const line of m[1]!.split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { fields, body: text.slice(m[0].length) };
}

const RE_UL = /^\s{0,1}[-*]\s+(.*)$/;
const RE_OL = /^\s{0,1}\d+[.)]\s+(.*)$/;
const RE_MARKER = /^\[\[([a-z-]+)\]\]$/;
const RE_TABLE_SEP = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/;

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

export function parseBlocks(body: string): Block[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let i = 0;
  const isStart = (l: string) =>
    l.startsWith('## ') ||
    l.startsWith('### ') ||
    l.startsWith('>') ||
    l.startsWith('|') ||
    RE_UL.test(l) ||
    RE_OL.test(l) ||
    RE_MARKER.test(l.trim());

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!trimmed) {
      i++;
      continue;
    }
    if (line.startsWith('### ') || line.startsWith('## ')) {
      const level = line.startsWith('### ') ? 'h3' : 'h2';
      const text = line.replace(/^#+\s+/, '').trim();
      out.push({ t: level, text, id: slugify(text) });
      i++;
      continue;
    }
    const marker = RE_MARKER.exec(trimmed);
    if (marker) {
      out.push({ t: 'marker', name: marker[1]! });
      i++;
      continue;
    }
    if (line.startsWith('>')) {
      const paras: string[] = [];
      let cur: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('>')) {
        const content = lines[i]!.replace(/^>\s?/, '').trim();
        if (content) cur.push(content);
        else if (cur.length) {
          paras.push(cur.join(' '));
          cur = [];
        }
        i++;
      }
      if (cur.length) paras.push(cur.join(' '));
      out.push({ t: 'quote', paras });
      continue;
    }
    if (line.startsWith('|') && i + 1 < lines.length && RE_TABLE_SEP.test(lines[i + 1]!.trim())) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('|')) {
        rows.push(cells(lines[i]!));
        i++;
      }
      out.push({ t: 'table', head, rows });
      continue;
    }
    const listRe = RE_UL.test(line) ? RE_UL : RE_OL.test(line) ? RE_OL : null;
    if (listRe) {
      const items: string[] = [];
      while (i < lines.length) {
        const l = lines[i]!;
        const m = listRe.exec(l);
        if (m) {
          items.push(m[1]!.trim());
        } else if (l.trim() && /^\s{2,}/.test(l) && items.length) {
          // continuação do item anterior (linha indentada)
          items[items.length - 1] += ' ' + l.trim();
        } else break;
        i++;
      }
      out.push({ t: listRe === RE_UL ? 'ul' : 'ol', items });
      continue;
    }
    // parágrafo: junta linhas até uma linha em branco ou início de outro bloco
    const para: string[] = [trimmed];
    i++;
    while (i < lines.length && lines[i]!.trim() && !isStart(lines[i]!)) {
      para.push(lines[i]!.trim());
      i++;
    }
    out.push({ t: 'p', text: para.join(' ') });
  }
  return out;
}

/** Só links internos da Biblioteca/app ou https. Qualquer outra coisa (javascript:, data:) vira texto. */
export function safeHref(href: string): string | null {
  if (/^\/[a-z0-9/_#?=&-]*$/i.test(href)) return href;
  if (/^https:\/\/[^\s"'<>]+$/i.test(href)) return href;
  return null;
}

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ t: 'text', v: buf });
    buf = '';
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > i) {
        flush();
        out.push({ t: 'code', v: s.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (ch === '*' && s[i + 1] === '*') {
      const end = s.indexOf('**', i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: 'b', c: parseInline(s.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (ch === '*' && s[i + 1] !== ' ' && s[i + 1] !== undefined) {
      const end = s.indexOf('*', i + 1);
      if (end > i + 1 && s[end - 1] !== ' ') {
        flush();
        out.push({ t: 'i', c: parseInline(s.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (ch === '[') {
      const m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(s.slice(i));
      if (m) {
        flush();
        const href = safeHref(m[2]!);
        if (href) out.push({ t: 'link', href, c: parseInline(m[1]!) });
        else out.push({ t: 'text', v: m[1]! });
        i += m[0].length;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

export function parsePage(raw: string): ParsedPage {
  const { fields, body } = parseFrontmatter(raw);
  return {
    meta: {
      titulo: fields.titulo ?? '',
      categoria: fields.categoria ?? '',
      resumo: fields.resumo ?? '',
      relacionados: (fields.relacionados ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    },
    blocks: parseBlocks(body),
  };
}

/** Todos os links (internos e externos) de uma página, para validação. */
export function collectLinks(blocks: Block[]): string[] {
  const texts: string[] = [];
  for (const b of blocks) {
    if (b.t === 'p') texts.push(b.text);
    else if (b.t === 'ul' || b.t === 'ol') texts.push(...b.items);
    else if (b.t === 'quote') texts.push(...b.paras);
    else if (b.t === 'table') texts.push(...b.head, ...b.rows.flat());
  }
  const links: string[] = [];
  const walk = (xs: Inline[]) => {
    for (const x of xs) {
      if (x.t === 'link') {
        links.push(x.href);
        walk(x.c);
      } else if (x.t === 'b' || x.t === 'i') walk(x.c);
    }
  };
  for (const t of texts) walk(parseInline(t));
  return links;
}
