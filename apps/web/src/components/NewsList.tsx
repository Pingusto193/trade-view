import {
  NEWS_KIND_LABEL,
  formatAgo,
  formatDateTime,
  type NewsItem,
  type NewsSentiment,
} from '@radar/shared';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { feedKey, useNews } from '../lib/news-store';

const SENTIMENT: Record<NewsSentiment, { label: string; tone: string }> = {
  positivo: { label: 'positiva', tone: 'bg-up/15 text-up' },
  negativo: { label: 'negativa', tone: 'bg-down/15 text-down' },
  neutro: { label: 'neutra', tone: 'bg-panel-2 text-muted' },
  misto: { label: 'mista', tone: 'bg-warn/15 text-warn' },
};

/** Resumo por IA (2–3 linhas, só do título + trecho do feed), relevância, sentimento e ativos. */
function AiSummary({ n, compact }: { n: NewsItem; compact: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!n.aiAllowed) return null;
  const ai = n.ai;
  if (!ai || (!ai.summary && ai.error)) {
    return (
      <div className="text-[11px] text-muted">
        {ai?.error && <span>Sem resumo: {ai.error}. </span>}
        <button
          type="button"
          disabled={busy}
          className="underline decoration-dotted"
          onClick={() => {
            setBusy(true);
            setErr(null);
            api(`/api/news/${encodeURIComponent(n.id)}/summary`, { method: 'POST' })
              .then(() => useNews.getState().reloadAll())
              .catch((e: Error) => setErr(e.message))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? 'Resumindo…' : 'Resumir com IA'}
        </button>
        {err && <span className="ml-1 text-down">{err}</span>}
      </div>
    );
  }
  return (
    <div
      className="space-y-1 rounded border border-line/60 bg-panel-2/40 px-2 py-1"
      data-testid="news-ai"
    >
      <p className={`text-xs ${compact ? 'line-clamp-3' : ''}`}>{ai.summary}</p>
      <div className="flex flex-wrap items-center gap-1 text-[10px]">
        {ai.relevance !== null && (
          <span
            className="rounded bg-panel-2 px-1.5 text-muted"
            title="1 = não deve mexer em preços; 5 = pode mexer forte"
          >
            relevância {ai.relevance}/5
          </span>
        )}
        {ai.sentiment && (
          <span className={`rounded px-1.5 ${SENTIMENT[ai.sentiment].tone}`}>
            leitura {SENTIMENT[ai.sentiment].label}
          </span>
        )}
        {ai.assets.slice(0, 6).map((a) => (
          <span key={a} className="rounded bg-accent/10 px-1.5 text-accent">
            {a}
          </span>
        ))}
        <span className="text-muted">· resumo por IA ({ai.model}); pode errar — abra o link</span>
      </div>
    </div>
  );
}

const TAG_LABEL: Record<string, string> = {
  'macro:juros-br': 'juros BR',
  'macro:inflacao-br': 'inflação BR',
  'macro:fiscal-br': 'fiscal BR',
  'macro:juros-us': 'juros EUA',
  'macro:inflacao-us': 'inflação EUA',
  'macro:emprego-us': 'emprego EUA',
  'indice:IBOV': 'Ibovespa',
  'indice:SPX': 'bolsa EUA',
};

/** Atraso medido: chegada − publicação (só notícias que não eram acervo). */
function delayLabel(n: NewsItem): string | null {
  if (n.backlog || n.publishedAt === null) return null;
  const min = Math.max(0, Math.round((n.arrivedAt - n.publishedAt) / 60_000));
  return min < 1 ? 'chegou em <1 min' : `chegou ${min} min depois`;
}

/** Lista de notícias (feed). Título leva à matéria original; nunca republicamos o texto. */
export function NewsList({
  symbols,
  compact = false,
  onPick,
}: {
  /** Ativos de interesse (vazio/ausente = todas as notícias). */
  symbols?: readonly string[];
  compact?: boolean;
  /** Clique na hora: leva o gráfico até o candle da notícia. */
  onPick?: (n: NewsItem) => void;
}) {
  const key = feedKey(symbols);
  const feed = useNews((s) => s.feeds[key]);
  const load = useNews((s) => s.load);
  useEffect(() => {
    void load(symbols);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, load]);

  if (!feed || (feed.loading && !feed.items.length))
    return <p className="p-3 text-xs text-muted">Carregando notícias…</p>;
  if (feed.error && !feed.items.length)
    return <p className="p-3 text-xs text-down">Não foi possível carregar: {feed.error}</p>;
  if (!feed.items.length)
    return (
      <p className="p-3 text-xs text-muted">
        Nenhuma notícia associada {symbols?.length ? 'a estes ativos' : 'ainda'}. A associação é por
        palavras e códigos; veja as fontes em Notícias.
      </p>
    );
  return (
    <ul className="divide-y divide-line" data-testid="news-list">
      {feed.items.map((n) => {
        const t = n.publishedAt ?? n.arrivedAt;
        const delay = delayLabel(n);
        return (
          <li key={n.id} className="space-y-1 px-3 py-2">
            <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
              <button
                type="button"
                className={onPick ? 'underline decoration-dotted hover:text-text' : ''}
                onClick={() => onPick?.(n)}
                disabled={!onPick}
                title={formatDateTime(t)}
              >
                {formatAgo(t)}
              </button>
              <span>· {n.sourceLabel}</span>
              {n.kind !== 'noticia' && (
                <span className="rounded bg-accent/15 px-1 text-accent">
                  {NEWS_KIND_LABEL[n.kind]}
                </span>
              )}
              {n.publishedAt === null && (
                <span title="A fonte não informa a hora">sem hora da fonte</span>
              )}
              {delay && <span>· {delay}</span>}
            </div>
            <a
              href={n.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-sm font-medium leading-snug hover:text-accent"
            >
              {n.title}
            </a>
            {!compact && n.snippet && !n.ai?.summary && (
              <p className="text-xs text-muted">{n.snippet}</p>
            )}
            <AiSummary n={n} compact={compact} />
            {n.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {n.tags.slice(0, compact ? 4 : 8).map((tg) => {
                  const k = `${tg.type}:${tg.value}`;
                  return (
                    <span key={k} className="rounded bg-panel-2 px-1.5 text-[10px] text-muted">
                      {TAG_LABEL[k] ?? tg.value}
                    </span>
                  );
                })}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
