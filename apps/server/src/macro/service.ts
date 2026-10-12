import { BcbClient, SGS, dailyToAnnual252, type SgsPoint } from '@radar/data';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import type { Db } from '../db/client';
import { macroSeries, seriesFetch } from '../db/schema';

const DAY = 86_400_000;
/** Séries diárias do BCB: buscar de novo no máximo a cada 6 h. */
const TTL_MS = 6 * 60 * 60_000;

export interface BrasilPanel {
  selic: { value: number; date: number } | null;
  cdi: {
    /** Taxa do último dia útil (% ao dia). */
    dailyPct: number;
    /** A mesma taxa anualizada (base 252, % ao ano). */
    annualPct: number;
    date: number;
    /** CDI acumulado nos últimos 12 meses e no ano (fração: 0,1 = 10%). */
    acc12m: number | null;
    accYtd: number | null;
  } | null;
  /** 'ok' ou o erro da fonte; com erro, mostramos o último dado válido e a data dele. */
  status: { state: 'ok' | 'error'; message?: string; lastValidAt?: number };
  source: string;
}

/**
 * Selic e CDI do Banco Central (SGS), com cache no banco. Se o BCB falhar, devolve o último dado
 * guardado com o erro e a data (princípio 1: nunca inventar dados).
 */
export class MacroService {
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly db: Db,
    private readonly bcb: BcbClient = new BcbClient(),
    private readonly now: () => number = Date.now,
    /** Espera máxima pelo BCB quando não há nada guardado. */
    private readonly waitMs = 5000,
  ) {}

  private key(code: number) {
    return { symbolId: `bcb:${code}`, tf: 'sgs' };
  }

  private fetchedAt(code: number): { at: number; error: string | null } {
    const k = this.key(code);
    const r = this.db
      .select()
      .from(seriesFetch)
      .where(and(eq(seriesFetch.symbolId, k.symbolId), eq(seriesFetch.tf, k.tf)))
      .get();
    return { at: r?.fetchedAt ?? 0, error: r?.lastError ?? null };
  }

  private mark(code: number, error: string | null): void {
    const k = this.key(code);
    const t = this.now();
    const prev = this.fetchedAt(code);
    const row = error
      ? { ...k, fetchedAt: prev.at, lastError: error, lastErrorAt: t }
      : { ...k, fetchedAt: t, lastError: null, lastErrorAt: null };
    this.db
      .insert(seriesFetch)
      .values(row)
      .onConflictDoUpdate({ target: [seriesFetch.symbolId, seriesFetch.tf], set: row })
      .run();
  }

  private save(code: number, pts: readonly SgsPoint[]): void {
    for (const p of pts) {
      this.db
        .insert(macroSeries)
        .values({ code, date: p.date, value: p.value })
        .onConflictDoUpdate({
          target: [macroSeries.code, macroSeries.date],
          set: { value: p.value },
        })
        .run();
    }
  }

  load(code: number, from = 0, to = Number.MAX_SAFE_INTEGER): SgsPoint[] {
    return this.db
      .select()
      .from(macroSeries)
      .where(
        and(eq(macroSeries.code, code), gte(macroSeries.date, from), lte(macroSeries.date, to)),
      )
      .orderBy(asc(macroSeries.date))
      .all()
      .map((r) => ({ date: r.date, value: r.value }));
  }

  /** Atualiza Selic e CDI se o cache estiver velho (uma busca por vez). */
  async refresh(force = false): Promise<void> {
    if (this.inflight) return this.inflight;
    const t = this.now();
    const stale = (code: number) => force || t - this.fetchedAt(code).at > TTL_MS;
    if (!stale(SGS.SELIC_META) && !stale(SGS.CDI_DIARIO)) return;
    this.inflight = (async () => {
      try {
        const selic = await this.bcb.getLast(SGS.SELIC_META, 5);
        this.save(SGS.SELIC_META, selic);
        this.mark(SGS.SELIC_META, null);
      } catch (err) {
        this.mark(SGS.SELIC_META, (err as Error).message);
      }
      try {
        // CDI dos últimos ~2 anos (para acumulados e comparações com o treino)
        const last = this.load(SGS.CDI_DIARIO).at(-1)?.date;
        const from = last ? last - 10 * DAY : t - 800 * DAY;
        const pts = await this.bcb.getSeries(SGS.CDI_DIARIO, from, t);
        this.save(SGS.CDI_DIARIO, pts);
        this.mark(SGS.CDI_DIARIO, null);
      } catch (err) {
        this.mark(SGS.CDI_DIARIO, (err as Error).message);
      }
    })().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /**
   * Garante o CDI guardado desde `from` (ex.: início de um backtest de 10 anos). Busca só o trecho que
   * falta; se o BCB falhar, segue sem (o laboratório diz que não há CDI para o período).
   */
  async ensureCdiFrom(from: number): Promise<void> {
    const first = this.load(SGS.CDI_DIARIO).at(0)?.date;
    if (first !== undefined && first <= from + 7 * DAY) return;
    const to = first ?? this.now();
    try {
      const pts = await this.bcb.getSeries(SGS.CDI_DIARIO, from, to);
      this.save(SGS.CDI_DIARIO, pts);
    } catch {
      // sem CDI antigo: quem chamou mostra a ausência
    }
  }

  /** CDI acumulado entre duas datas (fração), ou null sem dados que cubram o período. */
  cdiBetween(from: number, to: number): { acc: number; days: number; until: number } | null {
    const pts = this.load(SGS.CDI_DIARIO, from, to);
    if (pts.length === 0) return null;
    const first = this.load(SGS.CDI_DIARIO).at(0)?.date ?? Infinity;
    if (first > from + 7 * DAY) return null; // a série guardada não cobre o começo do período
    let f = 1;
    for (const p of pts) f *= 1 + p.value / 100;
    return { acc: f - 1, days: pts.length, until: pts.at(-1)!.date };
  }

  async brasil(): Promise<BrasilPanel> {
    // com dado guardado, responde já e atualiza em segundo plano (o BCB pode demorar);
    // sem nada guardado, espera no máximo alguns segundos
    const r = this.refresh();
    if (!this.load(SGS.CDI_DIARIO).length) {
      await Promise.race([r, new Promise((ok) => setTimeout(ok, this.waitMs).unref?.())]);
    }
    const t = this.now();
    const selic = this.load(SGS.SELIC_META).at(-1) ?? null;
    const cdiPts = this.load(SGS.CDI_DIARIO);
    const last = cdiPts.at(-1) ?? null;
    const errors = [SGS.SELIC_META, SGS.CDI_DIARIO]
      .map((c) => this.fetchedAt(c).error)
      .filter((e): e is string => Boolean(e));
    const y = new Date(t).getUTCFullYear();
    const yStart = Date.UTC(y, 0, 1);
    return {
      selic: selic ? { value: selic.value, date: selic.date } : null,
      cdi: last
        ? {
            dailyPct: last.value,
            annualPct: dailyToAnnual252(last.value),
            date: last.date,
            acc12m: this.cdiBetween(t - 365 * DAY, t)?.acc ?? null,
            accYtd: this.cdiBetween(yStart, t)?.acc ?? null,
          }
        : null,
      status:
        !last && !errors.length
          ? {
              state: 'error',
              message: 'O Banco Central ainda não respondeu; tente de novo em instantes.',
            }
          : errors.length
            ? {
                state: 'error',
                message: `Banco Central indisponível: ${errors[0]}`,
                ...(last ? { lastValidAt: last.date } : {}),
              }
            : { state: 'ok' },
      source: 'Banco Central do Brasil — SGS (séries 432 e 12)',
    };
  }
}
