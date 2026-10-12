import type { Candle, SymbolMeta, SymbolSearchResult, Timeframe } from '@radar/shared';
import { INTRADAY_MS, isIntraday } from '@radar/shared';
import { aggregate, periodKey } from '@radar/core';
import {
  SymbolNotFoundError,
  symbolId,
  type CandleRequest,
  type MarketDataAdapter,
  type SubscribeHandlers,
  type Subscription,
} from '../types';

/**
 * DADOS SIMULADOS — só para desenvolvimento (SPEC §3.1).
 * Passeio aleatório determinístico por símbolo. Nunca é ligado em produção: o servidor só registra
 * este adaptador com RADAR_SIMULATED=1, e a interface mostra a faixa "DADOS SIMULADOS".
 */
const SYMBOLS: readonly [string, string, number][] = [
  ['SIMBTC', 'Cripto simulada (24/7)', 60_000],
  ['SIMACAO', 'Ação simulada', 35],
  ['SIMFX', 'Par de moedas simulado', 5.2],
];

const DAY = 86_400_000;

/** PRNG determinístico (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

function gauss(r: () => number): number {
  const u = Math.max(r(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

/** Primeiro dia do passeio aleatório diário (determinístico a partir daqui). */
const EPOCH_DAY = Math.floor(Date.UTC(2010, 0, 1) / DAY);
const walks = new Map<string, number[]>();

/**
 * Logaritmo do fechamento do dia `dk` em múltiplos do preço-base: tendência lenta (ondas de meses) +
 * passeio aleatório com leve volta à média (σ ≈ 1,5% ao dia). Sem padrões periódicos de curto prazo,
 * que fariam setups parecerem melhores ou piores do que num passeio aleatório.
 */
function dayLog(symbol: string, dk: number): number {
  const slow = 0.15 * Math.sin(dk / 90);
  const i = Math.max(0, dk - EPOCH_DAY);
  let w = walks.get(symbol);
  if (!w) {
    w = [0];
    walks.set(symbol, w);
  }
  while (w.length <= i) {
    const j = w.length;
    const r = rng(seedOf(symbol) ^ Math.imul(EPOCH_DAY + j, 2654435761));
    const prev = w[j - 1] as number;
    w.push(prev + 0.015 * gauss(r) - 0.01 * prev);
  }
  return slow + (w[i] as number);
}

const dayClose = (symbol: string, base: number, dk: number) => base * Math.exp(dayLog(symbol, dk));

/** Nível contínuo dentro do dia: interpola (em log) do fechamento anterior ao fechamento do dia. */
function level(symbol: string, base: number, tMs: number): number {
  const dk = Math.floor(tMs / DAY);
  const f = (tMs - dk * DAY) / DAY;
  const a = dayLog(symbol, dk - 1);
  const b = dayLog(symbol, dk);
  return base * Math.exp(a + (b - a) * f);
}

/**
 * Gera candles de 1 minuto entre `from` e `to` de forma determinística: nível contínuo + ruído que
 * volta à média (Ornstein-Uhlenbeck), para não haver saltos grandes na virada do dia.
 */
function minuteSeries(symbol: string, base: number, from: number, to: number): Candle[] {
  const out: Candle[] = [];
  const start = Math.floor(from / 60_000) * 60_000;
  let dayKey = -1;
  let noise = 0;
  let r = rng(1);
  for (let t = start; t <= to; t += 60_000) {
    const dk = Math.floor(t / DAY);
    if (dk !== dayKey) {
      dayKey = dk;
      noise = 0;
      r = rng(seedOf(symbol) ^ (dk * 7919));
      const minutesIntoDay = Math.floor((t - dk * DAY) / 60_000);
      for (let i = 0; i < minutesIntoDay; i++) noise = 0.97 * noise + 0.0009 * gauss(r);
    }
    const open = level(symbol, base, t) * Math.exp(noise);
    noise = 0.97 * noise + 0.0009 * gauss(r);
    const close = level(symbol, base, t + 60_000) * Math.exp(noise);
    const high = Math.max(open, close) * (1 + Math.abs(0.0004 * gauss(r)));
    const low = Math.min(open, close) * (1 - Math.abs(0.0004 * gauss(r)));
    out.push({ time: t, open, high, low, close, volume: Math.round(50 + 100 * r()) });
  }
  return out;
}

export class SimulatedAdapter implements MarketDataAdapter {
  readonly id = 'sim';
  readonly label = 'Simulador (DEV)';
  readonly market = 'crypto' as const;
  readonly simulated = true;

  constructor(private readonly now: () => number = Date.now) {}

  isConfigured(): boolean {
    return true;
  }

  async searchSymbols(text: string): Promise<SymbolSearchResult[]> {
    const q = text.trim().toUpperCase();
    return SYMBOLS.filter(
      ([s, n]) => s.includes(q) || n.toUpperCase().includes(q) || q === 'SIM',
    ).map(([s, n]) => ({
      id: symbolId(this.id, s),
      symbol: s,
      name: `${n} — SIMULADO`,
      market: this.market,
      sourceLabel: this.label,
    }));
  }

  private base(symbol: string): number {
    const s = SYMBOLS.find(([x]) => x === symbol);
    if (!s) throw new SymbolNotFoundError(this.label, symbol);
    return s[2];
  }

  async getMeta(symbol: string): Promise<SymbolMeta> {
    this.base(symbol);
    return {
      id: symbolId(this.id, symbol),
      symbol,
      name: `${SYMBOLS.find(([x]) => x === symbol)?.[1] ?? symbol} — SIMULADO`,
      market: this.market,
      source: this.id,
      sourceLabel: this.label,
      currency: 'BRL',
      tickSize: 0.01,
      lotSize: 1,
      minQty: 1,
      qtyStep: 1,
      priceDecimals: 2,
      pointValue: 1,
      delay: { kind: 'simulated' },
      volume: 'complete',
      liveVolume: 'complete',
      session: { timezone: 'UTC', days: [0, 1, 2, 3, 4, 5, 6] },
      timeframes: ['1m', '5m', '15m', '30m', '60m', '1d', '1w', '1M'],
      adjusted: 'yes',
      notes: ['DADOS SIMULADOS — não representam nenhum mercado real.'],
    };
  }

  async getCandles(req: CandleRequest): Promise<Candle[]> {
    const base = this.base(req.symbol);
    const now = this.now();
    const limit = req.limit ?? 1000;
    const to = Math.min(req.to ?? now, now);
    if (isIntraday(req.tf)) {
      const span = INTRADAY_MS[req.tf] * limit;
      const mins = minuteSeries(req.symbol, base, req.from ?? to - span, to);
      return aggregate(mins, '1m', req.tf, 'UTC').slice(-limit);
    }
    // Diário: um candle por dia a partir do nível diário (sem gerar todos os minutos).
    const days: Candle[] = [];
    const span = req.tf === '1d' ? limit : req.tf === '1w' ? limit * 7 : limit * 31;
    const firstDay = Math.floor((req.from ?? to - span * DAY) / DAY);
    const lastDay = Math.floor(to / DAY);
    for (let dk = firstDay; dk <= lastDay; dk++) {
      const r = rng(seedOf(req.symbol) ^ (dk * 104729));
      const prev = dayClose(req.symbol, base, dk - 1);
      // abertura perto do fechamento anterior (pequeno gap), fechamento = passeio do dia
      const open = prev * Math.exp(0.002 * gauss(r));
      const close = dayClose(req.symbol, base, dk);
      const high = Math.max(open, close) * (1 + Math.abs(0.006 * gauss(r)));
      const low = Math.min(open, close) * (1 - Math.abs(0.006 * gauss(r)));
      // volume com cauda e maior em dias de movimento grande
      const move = Math.abs(Math.log(close / prev));
      const volume = Math.round(1e5 * Math.exp(0.4 * gauss(r)) * (1 + 20 * move));
      days.push({ time: dk * DAY, open, high, low, close, volume });
    }
    const out = req.tf === '1d' ? days : aggregate(days, '1d', req.tf, 'UTC');
    return out.slice(-limit);
  }

  subscribe(symbol: string, tf: Timeframe, h: SubscribeHandlers): Subscription {
    const base = this.base(symbol);
    h.onStatus({ state: 'ok', message: 'DADOS SIMULADOS' });
    const key = periodKey(tf, 'UTC');
    let forming: Candle | null = null;
    let price = base;
    const r = rng(seedOf(symbol) ^ 42);
    void this.getCandles({ symbol, tf, limit: 1 }).then((c) => {
      forming = c[c.length - 1] ?? null;
      if (forming) price = forming.close;
    });
    const timer = setInterval(() => {
      const t = this.now();
      price *= Math.exp(0.0006 * gauss(r));
      const k = key(t);
      if (forming && k > forming.time) {
        h.onCandle({ candle: { ...forming }, closed: true });
        forming = null;
      }
      if (!forming)
        forming = { time: k, open: price, high: price, low: price, close: price, volume: 0 };
      forming.high = Math.max(forming.high, price);
      forming.low = Math.min(forming.low, price);
      forming.close = price;
      forming.volume += Math.round(5 + 10 * r());
      h.onCandle({ candle: { ...forming }, closed: false });
    }, 1000);
    return { close: () => clearInterval(timer) };
  }
}
