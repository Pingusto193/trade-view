import type { NewsSourceDef } from '@radar/data';
import { afterEach, describe, expect, it } from 'vitest';
import type { AnthropicLike } from '../src/assistant/service';
import { NEWS_AI_SYSTEM } from '../src/news/ai';
import { testApp } from './helpers';

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

const NOW = Date.UTC(2026, 9, 26, 13);
const MIN = 60_000;
type Req = Record<string, unknown>;

const src = (id: string, extra: Partial<NewsSourceDef> = {}): NewsSourceDef => ({
  id,
  label: `Fonte ${id}`,
  kind: 'noticia',
  lang: 'pt',
  url: `https://${id}.exemplo/rss`,
  intervalMs: 5 * MIN,
  reader: 'feed',
  terms: 'teste',
  aiSummary: true,
  ...extra,
});

const rss = (items: { t: string; link: string; min: number; d?: string }[]) =>
  `<?xml version="1.0"?><rss version="2.0"><channel>${items
    .map(
      (i) =>
        `<item><title>${i.t}</title><link>${i.link}</link><pubDate>${new Date(NOW + i.min * MIN).toUTCString()}</pubDate><description>${i.d ?? 'trecho'}</description></item>`,
    )
    .join('')}</channel></rss>`;

const reply = (json: unknown, over: Req = {}) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content: [{ type: 'text', text: JSON.stringify(json) }],
  stop_reason: 'end_turn',
  stop_details: null,
  usage: { input_tokens: 400, output_tokens: 150 },
  ...over,
});

const GOOD = {
  resumo: 'O dólar subiu com o Copom no radar dos investidores.',
  relevancia: 4,
  sentimento: 'misto',
  ativos: ['usd', 'IBOV'],
};

async function setup(answer: (req: Req) => unknown = () => reply(GOOD)) {
  const calls: Req[] = [];
  let now = NOW;
  const bodies: Record<string, string> = {
    'https://a.exemplo/rss': rss([
      {
        t: 'Dólar sobe com Copom no radar dos investidores',
        link: 'https://a.exemplo/1',
        min: -30,
      },
    ]),
    'https://n.exemplo/rss': rss([
      { t: 'Dólar cai com fluxo estrangeiro forte hoje', link: 'https://n.exemplo/1', min: -30 },
    ]),
  };
  const fetch = (async (url: string) =>
    new Response(bodies[url] ?? 'não', { status: 200 })) as never;
  const anthropic = (() =>
    ({
      beta: {
        messages: {
          create: async (req: Req) => {
            calls.push(req);
            return answer(req);
          },
        },
      },
      models: { list: () => (async function* () {})() },
    }) as unknown as AnthropicLike) as (key: string) => AnthropicLike;
  const t = await testApp({
    now: () => now,
    anthropic,
    newsSources: [src('a'), src('n', { aiSummary: false })],
    newsFetch: fetch,
  });
  close = () => t.app.close();
  const inject = async (method: 'GET' | 'PUT' | 'POST', url: string, body?: unknown) => {
    const r = await t.app.inject({
      method,
      url,
      ...(body !== undefined
        ? { headers: { 'content-type': 'application/json' }, payload: JSON.stringify(body) }
        : {}),
    });
    return { status: r.statusCode, body: r.json() as Record<string, unknown> };
  };
  return { t, calls, inject, bodies, setNow: (x: number) => (now = x) };
}

const assistant = {
  enabled: false,
  model: 'claude-opus-5-5',
  monthlyLimitUsd: 5,
  priceInPerMTok: 4,
  priceOutPerMTok: 20,
  apiKey: 'sk-ant-api03-teste-0000000000000000-abcd',
};

describe('resumo por IA das notícias', () => {
  it('só liga com chave e preços do Assistente; a chave nunca volta', async () => {
    const { inject } = await setup();
    const off = await inject('PUT', '/api/news/ai', { enabled: true, monthlyLimitUsd: 2 });
    expect(off.status).toBe(400);
    expect(off.body.error).toMatch(/chave da API/);
    await inject('PUT', '/api/assistant/settings', assistant);
    const on = await inject('PUT', '/api/news/ai', { enabled: true, monthlyLimitUsd: 2 });
    expect(on.body).toMatchObject({
      enabled: true,
      effectiveModel: 'claude-opus-5-5',
      keyConfigured: true,
    });
    expect(JSON.stringify(on.body)).not.toContain('sk-ant');
  });

  it('resume com título + trecho, JSON estruturado, esforço baixo e reserva; grava custo', async () => {
    const { inject, calls } = await setup();
    await inject('PUT', '/api/assistant/settings', assistant);
    await inject('PUT', '/api/news/ai', { enabled: true, monthlyLimitUsd: 2 });
    await inject('POST', '/api/news/sources/a/poll');
    const feed = (await inject('GET', '/api/news?limit=5')).body.items as { id: string }[];
    const r = await inject('POST', `/api/news/${feed[0]!.id}/summary`);
    expect(r.body.ai).toMatchObject({
      summary: GOOD.resumo,
      relevance: 4,
      sentiment: 'misto',
      assets: ['USD', 'IBOV'],
      error: null,
    });
    const req = calls[0]!;
    expect(req.system).toBe(NEWS_AI_SYSTEM);
    const user = JSON.parse((req.messages as { content: string }[])[0]!.content);
    expect(user).toMatchObject({
      titulo: 'Dólar sobe com Copom no radar dos investidores',
      trecho: 'trecho',
    });
    expect(req.output_config).toMatchObject({ effort: 'low', format: { type: 'json_schema' } });
    expect(req.fallbacks).toBe('default');
    // aparece no feed e o gasto entra no mês: (400×4 + 150×20) / 1e6
    const items = (await inject('GET', '/api/news?limit=5')).body.items as { ai: unknown }[];
    expect(items[0]!.ai).toMatchObject({ summary: GOOD.resumo });
    const st = (await inject('GET', '/api/news/ai')).body;
    expect(st.spentUsd).toBeCloseTo((400 * 4 + 150 * 20) / 1e6, 6);
    expect(st.requests).toBe(1);
  });

  it('fila automática: notícia nova que interessa (dólar → mini-dólar) é resumida sozinha', async () => {
    const { inject, calls, bodies, setNow } = await setup();
    await inject('PUT', '/api/assistant/settings', assistant);
    await inject('PUT', '/api/news/ai', { enabled: true, monthlyLimitUsd: 2 });
    await inject('POST', '/api/news/sources/a/poll'); // acervo: não resume
    bodies['https://a.exemplo/rss'] = rss([
      { t: 'Dólar dispara com juros nos EUA em alta hoje', link: 'https://a.exemplo/2', min: 4 },
      {
        t: 'Time vence clássico e lidera o campeonato brasileiro',
        link: 'https://a.exemplo/3',
        min: 4,
      },
    ]);
    setNow(NOW + 5 * MIN);
    await inject('POST', '/api/news/sources/a/poll');
    await new Promise((ok) => setTimeout(ok, 2500));
    expect(calls).toHaveLength(1); // só a do dólar (o futebol não interessa)
    const user = JSON.parse((calls[0]!.messages as { content: string }[])[0]!.content);
    expect(user.titulo).toMatch(/Dólar dispara/);
  }, 10_000);

  it('fonte que não permite IA: recusa sem chamar a API', async () => {
    const { inject, calls } = await setup();
    await inject('PUT', '/api/assistant/settings', assistant);
    await inject('PUT', '/api/news/ai', { enabled: true, monthlyLimitUsd: 2 });
    await inject('POST', '/api/news/sources/n/poll');
    const feed = (await inject('GET', '/api/news?limit=5')).body.items as { id: string }[];
    const r = await inject('POST', `/api/news/${feed[0]!.id}/summary`);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/termos desta fonte/);
    expect(calls).toHaveLength(0);
  });

  it('limite mensal: recusa antes de gastar; resposta fora do formato vira erro registrado', async () => {
    const { inject, calls } = await setup(() => reply({ texto: 'qualquer coisa' }));
    await inject('PUT', '/api/assistant/settings', { ...assistant, priceOutPerMTok: 50 });
    // pior caso por resumo ≈ 470 tokens de entrada × US$ 4/M + 2.000 de saída × US$ 50/M ≈ US$ 0,102
    await inject('PUT', '/api/news/ai', { enabled: true, monthlyLimitUsd: 0.11 });
    await inject('POST', '/api/news/sources/a/poll');
    const id = ((await inject('GET', '/api/news?limit=5')).body.items as { id: string }[])[0]!.id;
    const bad = await inject('POST', `/api/news/${id}/summary`);
    expect(bad.body.ai).toMatchObject({ summary: null, error: 'resposta fora do formato' });
    // gastou US$ 0,0091: o próximo pior caso estouraria o limite → recusa sem chamar a API
    const over = await inject('POST', `/api/news/${id}/summary`);
    expect(over.status).toBe(402);
    expect(over.body.error).toMatch(/Limite mensal/);
    expect(calls).toHaveLength(1);
  });
});
