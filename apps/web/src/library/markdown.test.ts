import { describe, expect, it } from 'vitest';
import { parseBlocks, parseInline, parsePage, safeHref } from './markdown';

describe('markdown da Biblioteca', () => {
  it('lê cabeçalho, títulos, listas, tabela, aviso e marcadores', () => {
    const p = parsePage(
      [
        '---',
        'titulo: Teste',
        'categoria: conceito',
        'resumo: Uma frase.',
        'relacionados: adx, volume',
        '---',
        '## O que é',
        'Linha um',
        'linha dois.',
        '',
        '- item A',
        '  continua',
        '- item B',
        '',
        '1. primeiro',
        '2. segundo',
        '',
        '> Atenção: risco.',
        '>',
        '> Segundo parágrafo.',
        '',
        '| ADX | Leitura |',
        '|---|---|',
        '| < 20 | lateral |',
        '',
        '[[laboratorio]]',
        '### Detalhe',
      ].join('\n'),
    );
    expect(p.meta).toEqual({
      titulo: 'Teste',
      categoria: 'conceito',
      resumo: 'Uma frase.',
      relacionados: ['adx', 'volume'],
    });
    expect(p.blocks.map((b) => b.t)).toEqual([
      'h2',
      'p',
      'ul',
      'ol',
      'quote',
      'table',
      'marker',
      'h3',
    ]);
    expect(p.blocks[0]).toEqual({ t: 'h2', text: 'O que é', id: 'o-que-e' });
    expect(p.blocks[1]).toEqual({ t: 'p', text: 'Linha um linha dois.' });
    expect(p.blocks[2]).toEqual({ t: 'ul', items: ['item A continua', 'item B'] });
    expect(p.blocks[4]).toEqual({ t: 'quote', paras: ['Atenção: risco.', 'Segundo parágrafo.'] });
    expect(p.blocks[5]).toEqual({
      t: 'table',
      head: ['ADX', 'Leitura'],
      rows: [['< 20', 'lateral']],
    });
  });

  it('inline: negrito, itálico, código e links seguros', () => {
    expect(parseInline('a **b *c* d** `d` [e](/biblioteca/adx)')).toEqual([
      { t: 'text', v: 'a ' },
      {
        t: 'b',
        c: [
          { t: 'text', v: 'b ' },
          { t: 'i', c: [{ t: 'text', v: 'c' }] },
          { t: 'text', v: ' d' },
        ],
      },
      { t: 'text', v: ' ' },
      { t: 'code', v: 'd' },
      { t: 'text', v: ' ' },
      { t: 'link', href: '/biblioteca/adx', c: [{ t: 'text', v: 'e' }] },
    ]);
    // link perigoso vira texto
    expect(parseInline('[x](javascript:alert(1))')[0]).toEqual({ t: 'text', v: 'x' });
    expect(safeHref('data:text/html,1')).toBeNull();
    expect(safeHref('https://www.bcb.gov.br/')).toBe('https://www.bcb.gov.br/');
    // multiplicação com asterisco solto não vira itálico
    expect(parseInline('2 * 3 = 6')).toEqual([{ t: 'text', v: '2 * 3 = 6' }]);
  });

  it('parágrafo termina quando começa uma lista', () => {
    expect(parseBlocks('Texto\n- a\n- b').map((b) => b.t)).toEqual(['p', 'ul']);
  });
});
