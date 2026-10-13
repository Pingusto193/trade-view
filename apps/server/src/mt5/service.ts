import { mt5IngestSchema, type Mt5AgentMode, type Mt5AgentStatus } from '@radar/shared';
import { Mt5Adapter, type AdapterRegistry, type Mt5Store, type Mt5SymbolRecord } from '@radar/data';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { randomToken, sha256 } from '../auth/crypto';
import type { Db } from '../db/client';
import { mt5Symbols, mt5Tokens } from '../db/schema';

/** Erro com código HTTP (o tratador geral do Fastify usa `statusCode`). */
export class Mt5Error extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

export interface Mt5TokenRow {
  id: number;
  userId: number;
  name: string;
}

/** Último estado informado pelo agente, guardado no banco (sobrevive a reinícios). */
interface LastInfo {
  mode: Mt5AgentMode;
  version: string;
  company: string | null;
  terminalConnected: boolean | null;
  detectedOffsetMin: number | null;
  clockLabel: string | null;
  notes: string[];
  errors: string[];
  symbols: string[];
}

function parseInfo(text: string | null): LastInfo | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as LastInfo;
  } catch {
    return null;
  }
}

const MAX_TOKENS = 10;
/** Grava o "visto por último" no banco no máximo a cada 30 s (o agente manda 1 envio por segundo). */
const PERSIST_EVERY_MS = 30_000;

/** Ativos conhecidos no SQLite. */
class DbMt5Store implements Mt5Store {
  constructor(
    private readonly db: Db,
    private readonly now: () => number,
  ) {}

  load(source: string): Mt5SymbolRecord[] {
    const out: Mt5SymbolRecord[] = [];
    for (const r of this.db.select().from(mt5Symbols).where(eq(mt5Symbols.source, source)).all()) {
      try {
        out.push(JSON.parse(r.json) as Mt5SymbolRecord);
      } catch {
        // registro corrompido: ignora (o agente anuncia de novo)
      }
    }
    return out;
  }

  save(source: string, rec: Mt5SymbolRecord): void {
    const json = JSON.stringify(rec);
    const at = this.now();
    this.db
      .insert(mt5Symbols)
      .values({ source, symbol: rec.info.name, tokenId: rec.tokenId, json, updatedAt: at })
      .onConflictDoUpdate({
        target: [mt5Symbols.source, mt5Symbols.symbol],
        set: { tokenId: rec.tokenId, json, updatedAt: at },
      })
      .run();
  }
}

function ensureAdapter(registry: AdapterRegistry, id: string, make: () => Mt5Adapter): Mt5Adapter {
  const a = registry.get(id);
  if (a instanceof Mt5Adapter) return a;
  const n = make();
  registry.register(n);
  return n;
}

/**
 * Agentes MetaTrader 5 (ADR-0023): tokens, ingestão autenticada e estado para a tela de fontes.
 * O agente só LÊ o MT5; o Radar nunca recebe nem guarda a senha da corretora.
 */
export class Mt5Service {
  readonly real: Mt5Adapter;
  /** Adaptador do simulador do agente: só existe em desenvolvimento (RADAR_SIMULATED=1). */
  readonly sim: Mt5Adapter | null;
  private readonly persisted = new Map<number, { at: number; sig: string }>();
  private readonly detected = new Map<number, number | null>();

  constructor(
    private readonly db: Db,
    registry: AdapterRegistry,
    readonly simulatedAllowed: boolean,
    private readonly log: FastifyBaseLogger,
    private readonly now: () => number = Date.now,
  ) {
    this.real = ensureAdapter(registry, 'mt5', () => new Mt5Adapter({ now }));
    this.sim = simulatedAllowed
      ? ensureAdapter(registry, 'mt5sim', () => new Mt5Adapter({ simulated: true, now }))
      : null;
    const store = new DbMt5Store(db, now);
    this.real.attachStore(store);
    this.sim?.attachStore(store);
  }

  // ---------------------------------------------------------------- tokens

  createToken(userId: number, name: string) {
    const active = this.db
      .select({ id: mt5Tokens.id })
      .from(mt5Tokens)
      .where(and(eq(mt5Tokens.userId, userId), isNull(mt5Tokens.revokedAt)))
      .all();
    if (active.length >= MAX_TOKENS) {
      throw new Mt5Error(`Limite de ${MAX_TOKENS} agentes: revogue um antes de criar outro.`);
    }
    const clean = name.trim().slice(0, 60) || 'Agente MT5';
    // prefixo reconhecível: ajuda a achar o token se ele for colado no lugar errado
    const token = `rmt5_${randomToken(24)}`;
    const createdAt = this.now();
    const row = this.db
      .insert(mt5Tokens)
      .values({ userId, name: clean, tokenHash: sha256(token), createdAt })
      .returning({ id: mt5Tokens.id })
      .get();
    return { id: row.id, name: clean, token, createdAt };
  }

  /** Lê `Authorization: Bearer <token>`; devolve o token ativo ou null. */
  authenticate(header: string | undefined): Mt5TokenRow | null {
    const m = /^Bearer\s+(\S{10,200})$/i.exec(header ?? '');
    if (!m?.[1]) return null;
    const row = this.db
      .select({ id: mt5Tokens.id, userId: mt5Tokens.userId, name: mt5Tokens.name })
      .from(mt5Tokens)
      .where(and(eq(mt5Tokens.tokenHash, sha256(m[1])), isNull(mt5Tokens.revokedAt)))
      .get();
    return row ?? null;
  }

  revoke(userId: number, id: number): void {
    const r = this.db
      .update(mt5Tokens)
      .set({ revokedAt: this.now() })
      .where(and(eq(mt5Tokens.id, id), eq(mt5Tokens.userId, userId), isNull(mt5Tokens.revokedAt)))
      .run();
    if (r.changes === 0) throw new Mt5Error('Agente não encontrado.', 404);
    this.real.forgetAgent(id);
    this.sim?.forgetAgent(id);
    this.persisted.delete(id);
    this.detected.delete(id);
  }

  listAgents(userId: number): Mt5AgentStatus[] {
    const rows = this.db
      .select()
      .from(mt5Tokens)
      .where(and(eq(mt5Tokens.userId, userId), isNull(mt5Tokens.revokedAt)))
      .orderBy(asc(mt5Tokens.createdAt))
      .all();
    return rows.map((r) => {
      const info = parseInfo(r.lastInfo);
      const a = this.real.agentLive(r.id);
      const b = this.sim?.agentLive(r.id) ?? null;
      const live = a && b ? (a.lastSeenAt >= b.lastSeenAt ? a : b) : (a ?? b);
      // teste de conexão mais recente que os dados: mostra o teste
      const checkNewer = info?.mode === 'check' && (r.lastSeenAt ?? 0) > (live?.lastSeenAt ?? 0);
      const symbols = live?.symbols.length
        ? live.symbols
        : [...new Set([...this.real.symbolsOf(r.id), ...(this.sim?.symbolsOf(r.id) ?? [])])].sort();
      return {
        id: r.id,
        name: r.name,
        createdAt: r.createdAt,
        lastSeenAt: Math.max(r.lastSeenAt ?? 0, live?.lastSeenAt ?? 0) || null,
        online: Boolean(live?.online) && !checkNewer,
        mode: checkNewer ? 'check' : (live?.mode ?? info?.mode ?? null),
        version: live?.version ?? info?.version ?? null,
        company: live?.company || info?.company || null,
        terminalConnected: live?.terminalConnected ?? info?.terminalConnected ?? null,
        symbols,
        clock: live?.clockLabel ?? info?.clockLabel ?? null,
        notes: live?.notes ?? info?.notes ?? [],
        errors: live?.errors ?? info?.errors ?? [],
      };
    });
  }

  // ---------------------------------------------------------------- ingestão

  private storedDetected(tokenId: number): number | null {
    if (this.detected.has(tokenId)) return this.detected.get(tokenId) ?? null;
    const row = this.db
      .select({ lastInfo: mt5Tokens.lastInfo })
      .from(mt5Tokens)
      .where(eq(mt5Tokens.id, tokenId))
      .get();
    const v = parseInfo(row?.lastInfo ?? null)?.detectedOffsetMin ?? null;
    this.detected.set(tokenId, v);
    return v;
  }

  private persist(tokenId: number, info: LastInfo, now: number, force = false): void {
    const sig = JSON.stringify(info);
    const prev = this.persisted.get(tokenId);
    if (!force && prev && prev.sig === sig && now - prev.at < PERSIST_EVERY_MS) return;
    this.persisted.set(tokenId, { at: now, sig });
    this.db
      .update(mt5Tokens)
      .set({ lastSeenAt: now, lastInfo: sig })
      .where(eq(mt5Tokens.id, tokenId))
      .run();
  }

  /** Processa um envio já autenticado. Devolve o código HTTP e o corpo da resposta. */
  ingest(tok: Mt5TokenRow, body: unknown): { status: number; body: object } {
    const parsed = mt5IngestSchema.safeParse(body);
    if (!parsed.success) {
      const why = parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.') || 'corpo'}: ${i.message}`)
        .join('; ');
      return { status: 400, body: { error: `Envio inválido do agente MT5 — ${why}` } };
    }
    const msg = parsed.data;
    const now = this.now();
    if (msg.agent.mode === 'check') {
      this.persist(
        tok.id,
        {
          mode: 'check',
          version: msg.agent.version,
          company: msg.agent.company ?? null,
          terminalConnected: null,
          detectedOffsetMin: this.storedDetected(tok.id),
          clockLabel: null,
          notes: [],
          errors: msg.errors.map((e) => e.message),
          symbols: [],
        },
        now,
        true, // teste de conexão sempre grava
      );
      return {
        status: 200,
        body: {
          ok: true,
          serverTime: now,
          wants: [],
          history: [],
          messages: [`Conexão com o Radar OK (agente "${tok.name}"; teste sem dados).`],
        },
      };
    }
    let adapter = this.real;
    if (msg.agent.mode === 'simulated') {
      if (!this.sim) {
        return {
          status: 403,
          body: {
            error:
              'Este Radar recusa DADOS SIMULADOS: o simulador do agente só é aceito num Radar de ' +
              'desenvolvimento (RADAR_SIMULATED=1). Rode o agente com o MetaTrader 5 de verdade, ou ' +
              'use --check para só testar a conexão.',
          },
        };
      }
      adapter = this.sim;
    }
    const res = adapter.ingest({ id: tok.id, name: tok.name }, msg, this.storedDetected(tok.id));
    if (msg.agent.detectedOffsetMin !== null)
      this.detected.set(tok.id, msg.agent.detectedOffsetMin);
    const live = adapter.agentLive(tok.id);
    if (live) {
      this.persist(
        tok.id,
        {
          mode: live.mode,
          version: live.version,
          company: live.company || null,
          terminalConnected: live.terminalConnected,
          detectedOffsetMin: live.detectedOffsetMin,
          clockLabel: live.clockLabel,
          notes: live.notes,
          errors: live.errors,
          symbols: live.symbols,
        },
        now,
      );
    }
    for (const m of res.messages) this.log.debug({ agent: tok.name }, `agente MT5: ${m}`);
    return { status: 200, body: res };
  }

  close(): void {
    this.real.close();
    this.sim?.close();
  }
}
