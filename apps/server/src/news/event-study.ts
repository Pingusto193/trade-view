import { eventStudy, type EventStudy, type StudyEvent } from '@radar/core';
import { isFatoRelevante, type CvmClient, type CvmIpeEvent } from '@radar/data';
import { INTRADAY_MS, isIntraday, type NewsItem, type Timeframe } from '@radar/shared';
import type { FundamentalsService } from '../fundamentals/service';
import type { MarketService } from '../market/service';
import type { NewsService } from './service';

const DAY = 86_400_000;
/** Anos de IPE baixados na primeira vez (arquivos grandes; decisão nossa). */
const IPE_YEARS = 5;

const tfMs = (tf: Timeframe) =>
  isIntraday(tf) ? INTRADAY_MS[tf] : tf === '1d' ? DAY : tf === '1w' ? 7 * DAY : 31 * DAY;

export interface EventStudyResponse {
  symbolId: string;
  tf: Timeframe;
  /** Notícias gravadas pelo Radar (com hora de publicação e de chegada). */
  radar: { study: EventStudy; events: number; since: number | null };
  /** Fatos relevantes da CVM (histórico longo, só a data de entrega). null fora de ações da B3 no diário. */
  cvm: { study: EventStudy | null; events: number; years: number[]; errors: string[] } | null;
  notes: string[];
}

/** Grupos de uma notícia do Radar: tipo, tema (etiquetas macro) e leitura da IA, quando houver. */
export function radarGroups(n: NewsItem): string[] {
  const g = [`tipo:${n.kind}`];
  for (const t of n.tags) if (t.type === 'macro' || t.type === 'moeda') g.push(`tema:${t.value}`);
  if (n.ai?.sentiment === 'positivo' || n.ai?.sentiment === 'negativo')
    g.push(`ia:${n.ai.sentiment}`);
  if ((n.ai?.relevance ?? 0) >= 4) g.push('ia:relevante');
  return [...new Set(g)];
}

/**
 * Estudo de evento (SPEC §23.1) de um ativo: notícias do Radar (minutos de precisão, com a chegada) e, em
 * ações da B3 no diário, fatos relevantes da CVM (anos de histórico, só a data).
 */
export class EventStudyService {
  private readonly ipe = new Map<number, { at: number; p: Promise<CvmIpeEvent[]> }>();

  constructor(
    private readonly market: MarketService,
    private readonly news: NewsService,
    private readonly cvm: CvmClient,
    private readonly fund: FundamentalsService,
    private readonly now: () => number = Date.now,
  ) {}

  private ipeYear(y: number): Promise<CvmIpeEvent[]> {
    const cur = new Date(this.now()).getUTCFullYear();
    const ttl = y === cur ? 6 * 3_600_000 : 7 * DAY;
    const c = this.ipe.get(y);
    if (c && this.now() - c.at < ttl) return c.p;
    const p = this.cvm.ipe(y);
    this.ipe.set(y, { at: this.now(), p });
    p.catch(() => this.ipe.delete(y));
    return p;
  }

  async study(symbolId: string, tf: Timeframe): Promise<EventStudyResponse> {
    const meta = await this.market.getMeta(symbolId);
    const hist = await this.market.getCandles(symbolId, tf, 5000);
    const candles = hist.lastCandleOpen ? hist.candles.slice(0, -1) : hist.candles;
    const len = tfMs(tf);
    const notes: string[] = [];
    const items = this.news.query({ symbols: [symbolId], limit: 5000, duplicates: false });
    const radarEvents: StudyEvent[] = items.map((n) => ({
      publishedAt: n.publishedAt ?? n.arrivedAt,
      // sem a hora da fonte, a "chegada" seria a própria publicação: fica fora da fração
      arrivedAt: n.publishedAt === null || n.backlog ? null : n.arrivedAt,
      groups: radarGroups(n),
    }));
    const since = items.length ? Math.min(...items.map((n) => n.arrivedAt)) : null;
    if (since !== null && this.now() - since < 90 * DAY)
      notes.push(
        'O Radar grava notícias há menos de 3 meses: amostra pequena, nada conclusivo ainda.',
      );
    const radar = {
      study: eventStudy(candles, radarEvents, { tfMs: len }),
      events: radarEvents.length,
      since,
    };

    let cvm: EventStudyResponse['cvm'] = null;
    if (meta.market === 'b3' && !isIntraday(tf) && meta.pointValue === 1) {
      const cnpj = await this.fund.cvmCnpj(meta.symbol).catch(() => null);
      if (!cnpj)
        notes.push('Sem CNPJ na CVM para este código (ETF, FII, BDR?): sem fatos relevantes.');
      else {
        const cur = new Date(this.now()).getUTCFullYear();
        const first = candles[0] ? new Date(candles[0].time).getUTCFullYear() : cur;
        const years: number[] = [];
        for (let y = Math.max(first, cur - IPE_YEARS + 1); y <= cur; y++) years.push(y);
        const errors: string[] = [];
        const events: StudyEvent[] = [];
        for (const y of years) {
          try {
            for (const e of await this.ipeYear(y))
              if (e.cnpj === cnpj && isFatoRelevante(e))
                events.push({
                  publishedAt: e.deliveredAt,
                  arrivedAt: null,
                  groups: ['cvm:fato-relevante'],
                });
          } catch (e) {
            errors.push(`${y}: ${(e as Error).message}`);
          }
        }
        cvm = {
          study: events.length ? eventStudy(candles, events, { tfMs: len }) : null,
          events: events.length,
          years,
          errors,
        };
        notes.push(
          'Fatos relevantes da CVM: só a DATA de entrega (muitos saem fora do pregão); o movimento é medido a partir do fechamento da véspera.',
        );
      }
    }
    return { symbolId, tf, radar, cvm, notes };
  }
}
