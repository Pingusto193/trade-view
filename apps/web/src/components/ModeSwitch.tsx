import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePrefs } from '../lib/prefs';
import { HelpLink } from './HelpLink';

/** Chave global Treino/Real (SPEC §13). Treino é o padrão no primeiro uso. */
export function ModeSwitch() {
  const mode = usePrefs((s) => s.mode);
  const setMode = usePrefs((s) => s.setMode);
  const [asking, setAsking] = useState(false);
  return (
    <>
      <div
        className="ml-auto flex rounded border border-line text-xs"
        role="group"
        aria-label="Modo"
      >
        <button
          onClick={() => setMode('treino')}
          aria-pressed={mode === 'treino'}
          className={`px-2 py-1 ${mode === 'treino' ? 'bg-train/25 font-semibold text-train' : 'text-muted'}`}
        >
          Treino
        </button>
        <button
          onClick={() => (mode === 'real' ? undefined : setAsking(true))}
          aria-pressed={mode === 'real'}
          className={`px-2 py-1 ${mode === 'real' ? 'bg-panel-2 font-semibold text-text' : 'text-muted'}`}
        >
          Real
        </button>
      </div>
      {asking && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3"
          role="dialog"
          aria-label="Mudar para o modo Real"
        >
          <div className="max-w-md space-y-2 rounded-xl border border-line bg-panel p-4 text-sm">
            <b>Mudar para o modo Real?</b>
            <p>
              No modo Real o Radar <b>continua sem enviar ordens</b>: você opera na sua corretora e
              registra aqui o que fez. A faixa de treino some para você não confundir os dois.
            </p>
            <p className="text-muted">
              Antes de arriscar dinheiro, veja seus números do treino (amostra, resultado depois de
              custos e IR, disciplina) e compare com o CDI. O painel de prontidão completo chega com
              o laboratório.
            </p>
            <p className="text-xs">
              <HelpLink slug="antes-de-arriscar-dinheiro" label="Antes de arriscar dinheiro" />{' '}
              <Link
                to="/biblioteca/antes-de-arriscar-dinheiro"
                onClick={() => setAsking(false)}
                className="text-accent underline"
              >
                Antes de arriscar dinheiro
              </Link>{' '}
              ·{' '}
              <Link to="/treino" onClick={() => setAsking(false)} className="text-accent underline">
                Meus números do treino
              </Link>
            </p>
            <div className="flex gap-2 pt-1">
              <button
                className="rounded border border-line px-3 py-1"
                onClick={() => setAsking(false)}
              >
                Continuar no treino
              </button>
              <button
                className="rounded bg-panel-2 px-3 py-1"
                onClick={() => {
                  setMode('real');
                  setAsking(false);
                }}
              >
                Mudar para Real
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Faixa sempre visível no modo Treino. */
export function TrainBanner() {
  const mode = usePrefs((s) => s.mode);
  if (mode !== 'treino') return null;
  return (
    <div
      className="bg-train px-2 py-0.5 text-center text-[11px] font-bold tracking-widest text-black"
      data-testid="train-banner"
    >
      MODO TREINO — dinheiro fictício, preços reais
    </div>
  );
}
