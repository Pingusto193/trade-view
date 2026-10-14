import type {
  Candle,
  FeedStatus,
  Mt5Ingest,
  Mt5IngestResponse,
  Mt5Rate,
  Mt5SymbolInfo,
  Mt5Timeframe,
  Session,
  SymbolMeta,
  SymbolSearchResult,
  Timeframe,
} from '@radar/shared';
import { MT5_MAX_HISTORY, MT5_TIMEFRAMES, formatDateTime, isIntraday } from '@radar/shared';
import {
  DAY_MS,
  aggregateBy,
  isPeriodClosed,
  monthStart,
  sanitizeCandles,
  upsertCandle,
  weekStart,
} from '@radar/core';
import {
  DataSourceError,
  SymbolNotFoundError,
  symbolId,
  type CandleRequest,
  type MarketDataAdapter,
  type SubscribeHandlers,
  type Subscription,
} from '../types';
import { B3_EQUITY_SESSION, B3_HOLIDAYS_2026 } from './b3-calendar';
import {
  forexSession,
  resolveClock,
  serverWallToUtc,
  type Mt5Clock,
  type ResolvedClock,
} from './mt5-clock';

/**
 * MetaTrader 5 pelo agente `agents/mt5-bridge` (SPEC §6, ADR-0023; fatos em DATA_SOURCES §16).
 *
 * O agente roda no PC Windows do usuário, lê o MT5 (só leitura) e faz POST no servidor; este adaptador
 * guarda o que chegou, responde ao gráfico e repassa o tempo real. Sem agente conectado, nunca inventa:
 * `getCandles` falha com a data do último contato e o servidor devolve o cache com o erro.
 *
 * - B3 (ações e futuros como WIN/WDO): volume `real_volume` quando a corretora manda; senão tick volume.
 * - Forex: volume é TICK VOLUME (número de mudanças de preço na corretora), nunca volume negociado.
 * - Semanal e mensal são montados a partir do diário (semana começa na segunda, ADR-0006).
 */

export type Mt5Market = 'b3' | 'forex';
export type Mt5VolumeKind = 'real' | 'tick';

/** O que fica guardado de cada ativo (sobrevive a reinícios do servidor). */
export interface Mt5SymbolRecord {
  info: Mt5SymbolInfo;
  tokenId: number;
  agentName: string;
  company: string;
  market: Mt5Market;
  volumeKind: Mt5VolumeKind;
  clock: Mt5Clock;
  clockLabel: string;
  clockNotes: string[];
  /** Último dado recebido deste ativo (UTC ms). */
  seenAt: number;
}

/** Persistência dos ativos conhecidos (o servidor implementa com o SQLite). */
export interface Mt5Store {
  load(source: string): Mt5SymbolRecord[];
  save(source: string, rec: Mt5SymbolRecord): void;
}

export interface Mt5AgentToken {
  id: number;
  name: string;
}

/** Estado público de um agente (para a tela Fontes de dados). */
export interface Mt5AgentLive {
  online: boolean;
  lastSeenAt: number;
  mode: 'mt5' | 'simulated';
  version: string;
  company: string;
  terminalConnected: boolean;
  detectedOffsetMin: number | null;
  clockLabel: string;
  notes: string[];
  symbols: string[];
  errors: string[];
}

interface AgentState {
  token: Mt5AgentToken;
  mode: 'mt5' | 'simulated';
  version: string;
  company: string;
  terminalConnected: boolean;
  lastSeenAt: number;
  detected: number | null;
  clock: ResolvedClock;
  symbols: Set<string>;
  errors: string[];
}

interface Waiter {
  resolve: () => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface Pending {
  symbol: string;
  tf: Mt5Timeframe;
  count: number;
  /** Quantidade que já foi pedida ao agente na última resposta. */
  askedCount: number;
  waiters: Waiter[];
}

interface LiveState {
  lastClosed: Candle | null;
  lastForming: Candle | null;
}

const BASE: Readonly<Record<Timeframe, Mt5Timeframe>> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '60m': '60m',
  '1d': '1d',
  '1w': '1d',
  '1M': '1d',
};

const key = (symbol: string, tf: string) => `${symbol}|${tf}`;

/** Janela larga para os futuros da B3 (❌ não verificada; DATA_SOURCES §16). */
export const B3_FUTURES_SESSION: Session = {
  timezone: 'America/Sao_Paulo',
  days: [1, 2, 3, 4, 5],
  open: '09:00',
  close: '18:30',
  holidays: [...B3_HOLIDAYS_2026],
};

const SIM_SESSION: Session = { timezone: 'UTC', days: [0, 1, 2, 3, 4, 5, 6] };

// modos de cálculo do MT5 (`trade_calc_mode`, DATA_SOURCES §16)
const CALC_FOREX = 0;
const CALC_FUTURES = 1;
const CALC_FOREX_NO_LEVERAGE = 5;
const CALC_EXCH_STOCKS = 32;
const CALC_EXCH_FUTURES = 33;

/** Mercado do ativo: configuração do agente, senão modo de cálculo, bolsa e moeda. */
export function inferMt5Market(info: Mt5SymbolInfo): Mt5Market {
  if (info.market !== 'auto') return info.market;
  const m = info.trade_calc_mode;
  if (m === CALC_FOREX || m === CALC_FOREX_NO_LEVERAGE) return 'forex';
  if (/BOVESPA|BMF|BM&F|\bB3\b/i.test(`${info.exchange} ${info.path}`)) return 'b3';
  if (info.currency_profit.toUpperCase() === 'BRL') return 'b3';
  return 'forex';
}

export function isB3Future(info: Mt5SymbolInfo): boolean {
  const m = info.trade_calc_mode;
  if (m === CALC_FUTURES || m === CALC_EXCH_FUTURES) return true;
  if (m === CALC_EXCH_STOCKS) return false;
  return /^(WIN|WDO|IND|DOL|BGI|CCM|ICF|SFI|DI1|WSP|ISP)/i.test(info.name);
}

/** Par de moedas de verdade (não CFD): não negocia no sábado e a barra de domingo vai para a semana seguinte. */
function isCurrencyPair(rec: Mt5SymbolRecord): boolean {
  const m = rec.info.trade_calc_mode;
  return rec.market === 'forex' && (m === CALC_FOREX || m === CALC_FOREX_NO_LEVERAGE);
}

function sameCandle(a: Candle, b: Candle): boolean {
  return (
    a.time === b.time &&
    a.open === b.open &&
    a.high === b.high &&
    a.low === b.low &&
    a.close === b.close &&
    a.volume === b.volume
  );
}

/** Converte barras cruas do MT5 em candles do Radar (UTC, ADR-0006), com o volume escolhido. */
export function mt5RatesToCandles(
  rates: readonly Mt5Rate[],
  tf: Mt5Timeframe,
  clock: Mt5Clock,
  volumeKind: Mt5VolumeKind,
): Candle[] {
  const daily = tf === '1d';
  const out: Candle[] = rates.map((r) => ({
    // diário: a data do servidor é a data do pregão → meia-noite UTC dessa data
    time: daily ? Math.floor(r[0] / 86_400) * DAY_MS : serverWallToUtc(r[0] * 1000, clock),
    open: r[1],
    high: r[2],
    low: r[3],
    close: r[4],
    volume: volumeKind === 'real' ? r[7] : r[5],
  }));
  return sanitizeCandles(out);
}

/** Sessão usada no meta (estado do mercado e "o candle já fechou?"). */
export function mt5Session(rec: Mt5SymbolRecord, simulated: boolean, now: number): Session {
  if (simulated) return SIM_SESSION;
  if (rec.market === 'b3') return isB3Future(rec.info) ? B3_FUTURES_SESSION : B3_EQUITY_SESSION;
  return forexSession(rec.clock, now).session;
}

/** Metadados de um ativo do MT5 (fonte, atraso, volume, sessão e tamanho de contrato). */
export function buildMt5Meta(
  source: string,
  label: string,
  rec: Mt5SymbolRecord,
  simulated: boolean,
  now: number,
): SymbolMeta {
  const i = rec.info;
  const tickSize = i.trade_tick_size > 0 ? i.trade_tick_size : i.point;
  const notes: string[] = [];
  if (simulated) {
    notes.push(
      'DADOS SIMULADOS — gerados pelo simulador do agente MT5; não representam nenhum mercado real.',
    );
  }
  let currency: string;
  let pointValue: number;
  let session = mt5Session(rec, simulated, now);
  if (rec.market === 'forex') {
    currency = i.currency_profit || 'USD';
    pointValue = i.trade_contract_size > 0 ? i.trade_contract_size : 1;
    notes.push(
      'Forex pelo MetaTrader 5 da sua corretora (mercado de balcão): o preço é o da corretora, não o de uma bolsa.',
      'Volume = TICK VOLUME: quantas vezes o preço mudou na corretora. NÃO é volume negociado. As regras de volume dos setups usam esse número: desconfie delas no forex.',
      `Quantidade em lotes (1 lote = ${pointValue.toLocaleString('pt-BR')} ${i.currency_base || 'unidades'}).`,
    );
    if (!simulated && !forexSession(rec.clock, now).exact) {
      notes.push(
        'O fuso do servidor não é uma hora cheia: o "dia" do candle diário pode não bater com a sessão.',
      );
    }
  } else {
    const future = isB3Future(i);
    currency = i.currency_profit || 'BRL';
    pointValue = future && i.trade_tick_value > 0 ? i.trade_tick_value / tickSize : 1;
    notes.push(
      'B3 pelo MetaTrader 5 da sua corretora: só atualiza com o PC ligado, o MT5 aberto e o agente rodando.',
      'Confirme com a corretora se os dados da B3 no seu MT5 são em tempo real (não verificado pelo Radar).',
      rec.volumeKind === 'real'
        ? 'Volume real informado pela corretora (não conferido com a B3).'
        : 'A corretora não manda volume real deste ativo: o volume mostrado é TICK VOLUME, não quantidade negociada.',
      future
        ? 'Horário do pregão de futuros aproximado (09:00–18:30, não verificado na B3).'
        : 'Horário e feriados da B3 não verificados na fonte oficial.',
      'Preços como o MT5 entrega, sem ajuste por proventos garantido.',
    );
  }
  if (simulated) session = SIM_SESSION;
  if (rec.company) notes.push(`Corretora: ${rec.company}.`);
  if (!simulated) {
    notes.push(`Horário do servidor da corretora: ${rec.clockLabel}.`, ...rec.clockNotes);
  }
  notes.push('Atraso típico de 1 a 3 s (o agente consulta o MT5 a cada segundo).');
  const step = i.volume_step > 0 ? i.volume_step : rec.market === 'forex' ? 0.01 : 1;
  const min = i.volume_min > 0 ? i.volume_min : step;
  const volume = rec.market === 'forex' || rec.volumeKind === 'tick' ? 'tick' : 'complete';
  return {
    id: symbolId(source, i.name),
    symbol: i.name,
    name: `${i.description || i.name}${simulated ? ' — SIMULADO' : ''}`,
    market: rec.market,
    source,
    sourceLabel: label,
    currency,
    tickSize,
    lotSize: rec.market === 'forex' ? 1 : min,
    minQty: min,
    qtyStep: step,
    priceDecimals: i.digits,
    pointValue,
    delay: simulated ? { kind: 'simulated' } : { kind: 'realtime' },
    volume,
    liveVolume: volume,
    session,
    timeframes: ['1m', '5m', '15m', '30m', '60m', '1d', '1w', '1M'],
    adjusted: 'unknown',
    notes,
  };
}

export interface Mt5AdapterOptions {
  /** 'mt5' (dados reais) ou 'mt5sim' (simulador do agente, só em desenvolvimento). */
  id?: string;
  simulated?: boolean;
  now?: () => number;
  /** Sem contato do agente por mais que isto = desconectado (padrão 15 s). */
  staleMs?: number;
  /** Tempo máximo esperando um histórico pedido ao agente (padrão 20 s). */
  historyTimeoutMs?: number;
}

export class Mt5Adapter implements MarketDataAdapter {
  readonly id: string;
  readonly label: string;
  readonly market = 'b3' as const;
  readonly simulated: boolean;
  /** O meta muda com o estado do agente (corretora, fuso, volume): o servidor renova a cada minuto. */
  readonly metaTtlMs = 60_000;
  private readonly now: () => number;
  private readonly staleMs: number;
  private readonly historyTimeoutMs: number;
  private store: Mt5Store | null = null;
  private readonly records = new Map<string, Mt5SymbolRecord>();
  private readonly agents = new Map<number, AgentState>();
  /** Séries recebidas: ativo|escala do MT5. */
  private readonly series = new Map<string, Candle[]>();
  /** Maior histórico já pedido e recebido: ativo|escala do MT5. */
  private readonly historyCount = new Map<string, number>();
  private readonly pending = new Map<string, Pending>();
  /** Escalas do MT5 que o Radar acompanha agora (contagem de assinaturas). */
  private readonly wants = new Map<string, number>();
  /** Assinantes: ativo|escala do Radar. */
  private readonly subs = new Map<string, Set<SubscribeHandlers>>();
  private readonly live = new Map<string, LiveState>();
  private readonly lastStatus = new Map<string, string>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: Mt5AdapterOptions = {}) {
    this.simulated = Boolean(opts.simulated);
    this.id = opts.id ?? (this.simulated ? 'mt5sim' : 'mt5');
    this.label = this.simulated ? 'MT5 simulado (DEV)' : 'MetaTrader 5';
    this.now = opts.now ?? Date.now;
    this.staleMs = opts.staleMs ?? 15_000;
    this.historyTimeoutMs = opts.historyTimeoutMs ?? 20_000;
  }

  /** Liga a persistência e recarrega os ativos conhecidos (para mostrar o cache com o erro honesto). */
  attachStore(store: Mt5Store): void {
    this.store = store;
    for (const rec of store.load(this.id)) {
      if (!this.records.has(rec.info.name)) this.records.set(rec.info.name, rec);
    }
  }

  isConfigured(): boolean {
    return this.records.size > 0 || this.agents.size > 0;
  }

  private online(tokenId: number, now: number): boolean {
    const a = this.agents.get(tokenId);
    return Boolean(a && now - a.lastSeenAt <= this.staleMs);
  }

  private offlineMessage(rec: Mt5SymbolRecord): string {
    const last = this.agents.get(rec.tokenId)?.lastSeenAt ?? rec.seenAt;
    return (
      `Agente MT5 "${rec.agentName}" sem contato desde ${formatDateTime(last)}: confira se o PC está ` +
      'ligado, o MetaTrader 5 aberto e o agente rodando (docs/GUIA_MT5.md).'
    );
  }

  private statusFor(symbol: string, now: number): FeedStatus {
    const rec = this.records.get(symbol);
    if (!rec) {
      return {
        state: 'error',
        message: `${symbol} não é oferecido por nenhum agente MT5 conectado.`,
      };
    }
    const lastValidAt = rec.seenAt;
    const a = this.agents.get(rec.tokenId);
    if (!a || now - a.lastSeenAt > this.staleMs) {
      return { state: 'error', message: this.offlineMessage(rec), lastValidAt };
    }
    if (!a.terminalConnected) {
      return {
        state: 'error',
        message: 'O MetaTrader 5 no PC está fechado ou sem conexão com a corretora.',
        lastValidAt,
      };
    }
    return {
      state: 'ok',
      message: this.simulated
        ? 'DADOS SIMULADOS (simulador do agente MT5)'
        : `Tempo real pelo MetaTrader 5${a.company ? ` (${a.company})` : ''}`,
      lastValidAt,
    };
  }

  /** Avisa os assinantes quando o estado muda (ex.: o agente parou de mandar dados). */
  refreshStatuses(now = this.now()): void {
    for (const [sk, hs] of this.subs) {
      const symbol = sk.slice(0, sk.lastIndexOf('|'));
      const s = this.statusFor(symbol, now);
      const sig = `${s.state}|${s.message ?? ''}`;
      if (this.lastStatus.get(sk) === sig) continue;
      this.lastStatus.set(sk, sig);
      for (const h of hs) h.onStatus(s);
    }
  }

  private ensureTimer(): void {
    if (this.timer || this.subs.size === 0) return;
    this.timer = setInterval(() => this.refreshStatuses(), 5_000);
    this.timer.unref?.();
  }

  private stopTimerIfIdle(): void {
    if (this.timer && this.subs.size === 0) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Esquece um agente (token revogado). */
  forgetAgent(tokenId: number): void {
    this.agents.delete(tokenId);
    this.refreshStatuses();
  }

  agentLive(tokenId: number): Mt5AgentLive | null {
    const a = this.agents.get(tokenId);
    if (!a) return null;
    return {
      online: this.online(tokenId, this.now()),
      lastSeenAt: a.lastSeenAt,
      mode: a.mode,
      version: a.version,
      company: a.company,
      terminalConnected: a.terminalConnected,
      detectedOffsetMin: a.detected,
      clockLabel: a.clock.label,
      notes: [...a.clock.notes],
      symbols: [...a.symbols].sort(),
      errors: [...a.errors],
    };
  }

  /** Ativos que vieram de um token (inclusive os guardados de antes do reinício). */
  symbolsOf(tokenId: number): string[] {
    return [...this.records.values()]
      .filter((r) => r.tokenId === tokenId)
      .map((r) => r.info.name)
      .sort();
  }

  // ---------------------------------------------------------------- ingestão (POST do agente)

  /**
   * Processa um envio do agente. `token` já foi autenticado pelo servidor e `msg` validado (zod);
   * envios de teste de conexão (`mode: 'check'`) não chegam aqui.
   * @param lastDetected diferença de fuso medida antes (guardada no banco), usada se o envio não trouxer.
   */
  ingest(
    token: Mt5AgentToken,
    msg: Mt5Ingest,
    lastDetected: number | null = null,
  ): Mt5IngestResponse {
    const now = this.now();
    const messages: string[] = [];
    const dirty = new Set<Mt5SymbolRecord>();
    let agent = this.agents.get(token.id);
    const reconnect = !agent || now - agent.lastSeenAt > this.staleMs;
    if (!agent) {
      agent = {
        token,
        mode: 'mt5',
        version: '',
        company: '',
        terminalConnected: false,
        lastSeenAt: now,
        detected: lastDetected,
        clock: resolveClock('auto', null, false, now),
        symbols: new Set(this.symbolsOf(token.id)),
        errors: [],
      };
      this.agents.set(token.id, agent);
    }
    agent.token = token;
    agent.mode = msg.agent.mode === 'simulated' ? 'simulated' : 'mt5';
    agent.version = msg.agent.version;
    if (msg.agent.company !== undefined) agent.company = msg.agent.company;
    agent.terminalConnected = msg.agent.terminalConnected;
    agent.lastSeenAt = now;
    agent.errors = msg.errors.map((e) => (e.symbol ? `${e.symbol}: ${e.message}` : e.message));
    if (msg.agent.detectedOffsetMin !== null) agent.detected = msg.agent.detectedOffsetMin;

    // 1) ativos anunciados
    if (msg.symbols) {
      agent.symbols = new Set();
      for (const info of msg.symbols) {
        const cur = this.records.get(info.name);
        if (cur && cur.tokenId !== token.id && this.online(cur.tokenId, now)) {
          messages.push(
            `${info.name}: já chega por outro agente ("${cur.agentName}"); ignorado aqui.`,
          );
          continue;
        }
        agent.symbols.add(info.name);
        const market = inferMt5Market(info);
        const rec: Mt5SymbolRecord = {
          info,
          tokenId: token.id,
          agentName: token.name,
          company: agent.company,
          market,
          volumeKind:
            cur && cur.market === market ? cur.volumeKind : market === 'b3' ? 'real' : 'tick',
          clock: agent.clock.clock,
          clockLabel: agent.clock.label,
          clockNotes: agent.clock.notes,
          seenAt: cur?.seenAt ?? now,
        };
        if (cur && cur.tokenId !== token.id) this.dropSeries(info.name); // outro terminal, outra série
        this.records.set(info.name, rec);
        dirty.add(rec);
      }
    }

    // 2) relógio do servidor da corretora
    const mine = [...this.records.values()].filter((r) => r.tokenId === token.id);
    const b3 = mine.filter((r) => r.market === 'b3').length;
    agent.clock = resolveClock(
      msg.agent.serverTz,
      agent.detected,
      mine.length > 0 && b3 * 2 >= mine.length,
      now,
    );
    for (const r of mine) {
      if (r.clockLabel !== agent.clock.label || r.company !== agent.company) {
        r.clock = agent.clock.clock;
        r.clockLabel = agent.clock.label;
        r.clockNotes = agent.clock.notes;
        r.company = agent.company;
        dirty.add(r);
      }
    }

    // 3) depois de um tempo sem contato, os históricos em memória podem ter buracos: pede de novo
    if (reconnect) {
      for (const r of mine) {
        for (const tf of MT5_TIMEFRAMES) this.historyCount.delete(key(r.info.name, tf));
      }
    }

    // 4) barras
    for (const b of msg.bars) {
      const rec = this.records.get(b.symbol);
      if (!rec || rec.tokenId !== token.id) {
        messages.push(`${b.symbol}: ativo não anunciado por este agente; barras ignoradas.`);
        continue;
      }
      if (b.history && rec.market === 'b3' && b.rates.length >= 10) {
        const kind: Mt5VolumeKind = b.rates.some((r) => r[7] > 0) ? 'real' : 'tick';
        if (kind !== rec.volumeKind) {
          rec.volumeKind = kind;
          this.dropSeries(b.symbol); // as outras escalas vieram com o outro volume
          dirty.add(rec);
        }
      }
      const candles = mt5RatesToCandles(b.rates, b.tf, rec.clock, rec.volumeKind);
      const k = key(b.symbol, b.tf);
      if (b.history) {
        this.series.set(k, candles.slice(-MT5_MAX_HISTORY));
        const p = this.pending.get(k);
        this.historyCount.set(
          k,
          Math.max(this.historyCount.get(k) ?? 0, p?.askedCount || b.rates.length),
        );
        if (p) {
          this.pending.delete(k);
          for (const w of p.waiters) {
            clearTimeout(w.timer);
            w.resolve();
          }
        }
      } else {
        const s = this.series.get(k) ?? [];
        for (const c of candles) upsertCandle(s, c);
        if (s.length > MT5_MAX_HISTORY * 1.1) s.splice(0, s.length - MT5_MAX_HISTORY);
        this.series.set(k, s);
        this.emitLive(rec, b.tf, candles, now);
      }
      if (candles.length) rec.seenAt = now;
    }

    // 5) assinantes recarregam o que pode ter faltado
    if (reconnect) {
      for (const r of mine) {
        for (const tf of Object.keys(BASE)) {
          for (const h of this.subs.get(key(r.info.name, tf)) ?? []) h.onReconnect?.();
        }
      }
    }
    this.refreshStatuses(now);
    for (const r of dirty) this.store?.save(this.id, r);

    // 6) o que o Radar quer deste agente
    const wants: Mt5IngestResponse['wants'] = [];
    for (const [k, n] of this.wants) {
      if (n <= 0) continue;
      const i = k.lastIndexOf('|');
      const symbol = k.slice(0, i);
      if (this.records.get(symbol)?.tokenId === token.id) {
        wants.push({ symbol, tf: k.slice(i + 1) as Mt5Timeframe });
      }
    }
    const history: Mt5IngestResponse['history'] = [];
    for (const p of this.pending.values()) {
      if (this.records.get(p.symbol)?.tokenId !== token.id) continue;
      p.askedCount = p.count;
      history.push({ symbol: p.symbol, tf: p.tf, count: p.count });
    }
    return { ok: true, serverTime: now, wants, history, messages };
  }

  private dropSeries(symbol: string): void {
    for (const tf of MT5_TIMEFRAMES) {
      this.series.delete(key(symbol, tf));
      this.historyCount.delete(key(symbol, tf));
    }
  }

  // ---------------------------------------------------------------- tempo real

  /** Semanal/mensal a partir do diário (semana na segunda; barra de domingo do forex vai para a seguinte). */
  private aggregateDaily(
    rec: Mt5SymbolRecord,
    daily: readonly Candle[],
    tf: '1w' | '1M',
  ): Candle[] {
    const shiftSunday = isCurrencyPair(rec);
    return aggregateBy(daily, (t) => {
      const d = shiftSunday && new Date(t).getUTCDay() === 0 ? t + DAY_MS : t;
      return tf === '1w' ? weekStart(d) : monthStart(d);
    });
  }

  private emitLive(rec: Mt5SymbolRecord, tf: Mt5Timeframe, candles: Candle[], now: number): void {
    const symbol = rec.info.name;
    const targets: Timeframe[] = tf === '1d' ? ['1d', '1w', '1M'] : [tf];
    let session: Session | null = null;
    for (const t of targets) {
      const hs = this.subs.get(key(symbol, t));
      if (!hs?.size) continue;
      session ??= mt5Session(rec, this.simulated, now);
      let list = candles;
      if (t === '1w' || t === '1M') {
        const daily = this.series.get(key(symbol, '1d')) ?? [];
        list = this.aggregateDaily(rec, daily.slice(-80), t).slice(-2);
      }
      this.emitList(key(symbol, t), t, list, session, hs, now);
    }
  }

  /**
   * Repassa as barras: as anteriores à última estão fechadas; a última fecha quando o período dela
   * acabou pela sessão (com folga de 3 s no intradiário e 15 min no diário+, para não fechar antes do
   * último negócio). Candle fechado repetido e idêntico não é reenviado.
   */
  private emitList(
    sk: string,
    tf: Timeframe,
    list: readonly Candle[],
    session: Session,
    hs: ReadonlySet<SubscribeHandlers>,
    now: number,
  ): void {
    let st = this.live.get(sk);
    if (!st) {
      st = { lastClosed: null, lastForming: null };
      this.live.set(sk, st);
    }
    const grace = isIntraday(tf) ? 3_000 : 15 * 60_000;
    list.forEach((c, i) => {
      const closed = i < list.length - 1 || isPeriodClosed(tf, c.time, session, now - grace);
      const lc = st.lastClosed;
      if (closed) {
        if (lc && (c.time < lc.time || (c.time === lc.time && sameCandle(c, lc)))) return;
        st.lastClosed = c;
      } else {
        if (lc && c.time <= lc.time) return; // não reabre um candle já fechado
        if (st.lastForming && sameCandle(st.lastForming, c)) return;
        st.lastForming = c;
      }
      for (const h of hs) h.onCandle({ candle: { ...c }, closed });
    });
  }

  // ---------------------------------------------------------------- interface de fonte

  async searchSymbols(text: string): Promise<SymbolSearchResult[]> {
    const q = text.trim().toUpperCase();
    const now = this.now();
    const out: (SymbolSearchResult & { on: boolean })[] = [];
    for (const rec of this.records.values()) {
      const name = rec.info.name.toUpperCase();
      const desc = rec.info.description.toUpperCase();
      const byWord = q === 'MT5' || (q === 'FOREX' && rec.market === 'forex');
      if (q && !byWord && !name.includes(q) && !desc.includes(q)) continue;
      const on = this.online(rec.tokenId, now);
      out.push({
        id: symbolId(this.id, rec.info.name),
        symbol: rec.info.name,
        name:
          `${rec.info.description || rec.info.name}${this.simulated ? ' — SIMULADO' : ''}` +
          (on ? '' : ' · agente MT5 desconectado'),
        market: rec.market,
        sourceLabel: this.label,
        on,
      });
    }
    out.sort((a, b) => Number(b.on) - Number(a.on) || a.symbol.localeCompare(b.symbol));
    return out.slice(0, 30).map(({ on: _on, ...r }) => r);
  }

  async getMeta(symbol: string): Promise<SymbolMeta> {
    const rec = this.records.get(symbol);
    if (!rec) throw new SymbolNotFoundError(this.label, symbol);
    return buildMt5Meta(this.id, this.label, rec, this.simulated, this.now());
  }

  private requestHistory(rec: Mt5SymbolRecord, tf: Mt5Timeframe, count: number): Promise<void> {
    const symbol = rec.info.name;
    const k = key(symbol, tf);
    return new Promise<void>((resolve, reject) => {
      let p = this.pending.get(k);
      if (!p) {
        p = { symbol, tf, count, askedCount: 0, waiters: [] };
        this.pending.set(k, p);
      } else p.count = Math.max(p.count, count);
      const pend = p;
      const w: Waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          pend.waiters = pend.waiters.filter((x) => x !== w);
          if (!pend.waiters.length && this.pending.get(k) === pend) this.pending.delete(k);
          reject(
            new DataSourceError(
              `O agente MT5 não mandou o histórico de ${symbol} (${tf}) a tempo.`,
              this.label,
            ),
          );
        }, this.historyTimeoutMs),
      };
      w.timer.unref?.();
      pend.waiters.push(w);
    });
  }

  async getCandles(req: CandleRequest): Promise<Candle[]> {
    const rec = this.records.get(req.symbol);
    if (!rec) throw new SymbolNotFoundError(this.label, req.symbol);
    // Agente fora do ar: nunca serve a memória como se fosse atual (o servidor usa o cache com o erro).
    if (!this.online(rec.tokenId, this.now())) {
      throw new DataSourceError(this.offlineMessage(rec), this.label);
    }
    const base = BASE[req.tf];
    const k = key(req.symbol, base);
    const limit = Math.max(1, req.limit ?? 1500);
    const need = Math.min(
      MT5_MAX_HISTORY,
      base === req.tf ? limit : req.tf === '1w' ? limit * 7 + 7 : limit * 31 + 31,
    );
    for (let attempt = 0; attempt < 2 && (this.historyCount.get(k) ?? 0) < need; attempt++) {
      await this.requestHistory(rec, base, need);
    }
    const s = this.series.get(k) ?? [];
    let out = req.tf === '1w' || req.tf === '1M' ? this.aggregateDaily(rec, s, req.tf) : s;
    if (req.from !== undefined) out = out.filter((c) => c.time >= (req.from as number));
    if (req.to !== undefined) out = out.filter((c) => c.time <= (req.to as number));
    return out.slice(-limit).map((c) => ({ ...c }));
  }

  subscribe(symbol: string, tf: Timeframe, h: SubscribeHandlers): Subscription {
    const wk = key(symbol, BASE[tf]);
    this.wants.set(wk, (this.wants.get(wk) ?? 0) + 1);
    const sk = key(symbol, tf);
    let set = this.subs.get(sk);
    if (!set) {
      set = new Set();
      this.subs.set(sk, set);
    }
    set.add(h);
    h.onStatus(this.statusFor(symbol, this.now()));
    this.ensureTimer();
    let done = false;
    const subs = set;
    return {
      close: () => {
        if (done) return;
        done = true;
        subs.delete(h);
        if (!subs.size) {
          this.subs.delete(sk);
          this.live.delete(sk);
          this.lastStatus.delete(sk);
        }
        const n = (this.wants.get(wk) ?? 1) - 1;
        if (n <= 0) this.wants.delete(wk);
        else this.wants.set(wk, n);
        this.stopTimerIfIdle();
      },
    };
  }

  /** Encerra (servidor desligando): para o relógio e recusa os históricos pendentes. */
  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const p of this.pending.values()) {
      for (const w of p.waiters) {
        clearTimeout(w.timer);
        w.reject(new DataSourceError('servidor encerrando', this.label));
      }
    }
    this.pending.clear();
  }
}
