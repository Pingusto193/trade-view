import { describe, expect, it } from 'vitest';
import { HttpClient } from '../src/http';
import { DataSourceError, RateLimitError } from '../src/types';
import { fakeFetch } from './helpers';

function clock() {
  let t = 0;
  const waits: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      waits.push(ms);
      t += ms;
    },
    waits,
  };
}

describe('HttpClient — fila, limite e backoff', () => {
  it('respeita o limite de requisições por janela', async () => {
    const c = clock();
    const f = fakeFetch([{ match: () => true, body: { ok: 1 } }]);
    const http = new HttpClient({ source: 'teste', maxRequests: 2, perMs: 1000, fetch: f, ...c });
    await Promise.all([http.getJson('a'), http.getJson('b'), http.getJson('c')]);
    expect(f.calls).toEqual(['a', 'b', 'c']);
    // a 3ª requisição esperou a janela abrir
    expect(c.waits.some((w) => w >= 1000)).toBe(true);
  });

  it('em 429 espera o Retry-After e tenta de novo', async () => {
    const c = clock();
    let n = 0;
    const http = new HttpClient({
      source: 'teste',
      maxRequests: 100,
      perMs: 1000,
      ...c,
      fetch: async () => {
        n++;
        return n === 1
          ? new Response('', { status: 429, headers: { 'retry-after': '7' } })
          : new Response('{"v":2}', { status: 200 });
      },
    });
    const limited: number[] = [];
    http.onRateLimited = (ms) => limited.push(ms);
    await expect(http.getJson('x')).resolves.toEqual({ v: 2 });
    expect(limited).toEqual([7000]);
    expect(c.waits).toContain(7000);
  });

  it('desiste após as tentativas e lança RateLimitError', async () => {
    const c = clock();
    const http = new HttpClient({
      source: 'teste',
      maxRequests: 100,
      perMs: 1000,
      retries: 1,
      ...c,
      fetch: async () => new Response('', { status: 429 }),
    });
    await expect(http.getJson('x')).rejects.toBeInstanceOf(RateLimitError);
  });

  it('4xx não é repetido; 5xx é', async () => {
    const c = clock();
    const f404 = fakeFetch([{ match: () => true, status: 404, body: 'x' }]);
    const h1 = new HttpClient({ source: 't', maxRequests: 9, perMs: 1000, fetch: f404, ...c });
    await expect(h1.getJson('a')).rejects.toBeInstanceOf(DataSourceError);
    expect(f404.calls).toHaveLength(1);

    let n = 0;
    const h2 = new HttpClient({
      source: 't',
      maxRequests: 9,
      perMs: 1000,
      ...c,
      fetch: async () => (++n < 3 ? new Response('', { status: 503 }) : new Response('[1]')),
    });
    await expect(h2.getJson('a')).resolves.toEqual([1]);
    expect(n).toBe(3);
  });
});
