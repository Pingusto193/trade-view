import { formatNumber } from '@radar/shared';

/**
 * Mini-gráfico (SVG, sem biblioteca) dos últimos fechamentos, no papel de "tendência" de um cartão:
 * linha na cor de fundo (cinza de baixa ênfase) e o último fechamento em destaque (cor de acento).
 * A direção não depende da cor: o texto ao lado traz a variação com sinal.
 * Cores conferidas com o validador de paletas no fundo #111827 (contraste ≥ 3:1, separação para
 * daltonismo ΔE ≥ 20).
 */
export const SPARK_LINE = '#64748b';
export const SPARK_NOW = '#38bdf8';
const SURFACE = '#111827';

export interface SparkGeometry {
  d: string;
  last: { x: number; y: number } | null;
}

/** Caminho da linha dentro de w × h com folga `pad` (série plana fica no meio). */
export function sparkPath(values: readonly number[], w: number, h: number, pad = 4): SparkGeometry {
  const v = values.filter(Number.isFinite);
  if (v.length < 2) return { d: '', last: null };
  const min = Math.min(...v);
  const max = Math.max(...v);
  const span = max - min;
  const x = (i: number) => pad + (i * (w - 2 * pad)) / (v.length - 1);
  const y = (val: number) => (span > 0 ? pad + ((max - val) * (h - 2 * pad)) / span : h / 2);
  const pts = v.map((val, i) => `${x(i).toFixed(1)},${y(val).toFixed(1)}`);
  return {
    d: `M${pts.join(' L')}`,
    last: { x: x(v.length - 1), y: y(v[v.length - 1]!) },
  };
}

export function Sparkline({
  values,
  decimals = 2,
  width = 112,
  height = 36,
}: {
  values: readonly number[];
  decimals?: number;
  width?: number;
  height?: number;
}) {
  const g = sparkPath(values, width, height);
  if (!g.last) return null;
  const first = values[0]!;
  const last = values[values.length - 1]!;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Últimos ${values.length} fechamentos: de ${formatNumber(first, decimals)} a ${formatNumber(last, decimals)}`}
      className="shrink-0"
    >
      <path
        d={g.d}
        fill="none"
        stroke={SPARK_LINE}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={g.last.x} cy={g.last.y} r={4} fill={SPARK_NOW} stroke={SURFACE} strokeWidth={2} />
    </svg>
  );
}
