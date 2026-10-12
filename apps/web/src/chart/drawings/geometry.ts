import type { DrawingData } from '@radar/shared';

/** Geometria em pixels (pura, testável). */
export interface P {
  x: number;
  y: number;
}

export function distToSegment(p: P, a: P, b: P): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Prolonga o segmento a→b até a borda direita (raio). */
export function extendRay(a: P, b: P, width: number): P {
  if (b.x === a.x) return { x: b.x, y: b.y > a.y ? 1e6 : -1e6 };
  const m = (b.y - a.y) / (b.x - a.x);
  const x = b.x >= a.x ? width : 0;
  return { x, y: a.y + m * (x - a.x) };
}

/** Preço da linha p1→p2 no instante/posição x (interpolação linear), para o canal paralelo. */
export function lineAt(a: P, b: P, x: number): number {
  if (b.x === a.x) return a.y;
  return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
}

/** Preço de cada nível de Fibonacci: nível 0 em p2, 1 em p1 (retração a partir do fim do movimento). */
export function fibPrice(p1Price: number, p2Price: number, level: number): number {
  return p2Price - (p2Price - p1Price) * level;
}

/** Alvo padrão da ferramenta de posição: 2R a partir da entrada (SPEC: alvo mínimo de 2R). */
export function defaultTarget(entry: number, stop: number, r = 2): number {
  return entry + (entry - stop) * r;
}

export interface Projected {
  /** Pontos de definição já em pixels. */
  pts: P[];
  width: number;
  height: number;
}

const TOL = 6;

/**
 * Testa se o ponteiro está sobre o desenho. Retorna o índice da alça (ponto) tocada, 'body' para o
 * corpo, ou null. Alças têm prioridade (para arrastar pontos).
 */
export function hitTest(
  data: DrawingData,
  pr: Projected,
  p: P,
  handleRadius = 9,
): number | 'body' | null {
  const { pts, width, height } = pr;
  for (let i = 0; i < pts.length; i++) {
    const h = pts[i] as P;
    if (Math.hypot(h.x - p.x, h.y - p.y) <= handleRadius) return i;
  }
  const [a, b, c] = pts as [P, P | undefined, P | undefined];
  switch (data.kind) {
    case 'hline':
      return Math.abs(p.y - a.y) <= TOL ? 'body' : null;
    case 'vline':
      return Math.abs(p.x - a.x) <= TOL ? 'body' : null;
    case 'trend':
    case 'ruler':
      return b && distToSegment(p, a, b) <= TOL ? 'body' : null;
    case 'ray':
      return b && distToSegment(p, a, extendRay(a, b, width)) <= TOL ? 'body' : null;
    case 'zone': {
      if (!b) return null;
      const x1 = Math.min(a.x, b.x);
      const x2 = data.extendRight ? width : Math.max(a.x, b.x);
      const y1 = Math.min(a.y, b.y);
      const y2 = Math.max(a.y, b.y);
      return p.x >= x1 - TOL && p.x <= x2 + TOL && p.y >= y1 - TOL && p.y <= y2 + TOL
        ? 'body'
        : null;
    }
    case 'channel': {
      if (!b || !c) return null;
      if (distToSegment(p, a, b) <= TOL) return 'body';
      const off = c.y - lineAt(a, b, c.x);
      return distToSegment(p, { x: a.x, y: a.y + off }, { x: b.x, y: b.y + off }) <= TOL
        ? 'body'
        : null;
    }
    case 'fib': {
      if (!b) return null;
      const x1 = Math.min(a.x, b.x);
      const x2 = width;
      if (p.x < x1 - TOL || p.x > x2) return null;
      for (const lv of data.levels) {
        const y = a.y === b.y ? a.y : b.y - (b.y - a.y) * lv;
        if (Math.abs(p.y - y) <= TOL) return 'body';
      }
      return null;
    }
    case 'position': {
      if (!b || pts.length < 3) return null;
      const t = pts[2] as P; // alvo projetado
      const x1 = Math.min(a.x, b.x);
      const x2 = Math.max(a.x, b.x);
      const y1 = Math.min(a.y, b.y, t.y);
      const y2 = Math.max(a.y, b.y, t.y);
      return p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2 ? 'body' : null;
    }
    case 'text':
      return Math.abs(p.x - a.x - 40) <= 50 && Math.abs(p.y - a.y) <= 12 ? 'body' : null;
  }
  void height;
  return null;
}
