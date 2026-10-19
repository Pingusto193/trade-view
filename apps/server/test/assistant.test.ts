import Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { costUsd, monthKey, type AnthropicLike } from '../src/assistant/service';
import { assistantSettings, assistantUsage } from '../src/db/schema';
import { testApp } from './helpers';

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

const NOW = Date.UTC(2026, 9, 14, 15);
type Req = Record<string, unknown>;

function fakeClient(
  reply: (req: Req) => unknown,
  calls: { req: Req; key: string }[],
): (key: string) => AnthropicLike {
  return (key) =>
    ({
      beta: {
        messages: {
          create: async (req: Req) => {
            calls.push({ req, key });
            return reply(req);
          },
        },
      },
      models: {
        list: () =>
          (async function* () {
            yield { id: 'claude-opus-5-5' };
            yield { id: 'claude-sonnet-5-5' };
          })(),
      },
    }) as unknown as AnthropicLike;
}

const message = (over: Req = {}) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content: [
    { type: 'text', text: 'Amostra pequena: 12 trades não dizem nada. Compare com o CDI.' },
  ],
  stop_reason: 'end_turn',
  stop_details: null,
  usage: { input_tokens: 1000, output_tokens: 500 },
  ...over,
});

async function setup(reply: (req: Req) => unknown = () => message()) {
  const calls: { req: Req; key: string }[] = [];
  const t = await testApp({ now: () => NOW, anthropic: fakeClient(reply, calls) });
  close = () => t.app.close();
  const call = async (method: 'GET' | 'PUT' | 'POST', url: string, body?: unknown) => {
    const r = await t.app.inject({
      method,
      url,
      ...(body !== undefined
        ? { headers: { 'content-type': 'application/json' }, payload: JSON.stringify(body) }
        : {}),
    });
    return { status: r.statusCode, body: r.json() as Record<string, unknown> };
  };
  return { t, call, calls };
}

const KEY = 'sk-ant-api03-teste-0000000000000000-abcd';
const base = {
  enabled: true,
  model: 'claude-opus-5-5',
  monthlyLimitUsd: 1,
  priceInPerMTok: 4,
  priceOutPerMTok: 20,
};

describe('assistente com IA', () => {
  it('desligado por padrão; a chave nunca volta ao navegador e vai criptografada no banco', async () => {
    const { t, call } = await setup();
    const s0 = await call('GET', '/api/assistant/settings');
    expect(s0.body).toMatchObject({ enabled: false, keyHint: null });
    expect((await call('PUT', '/api/assistant/settings', base)).status).toBe(400); // sem chave
    const s1 = await call('PUT', '/api/assistant/settings', { ...base, apiKey: KEY });
    expect(s1.status).toBe(200);
    expect(s1.body.keyHint).toBe('…abcd');
    expect(JSON.stringify(s1.body)).not.toContain('sk-ant');
    const row = t.db.select().from(assistantSettings).where(eq(assistantSettings.userId, 1)).get();
    expect(row?.apiKey).not.toContain('sk-ant');
    // pergunta com o assistente desligado: recusada
    await call('PUT', '/api/assistant/settings', { ...base, enabled: false });
    expect(
      (await call('POST', '/api/assistant/ask', { question: 'Vale a pena?', screen: 'grafico' }))
        .status,
    ).toBe(400);
    expect((await call('GET', '/api/assistant/models')).body.models).toEqual([
      'claude-opus-5-5',
      'claude-sonnet-5-5',
    ]);
  });

  it('pergunta com contexto: personalidade crítica, reserva em caso de recusa, custo registrado', async () => {
    const { t, call, calls } = await setup();
    await call('PUT', '/api/assistant/settings', { ...base, apiKey: KEY });
    const r = await call('POST', '/api/assistant/ask', {
      question: 'Esse 9.1 é bom?',
      screen: 'laboratorio',
      context: { ativo: 'PETR4', trades: 12, expectativaR: 0.4 },
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ refused: false, model: 'claude-opus-5-5' });
    expect(String(r.body.text)).toContain('CDI');
    // 1000 × 4 + 500 × 20 por milhão = US$ 0,014
    expect(r.body.costUsd).toBeCloseTo(0.014, 6);
    const req = calls[0]!.req;
    expect(calls[0]!.key).toBe(KEY);
    expect(req.model).toBe('claude-opus-5-5');
    expect(String(req.system)).toMatch(/analista crítico/);
    expect(String(req.system)).toMatch(/nunca dê ordem de compra ou venda/);
    const content = String((req.messages as { content: string }[])[0]!.content);
    expect(content).toContain('"ativo":"PETR4"');
    expect(content).toContain('Esse 9.1 é bom?');
    expect(req.fallbacks).toBe('default');
    expect(req.betas).toEqual(['server-side-fallback-2026-07-01']);
    const u = t.db.select().from(assistantUsage).get();
    expect(u).toMatchObject({ month: monthKey(NOW), requests: 1, inputTokens: 1000 });
    const s = await call('GET', '/api/assistant/settings');
    expect(s.body).toMatchObject({ requests: 1, month: '2026-10' });

    // modelo sem suporte à reserva: não manda o parâmetro
    await call('PUT', '/api/assistant/settings', { ...base, model: 'claude-haiku-5-5' });
    await call('POST', '/api/assistant/ask', { question: 'E agora?', screen: 'grafico' });
    expect(calls[1]!.req.fallbacks).toBeUndefined();
  });

  it('limite mensal: recusa ANTES de gastar quando o pior caso passaria do limite', async () => {
    const { t, call, calls } = await setup();
    await call('PUT', '/api/assistant/settings', { ...base, apiKey: KEY, monthlyLimitUsd: 0.5 });
    t.db
      .insert(assistantUsage)
      .values({
        userId: 1,
        month: monthKey(NOW),
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0.45,
        requests: 9,
      })
      .run();
    const r = await call('POST', '/api/assistant/ask', {
      question: 'Mais uma?',
      screen: 'grafico',
    });
    expect(r.status).toBe(402);
    expect(String(r.body.error)).toMatch(/Limite mensal de US\$ 0.50 atingido/);
    expect(calls).toHaveLength(0);
  });

  it('recusa do modelo e erros da API viram mensagens claras', async () => {
    let mode: 'refusal' | 'conn' = 'refusal';
    const { call } = await setup(() => {
      if (mode === 'conn') throw new Anthropic.APIConnectionError({ message: 'offline' });
      return message({
        content: [],
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: null, explanation: null },
      });
    });
    await call('PUT', '/api/assistant/settings', { ...base, apiKey: KEY });
    const r = await call('POST', '/api/assistant/ask', {
      question: 'Pergunta qualquer',
      screen: 'grafico',
    });
    expect(r.body).toMatchObject({ refused: true });
    expect(String(r.body.text)).toMatch(/recusou/);
    mode = 'conn';
    const e = await call('POST', '/api/assistant/ask', {
      question: 'Pergunta qualquer',
      screen: 'grafico',
    });
    expect(e.status).toBe(502);
    expect(String(e.body.error)).toMatch(/Sem conexão com a Anthropic/);
  });

  it('custo: cache cobrado com os multiplicadores; arredondamento do mês em São Paulo', () => {
    expect(costUsd({ input: 1_000_000, output: 0 }, 4, 20)).toBe(4);
    expect(costUsd({ input: 0, output: 1_000_000, cacheRead: 1_000_000 }, 4, 20)).toBeCloseTo(
      20.4,
      6,
    );
    // 1º de novembro 01h UTC ainda é 31 de outubro em São Paulo
    expect(monthKey(Date.UTC(2026, 10, 1, 1))).toBe('2026-10');
  });
});
