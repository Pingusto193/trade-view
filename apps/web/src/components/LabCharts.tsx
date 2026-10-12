import { formatDate, formatNumber } from '@radar/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Gráficos do laboratório em SVG simples (sem biblioteca): curva de capital com linha do corte
 * treino/teste e barras de polaridade (ganho × perda) para a distribuição de R e os meses.
 *
 * Cores de polaridade validadas para o fundo escuro (#111827) com o validador de paletas
 * (faixa de luminosidade, separação para daltonismo e contraste): azul = ganho, âmbar = perda.
 * Verde/vermelho foram evitados de propósito (confusão para daltônicos); a posição em relação ao
 * zero e o texto da dica repetem a informação, então a cor nunca está sozinha.
 */
export const GAIN = '#0284c7';
export const LOSS = '#d97706';
const LINE = '#38bdf8';
const GRID = '#1f2937';
const AXIS = '#94a3b8';
const SURFACE = '#111827';

/** Largura do contêiner (para o SVG ocupar a tela do celular ao computador). */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Marcas "redondas" de eixo (1, 2, 2,5, 5 × 10^k). */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step)
    out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

/** Valor compacto para eixos: 12,5 mil / 1,2 mi. */
export function compact(v: number): string {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e6) return `${formatNumber(v / 1e6, 1)} mi`;
  if (a >= 1e4) return `${formatNumber(v / 1e3, 0)} mil`;
  if (a >= 1e3) return `${formatNumber(v / 1e3, 1)} mil`;
  return formatNumber(v, a < 10 ? 1 : 0);
}

/** Rótulos de eixo distintos: se o formato compacto repetir rótulos, usa as casas do passo. */
export function axisLabels(ticks: readonly number[], fmt: (v: number) => string): string[] {
  const a = ticks.map(fmt);
  if (new Set(a).size === a.length) return a;
  const step = ticks.length > 1 ? Math.abs(ticks[1]! - ticks[0]!) : 1;
  const d = Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9)));
  return ticks.map((v) => formatNumber(v, d));
}

function Tooltip({
  x,
  y,
  width,
  children,
}: {
  x: number;
  y: number;
  width: number;
  children: ReactNode;
}) {
  // fica dentro do gráfico: vira para a esquerda perto da borda direita
  const left = x > width - 170 ? Math.max(0, x - 170) : x + 12;
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 w-40 rounded border border-line bg-panel-2 px-2 py-1 text-xs shadow-lg"
      style={{ left, top: Math.max(0, y - 10) }}
    >
      {children}
    </div>
  );
}

/** Caminho de barra com só as pontas de dado arredondadas (a base fica reta, encostada no zero). */
function barPath(x: number, y0: number, y1: number, w: number, r = 4): string {
  const up = y1 < y0;
  const h = Math.abs(y1 - y0);
  const rr = Math.min(r, w / 2, h);
  if (h < 0.5) return '';
  const tip = y1;
  const s = up ? 1 : -1; // direção do arredondamento (para cima ou para baixo)
  return [
    `M${x},${y0}`,
    `L${x},${tip + s * rr}`,
    `Q${x},${tip} ${x + rr},${tip}`,
    `L${x + w - rr},${tip}`,
    `Q${x + w},${tip} ${x + w},${tip + s * rr}`,
    `L${x + w},${y0}`,
    'Z',
  ].join(' ');
}

/** Curva de capital (patrimônio marcado a mercado em cada candle). */
export function EquityChart({
  points,
  initial,
  cut,
  money,
}: {
  points: readonly { time: number; equity: number }[];
  initial: number;
  cut: number;
  money(v: number): string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 220;
  const M = { l: 56, r: 10, t: 10, b: 24 };
  if (points.length < 2) return <p className="text-sm text-muted">Poucos pontos para desenhar.</p>;
  const t0 = points[0]!.time;
  const t1 = points.at(-1)!.time;
  const eqs = points.map((p) => p.equity);
  let lo = Math.min(initial, ...eqs);
  let hi = Math.max(initial, ...eqs);
  const pad = (hi - lo) * 0.06 || hi * 0.01 || 1;
  lo -= pad;
  hi += pad;
  const iw = Math.max(10, width - M.l - M.r);
  const ih = H - M.t - M.b;
  const x = (t: number) => M.l + ((t - t0) / (t1 - t0 || 1)) * iw;
  const y = (v: number) => M.t + (1 - (v - lo) / (hi - lo)) * ih;
  const d = points
    .map((p, i) => `${i ? 'L' : 'M'}${x(p.time).toFixed(1)},${y(p.equity).toFixed(1)}`)
    .join('');
  const ticks = niceTicks(lo, hi, 4);
  const labels = axisLabels(ticks, compact);
  const cutX = x(cut);
  const showCut = cut > t0 && cut < t1;
  const hp = hover === null ? null : points[hover]!;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const t = t0 + ((e.clientX - box.left) / box.width) * (t1 - t0);
    let a = 0;
    let b = points.length - 1;
    while (b - a > 1) {
      const m = (a + b) >> 1;
      if (points[m]!.time < t) a = m;
      else b = m;
    }
    setHover(Math.abs(points[a]!.time - t) <= Math.abs(points[b]!.time - t) ? a : b);
  };

  return (
    <div ref={ref} className="relative w-full" data-testid="equity-chart">
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label="Curva de capital">
          {ticks.map((v, i) => (
            <g key={v}>
              <line x1={M.l} x2={M.l + iw} y1={y(v)} y2={y(v)} stroke={GRID} />
              <text x={M.l - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill={AXIS}>
                {labels[i]}
              </text>
            </g>
          ))}
          <line
            x1={M.l}
            x2={M.l + iw}
            y1={y(initial)}
            y2={y(initial)}
            stroke={AXIS}
            strokeDasharray="2 4"
          />
          {showCut && (
            <g>
              <line
                x1={cutX}
                x2={cutX}
                y1={M.t}
                y2={M.t + ih}
                stroke={AXIS}
                strokeDasharray="4 4"
              />
              <text x={cutX - 4} y={M.t + 11} textAnchor="end" fontSize="11" fill={AXIS}>
                treino
              </text>
              <text x={cutX + 4} y={M.t + 11} fontSize="11" fill={AXIS}>
                teste
              </text>
            </g>
          )}
          <path d={d} fill="none" stroke={LINE} strokeWidth={2} strokeLinejoin="round" />
          <text x={M.l} y={H - 6} fontSize="11" fill={AXIS}>
            {formatDate(t0)}
          </text>
          <text x={M.l + iw} y={H - 6} textAnchor="end" fontSize="11" fill={AXIS}>
            {formatDate(t1)}
          </text>
          {hp && (
            <g>
              <line x1={x(hp.time)} x2={x(hp.time)} y1={M.t} y2={M.t + ih} stroke={AXIS} />
              <circle
                cx={x(hp.time)}
                cy={y(hp.equity)}
                r={4}
                fill={LINE}
                stroke={SURFACE}
                strokeWidth={2}
              />
            </g>
          )}
          <rect
            x={M.l}
            y={M.t}
            width={iw}
            height={ih}
            fill="transparent"
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
      )}
      {hp && (
        <Tooltip x={x(hp.time)} y={y(hp.equity)} width={width}>
          <div className="text-muted">{formatDate(hp.time)}</div>
          <div className="font-semibold">{money(hp.equity)}</div>
          <div>
            {hp.equity >= initial ? '+' : ''}
            {formatNumber((hp.equity / initial - 1) * 100, 2)}% desde o início
          </div>
        </Tooltip>
      )}
      <p className="mt-1 text-xs text-muted">
        Linha pontilhada horizontal = capital inicial ({money(initial)}).
        {showCut && ' Tracejada vertical = início do teste fora da amostra.'}
      </p>
    </div>
  );
}

export interface PolarityBar {
  key: string;
  /** Rótulo curto embaixo da barra (vazio = sem rótulo). */
  axis: string;
  value: number;
  /** Lado da polaridade (quando o valor é contagem, o sinal vem do intervalo). */
  negative: boolean;
  tip: ReactNode;
}

/** Barras de polaridade: azul acima/à direita do zero (ganho), âmbar (perda). */
export function PolarityBars({
  bars,
  label,
  yFormat = compact,
  integerTicks = false,
  testId,
}: {
  bars: readonly PolarityBar[];
  label: string;
  yFormat?: (v: number) => string;
  /** Contagens: só marcas inteiras no eixo. */
  integerTicks?: boolean;
  testId?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 180;
  const M = { l: 44, r: 6, t: 8, b: 22 };
  if (!bars.length) return <p className="text-sm text-muted">Sem dados.</p>;
  const vals = bars.map((b) => b.value);
  const lo = Math.min(0, ...vals);
  const hi = Math.max(0, ...vals) || 1;
  const iw = Math.max(10, width - M.l - M.r);
  const ih = H - M.t - M.b;
  const y = (v: number) => M.t + (1 - (v - lo) / (hi - lo || 1)) * ih;
  const slot = iw / bars.length;
  const gap = slot > 6 ? 2 : 0; // 2 px de fundo entre barras vizinhas
  const bw = Math.max(1, slot - gap);
  const ticks = niceTicks(lo, hi, 3).filter((v) => !integerTicks || Number.isInteger(v));
  const labels = axisLabels(ticks, yFormat);
  // rótulos de baixo sem encostar um no outro (no celular, alguns somem)
  const showAxis: boolean[] = [];
  let lastX = -Infinity;
  for (let i = 0; i < bars.length; i++) {
    const x = M.l + i * slot;
    const ok = Boolean(bars[i]!.axis) && x - lastX >= 24;
    if (ok) lastX = x;
    showAxis.push(ok);
  }
  const hb = hover === null ? null : bars[hover]!;

  return (
    <div ref={ref} className="relative w-full" data-testid={testId}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label={label}>
          {ticks.map((v, i) => (
            <g key={v}>
              <line x1={M.l} x2={M.l + iw} y1={y(v)} y2={y(v)} stroke={GRID} />
              <text x={M.l - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill={AXIS}>
                {labels[i]}
              </text>
            </g>
          ))}
          {bars.map((b, i) => {
            const bx = M.l + i * slot + gap / 2;
            return (
              <g key={b.key}>
                <path
                  d={barPath(bx, y(0), y(b.value), bw, Math.min(4, bw / 3))}
                  fill={b.negative ? LOSS : GAIN}
                  opacity={hover === null || hover === i ? 1 : 0.55}
                />
                {showAxis[i] && (
                  <text x={M.l + i * slot} y={H - 6} textAnchor="middle" fontSize="11" fill={AXIS}>
                    {b.axis}
                  </text>
                )}
                {/* alvo de toque maior que a barra: a coluna inteira */}
                <rect
                  x={M.l + i * slot}
                  y={M.t}
                  width={slot}
                  height={ih}
                  fill="transparent"
                  onPointerEnter={() => setHover(i)}
                  onPointerDown={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                />
              </g>
            );
          })}
          <line x1={M.l} x2={M.l + iw} y1={y(0)} y2={y(0)} stroke={AXIS} />
        </svg>
      )}
      {hb && hover !== null && (
        <Tooltip x={M.l + (hover + 0.5) * slot} y={y(Math.max(0, hb.value))} width={width}>
          {hb.tip}
        </Tooltip>
      )}
    </div>
  );
}

/** Legenda das duas cores de polaridade (texto em cor de texto; a cor fica no quadradinho). */
export function PolarityLegend({ gain, loss }: { gain: string; loss: string }) {
  return (
    <p className="flex flex-wrap gap-3 text-xs text-muted">
      <span className="flex items-center gap-1">
        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: GAIN }} />
        {gain}
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: LOSS }} />
        {loss}
      </span>
    </p>
  );
}
