import type { Drawing, Timeframe } from '@radar/shared';
import { DRAWING_LABEL, TIMEFRAME_LABEL } from '@radar/shared';
import { useAlertForm } from '../../lib/alerts-store';
import { useDrawings, useDrawingTool } from '../../lib/drawings-store';

const COLORS = ['#38bdf8', '#f59e0b', '#22c55e', '#ef4444', '#a78bfa', '#f8fafc'];

/** Ações do desenho selecionado: travar, ocultar, apagar, cor, escalas e (Fase 4) alerta. */
export function DrawingPanel({ symbolId, tf }: { symbolId: string; tf: Timeframe }) {
  const selectedId = useDrawingTool((s) => s.selectedId);
  const select = useDrawingTool((s) => s.select);
  const list = useDrawings((s) => s.bySymbol[symbolId]);
  const { save, remove } = useDrawings.getState();
  const d = list?.find((x) => x.id === selectedId);
  if (!d) return null;
  const upd = (patch: Partial<Drawing>) => save({ ...d, ...patch });
  const btn = 'rounded border border-line px-2 py-1 text-xs hover:border-accent';

  return (
    <div
      className="absolute inset-x-2 bottom-2 z-20 mx-auto max-w-xl rounded-lg border border-line bg-panel/95 p-2 text-xs shadow-xl"
      role="dialog"
      aria-label="Desenho selecionado"
    >
      <div className="mb-1 flex items-center gap-2">
        <b>{DRAWING_LABEL[d.data.kind]}</b>
        {d.locked && <span className="text-muted">🔒 travado</span>}
        <button className="ml-auto text-muted" onClick={() => select(null)} aria-label="Fechar">
          ✕
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <button className={btn} onClick={() => upd({ locked: !d.locked })}>
          {d.locked ? '🔓 Destravar' : '🔒 Travar'}
        </button>
        <button className={btn} onClick={() => upd({ hidden: true })}>
          🙈 Ocultar
        </button>
        <button
          className={btn}
          onClick={() => upd({ tf: d.tf === null ? tf : null })}
          title="Copiar entre escalas"
        >
          {d.tf === null ? `Só no ${TIMEFRAME_LABEL[tf]}` : 'Em todas as escalas'}
        </button>
        <button
          className={btn}
          onClick={() => upd({ style: { ...d.style, dashed: !d.style.dashed } })}
        >
          {d.style.dashed ? 'Linha cheia' : 'Tracejada'}
        </button>
        {(d.data.kind === 'hline' ||
          d.data.kind === 'trend' ||
          d.data.kind === 'ray' ||
          d.data.kind === 'zone') && (
          <button
            className={btn}
            onClick={() =>
              useAlertForm.getState().open({
                symbolId,
                tf: d.tf ?? tf,
                condition: {
                  kind: 'drawing',
                  drawingId: d.id,
                  event: d.data.kind === 'zone' ? 'enter' : 'cross-up',
                },
                trigger: 'close',
              })
            }
          >
            🔔 Alerta
          </button>
        )}
        {d.data.kind === 'zone' && (
          <button
            className={btn}
            onClick={() =>
              d.data.kind === 'zone' &&
              upd({ data: { ...d.data, extendRight: !d.data.extendRight } })
            }
          >
            {d.data.extendRight ? 'Não estender' : 'Estender →'}
          </button>
        )}
        {d.data.kind === 'text' && (
          <button
            className={btn}
            onClick={() => {
              if (d.data.kind !== 'text') return;
              const t = window.prompt('Texto da nota:', d.data.text)?.trim();
              if (t) upd({ data: { ...d.data, text: t.slice(0, 500) } });
            }}
          >
            ✎ Editar texto
          </button>
        )}
        <button className={btn} disabled title="Chega na Fase 4 (alertas)">
          🔔 Criar alerta
        </button>
        <span className="flex gap-1 px-1">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => upd({ style: { ...d.style, color: c } })}
              aria-label={`Cor ${c}`}
              className={`h-5 w-5 rounded-full border ${d.style.color === c ? 'border-white' : 'border-transparent'}`}
              style={{ background: c }}
            />
          ))}
        </span>
        <button
          className="ml-auto rounded border border-down/60 px-2 py-1 text-xs text-down"
          onClick={() => {
            remove(d);
            select(null);
          }}
        >
          🗑 Apagar
        </button>
      </div>
      <p className="mt-1 text-[10px] text-muted">
        {d.tf === null ? 'Visível em todas as escalas.' : `Visível só no ${TIMEFRAME_LABEL[d.tf]}.`}{' '}
        Arraste os pontos para ajustar. Delete apaga (computador).
      </p>
    </div>
  );
}

/** Lista dos desenhos do ativo, para reexibir ocultos e apagar. */
export function DrawingList({ symbolId, onClose }: { symbolId: string; onClose(): void }) {
  const list = useDrawings((s) => s.bySymbol[symbolId]) ?? [];
  const { save, remove } = useDrawings.getState();
  return (
    <div className="absolute right-2 top-2 z-30 w-72 rounded-lg border border-line bg-panel p-2 text-xs shadow-xl">
      <div className="mb-1 flex items-center">
        <b>Desenhos deste ativo ({list.length})</b>
        <button className="ml-auto text-muted" onClick={onClose} aria-label="Fechar lista">
          ✕
        </button>
      </div>
      {list.length === 0 && <p className="text-muted">Nenhum desenho ainda.</p>}
      <ul className="max-h-64 space-y-1 overflow-y-auto">
        {list.map((d) => (
          <li key={d.id} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: d.style.color }} />
            <span className="flex-1 truncate">
              {DRAWING_LABEL[d.data.kind]}
              {d.tf ? ` (${TIMEFRAME_LABEL[d.tf]})` : ''}
            </span>
            <button
              className="rounded border border-line px-1"
              onClick={() => save({ ...d, hidden: !d.hidden })}
            >
              {d.hidden ? '👁 mostrar' : '🙈'}
            </button>
            <button
              className="rounded border border-down/50 px-1 text-down"
              onClick={() => remove(d)}
              aria-label="Apagar desenho"
            >
              🗑
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
