import type { DrawingKind } from '@radar/shared';
import { DRAWING_LABEL } from '@radar/shared';
import { useDrawingTool } from '../../lib/drawings-store';

/** Ícones simples (texto/unicode) para não depender de biblioteca de ícones. */
const TOOLS: { kind: DrawingKind; icon: string; key: string }[] = [
  { kind: 'hline', icon: '—', key: 'H' },
  { kind: 'trend', icon: '╱', key: 'T' },
  { kind: 'ray', icon: '↗', key: 'R' },
  { kind: 'vline', icon: '│', key: 'V' },
  { kind: 'zone', icon: '▭', key: 'Z' },
  { kind: 'channel', icon: '▱', key: 'C' },
  { kind: 'fib', icon: 'φ', key: 'F' },
  { kind: 'ruler', icon: '📏', key: 'M' },
  { kind: 'position', icon: '⚖', key: 'P' },
  { kind: 'text', icon: 'T', key: 'N' },
];

export const TOOL_SHORTCUTS: Record<string, DrawingKind> = Object.fromEntries(
  TOOLS.map((t) => [t.key, t.kind]),
);

/** Barra de ferramentas de desenho. Alt + letra no computador (ex.: Alt+H = linha horizontal). */
export function DrawingToolbar() {
  const { tool, setTool } = useDrawingTool();
  return (
    <div
      className="no-scrollbar flex items-center gap-1 overflow-x-auto border-b border-line bg-panel px-2 py-1"
      role="toolbar"
      aria-label="Ferramentas de desenho"
    >
      {TOOLS.map((t) => (
        <button
          key={t.kind}
          type="button"
          onClick={() => setTool(tool === t.kind ? null : t.kind)}
          title={`${DRAWING_LABEL[t.kind]} (Alt+${t.key})`}
          aria-label={DRAWING_LABEL[t.kind]}
          aria-pressed={tool === t.kind}
          className={`min-w-9 rounded border px-2 py-1 text-sm ${tool === t.kind ? 'border-accent bg-accent/20 text-accent' : 'border-line text-text hover:border-accent'}`}
        >
          {t.icon}
        </button>
      ))}
      {tool && (
        <span className="ml-2 whitespace-nowrap text-xs text-accent">
          {DRAWING_LABEL[tool]}: toque no gráfico ·{' '}
          <button className="underline" onClick={() => setTool(null)}>
            cancelar
          </button>
        </span>
      )}
    </div>
  );
}
