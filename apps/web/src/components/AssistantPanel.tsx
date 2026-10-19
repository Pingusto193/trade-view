import type { AssistantAnswer } from '@radar/shared';
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import { screenContext } from '../lib/assistant-context';
import { useAssistant } from '../lib/assistant-store';

const usd = (x: number) => `US$ ${x.toFixed(x < 0.1 ? 4 : 2).replace('.', ',')}`;

/** Botão do topo: só aparece com o assistente ligado (SPEC §16: desligado por padrão). */
export function AssistantButton() {
  const s = useAssistant((x) => x.settings);
  const toggle = useAssistant((x) => x.toggle);
  if (!s?.enabled) return null;
  return (
    <button
      type="button"
      onClick={() => toggle(true)}
      className="shrink-0 rounded border border-line px-2 py-1 text-xs text-muted hover:text-text"
      aria-label="Perguntar ao assistente"
      title="Perguntar ao assistente"
    >
      💬 IA
    </button>
  );
}

/** Pergunta ao assistente com o resumo da tela atual (visível antes de enviar). */
export function AssistantPanel() {
  const { open, toggle, settings, set } = useAssistant();
  const loc = useLocation();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  const ctx = screenContext(loc.pathname, loc.search);
  const ask = async () => {
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      const a = await api<AssistantAnswer>('/api/assistant/ask', {
        method: 'POST',
        body: JSON.stringify({ question, screen: ctx.screen, context: ctx.context }),
      });
      setAnswer(a);
      if (settings) set({ ...settings, spentUsd: a.spentUsd, requests: settings.requests + 1 });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      role="dialog"
      aria-label="Assistente"
    >
      <div className="max-h-[90vh] w-full max-w-lg space-y-2 overflow-y-auto rounded-t-xl border border-line bg-panel p-3 text-sm sm:rounded-xl">
        <div className="flex items-center gap-2">
          <b>Assistente ({ctx.screen})</b>
          <button
            type="button"
            className="ml-auto text-muted"
            onClick={() => toggle(false)}
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>
        <p className="text-[11px] text-muted">
          Analista crítico: aponta riscos, custos e o CDI; não prevê o futuro nem manda comprar ou
          vender. Cada pergunta custa dinheiro na sua conta da Anthropic.
          {settings && ` Este mês: ${usd(settings.spentUsd)} de ${usd(settings.monthlyLimitUsd)}.`}
        </p>
        <textarea
          className="w-full rounded border border-line bg-bg px-2 py-1"
          rows={3}
          maxLength={2000}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ex.: este resultado do laboratório justifica arriscar dinheiro real?"
          aria-label="Pergunta"
        />
        <details className="text-[11px]">
          <summary className="cursor-pointer text-muted">
            O que vai junto com a pergunta (resumo da tela)
          </summary>
          <pre
            className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-bg p-2"
            data-testid="assistant-context"
          >
            {JSON.stringify(ctx.context, null, 2)}
          </pre>
        </details>
        <button
          type="button"
          className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-50"
          disabled={busy || question.trim().length < 3}
          onClick={() => void ask()}
        >
          {busy ? 'Pensando…' : 'Perguntar'}
        </button>
        {error && (
          <p className="text-sm text-down" role="alert">
            {error}
          </p>
        )}
        {answer && (
          <div className="space-y-1 rounded bg-bg p-2" data-testid="assistant-answer">
            <p className={`whitespace-pre-wrap ${answer.refused ? 'text-warn' : ''}`}>
              {answer.text}
            </p>
            <p className="text-[11px] text-muted">
              {answer.model} · custo estimado {usd(answer.costUsd)} · gasto no mês{' '}
              {usd(answer.spentUsd)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
