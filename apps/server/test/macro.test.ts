import { BcbClient } from '@radar/data';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testApp } from './helpers';

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

const NOW = Date.UTC(2026, 9, 12, 15);
const DAY = 86_400_000;

/** Banco Central falso: respostas no formato do SGS (DATA_SOURCES §7). */
function fakeBcb(state: { fail: boolean; calls: number }) {
  const fetch = async (url: string): Promise<Response> => {
    state.calls++;
    if (state.fail) return new Response('erro', { status: 503 });
    if (url.includes('bcdata.sgs.432/dados/ultimos')) {
      return Response.json([
        { data: '17/09/2026', valor: '15.00' },
        { data: '05/11/2026', valor: '15.00' },
      ]);
    }
    const m =
      /bcdata\.sgs\.12\/dados\?formato=json&dataInicial=(\d\d)\/(\d\d)\/(\d{4})&dataFinal=(\d\d)\/(\d\d)\/(\d{4})/.exec(
        url,
      );
    if (m) {
      const from = Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
      const to = Date.UTC(Number(m[6]), Number(m[5]) - 1, Number(m[4]));
      const rows = [];
      for (let t = from; t <= to; t += DAY) {
        const wd = new Date(t).getUTCDay();
        if (wd === 0 || wd === 6) continue; // só dias úteis
        const d = new Date(t);
        rows.push({
          data: `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`,
          valor: '0.055131',
        });
      }
      return Response.json(rows);
    }
    return new Response('[]', { status: 404 });
  };
  return new BcbClient({ fetch, retries: 0 });
}

describe('Painel Brasil (Selic e CDI do Banco Central)', () => {
  it('Selic meta, CDI anualizado e acumulados, com cache de 6 h', async () => {
    const st = { fail: false, calls: 0 };
    let now = NOW;
    const t = await testApp({ bcb: fakeBcb(st), now: () => now });
    close = () => t.app.close();
    const r = (await t.app.inject({ url: '/api/macro/brasil' })).json();
    expect(r.status).toEqual({ state: 'ok' });
    expect(r.selic.value).toBe(15);
    expect(r.cdi.dailyPct).toBe(0.055131);
    // (1 + 0,055131%)^252 − 1 ≈ 14,90% a.a.
    expect(r.cdi.annualPct).toBeCloseTo(14.9, 1);
    // ~261 dias úteis em 365 dias corridos (o falso não tem feriados)
    expect(r.cdi.acc12m).toBeCloseTo(1.00055131 ** 261 - 1, 3);
    expect(r.cdi.accYtd).toBeGreaterThan(0.1);
    const calls = st.calls;
    await t.app.inject({ url: '/api/macro/brasil' });
    expect(st.calls).toBe(calls); // dentro das 6 h: sem nova busca
    now += 7 * 3600_000;
    await t.app.inject({ url: '/api/macro/brasil' });
    await vi.waitFor(() => expect(st.calls).toBeGreaterThan(calls), 8000);
  });

  it('BCB fora do ar: mostra o erro e o último dado válido, nunca inventa', async () => {
    const st = { fail: false, calls: 0 };
    let now = NOW;
    const t = await testApp({ bcb: fakeBcb(st), now: () => now });
    close = () => t.app.close();
    await t.app.inject({ url: '/api/macro/brasil' });
    st.fail = true;
    now += 7 * 3600_000;
    await t.app.inject({ url: '/api/macro/brasil' }); // dispara a atualização em segundo plano
    let r: {
      status: { state: string; message: string; lastValidAt: number };
      cdi: { date: number };
      selic: { value: number };
    };
    await vi.waitFor(async () => {
      r = (await t.app.inject({ url: '/api/macro/brasil' })).json();
      expect(r.status.state).toBe('error');
    }, 8000);
    r = (await t.app.inject({ url: '/api/macro/brasil' })).json();
    expect(r.status.message).toMatch(/Banco Central indisponível/);
    expect(r.status.lastValidAt).toBe(r.cdi.date);
    expect(r.selic.value).toBe(15);
  });

  it('sem nenhum dado guardado e BCB fora: tudo vazio com erro', async () => {
    const t = await testApp({ bcb: fakeBcb({ fail: true, calls: 0 }), now: () => NOW });
    close = () => t.app.close();
    const r = (await t.app.inject({ url: '/api/macro/brasil' })).json();
    expect(r).toMatchObject({ selic: null, cdi: null, status: { state: 'error' } });
  });

  it('CDI acumulado num período (para comparar o treino com a renda fixa)', async () => {
    const t = await testApp({ bcb: fakeBcb({ fail: false, calls: 0 }), now: () => NOW });
    close = () => t.app.close();
    const from = NOW - 30 * DAY;
    const r = (await t.app.inject({ url: `/api/macro/cdi?from=${from}&to=${NOW}` })).json();
    expect(r.cdi.days).toBeGreaterThan(18);
    expect(r.cdi.acc).toBeCloseTo(1.00055131 ** r.cdi.days - 1, 6);
    // período antes do que o servidor guarda: busca o trecho que falta no BCB
    const old = (
      await t.app.inject({ url: `/api/macro/cdi?from=${Date.UTC(2015, 0, 1)}&to=${NOW}` })
    ).json();
    expect(old.cdi.days).toBeGreaterThan(2500);
  });

  it('CDI de um período antigo com o BCB fora do ar: null (não chuta)', async () => {
    const st = { fail: false, calls: 0 };
    const t = await testApp({ bcb: fakeBcb(st), now: () => NOW });
    close = () => t.app.close();
    await t.app.inject({ url: `/api/macro/cdi?from=${NOW - 30 * DAY}&to=${NOW}` });
    st.fail = true;
    const old = (
      await t.app.inject({ url: `/api/macro/cdi?from=${Date.UTC(2015, 0, 1)}&to=${NOW}` })
    ).json();
    expect(old.cdi).toBeNull();
  });
});
