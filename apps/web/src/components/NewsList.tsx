import { NEWS_KIND_LABEL, formatAgo, formatDateTime, type NewsItem } from '@radar/shared';
import { useEffect } from 'react';
import { feedKey, useNews } from '../lib/news-store';

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
            {!compact && n.snippet && <p className="text-xs text-muted">{n.snippet}</p>}
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
