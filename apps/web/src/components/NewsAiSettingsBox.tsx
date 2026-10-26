import { formatNumber, type NewsAiSettings } from '@radar/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

const usd = (x: number) => `US$ ${formatNumber(x, 2)}`;

/**
 * Liga/desliga o resumo por IA das notícias (SPEC §23.1). A chave e os preços são os do Assistente
 * (guardados só no servidor); aqui ficam o modelo opcional e o limite de gasto mensal próprio.
 */
export function NewsAiSettingsBox() {
  const [st, setSt] = useState<NewsAiSettings | null>(null);
  const [limit, setLimit] = useState('2');
  const [model, setModel] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    api<NewsAiSettings>('/api/news/ai')
      .then((s) => {
        setSt(s);
        setLimit(String(s.monthlyLimitUsd).replace('.', ','));
        setModel(s.model ?? '');
      })
      .catch((e: Error) => setMsg(e.message));
  }, []);
  const save = (enabled: boolean) => {
    setMsg(null);
    const v = Number(limit.replace(',', '.'));
    api<NewsAiSettings>('/api/news/ai', {
      method: 'PUT',
      body: JSON.stringify({
        enabled,
        monthlyLimitUsd: v,
        ...(model.trim() ? { model: model.trim() } : {}),
      }),
    })
      .then((s) => {
        setSt(s);
        setMsg(enabled ? 'Ligado.' : 'Desligado.');
      })
      .catch((e: Error) => setMsg(e.message));
  };
  if (!st) return <p className="text-xs text-muted">{msg ?? 'Carregando…'}</p>;
  return (
    <div className="space-y-2 text-xs" data-testid="news-ai-settings">
      <p className="text-muted">
        Resume em 2–3 linhas, com relevância, leitura (positiva/negativa) e ativos afetados, as
        notícias novas que interessam aos seus ativos (listas, mini-índice e mini-dólar) e as
        oficiais (BCB, Copom, Fed). A IA recebe só o título e o trecho do feed, nunca a matéria; só
        fontes cujos termos permitem. Usa a chave e os preços do{' '}
        <Link to="/conta" className="underline">
          Assistente
        </Link>
        {st.keyConfigured ? '' : ' (ainda sem chave)'}.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5">
          Limite por mês (US$)
          <input
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            inputMode="decimal"
            className="w-24 rounded border border-line bg-bg px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          Modelo (vazio = o do Assistente)
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={st.effectiveModel ?? ''}
            className="w-48 rounded border border-line bg-bg px-2 py-1"
          />
        </label>
        <button
          type="button"
          onClick={() => save(!st.enabled)}
          className={`rounded border px-3 py-1 ${st.enabled ? 'border-line' : 'border-accent text-accent'}`}
        >
          {st.enabled ? 'Desligar' : 'Ligar resumo por IA'}
        </button>
      </div>
      <p>
        {st.enabled ? '🟢 Ligado' : '⚪ Desligado'} · {st.month}: gasto estimado {usd(st.spentUsd)}{' '}
        de {usd(st.monthlyLimitUsd)} em {st.requests} resumo(s)
        {st.pending ? ` · ${st.pending} na fila` : ''}.
      </p>
      {msg && <p className="text-muted">{msg}</p>}
    </div>
  );
}
