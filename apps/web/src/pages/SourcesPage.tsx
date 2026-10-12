import { MARKET_LABEL, type Market } from '@radar/shared';
import { useEffect, useState } from 'react';
import { getSources, type SourceInfo } from '../lib/api';

/** Estado das fontes de dados e limitações conhecidas (transparência, SPEC §3.2). */
export function SourcesPage() {
  const [data, setData] = useState<{ simulated: boolean; sources: SourceInfo[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    getSources().then(setData, (e: Error) => setErr(e.message));
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 text-sm">
      <h1 className="text-xl font-semibold">Fontes de dados</h1>
      <p className="text-muted">
        O Radar nunca inventa preços. Se uma fonte falhar, o gráfico mostra o erro e a data do
        último dado válido.
      </p>
      {err && <p className="text-down">Erro ao consultar o servidor: {err}</p>}
      {data?.simulated && (
        <p className="rounded bg-warn px-2 py-1 font-bold text-black">
          Servidor em modo de desenvolvimento com DADOS SIMULADOS ligados.
        </p>
      )}
      <ul className="divide-y divide-line rounded border border-line">
        {data?.sources.map((s) => (
          <li key={s.id} className="flex items-center gap-3 px-3 py-2">
            <span className={`h-2.5 w-2.5 rounded-full ${s.configured ? 'bg-up' : 'bg-down'}`} />
            <span className="w-28 font-semibold">{s.label}</span>
            <span className="text-muted">{MARKET_LABEL[s.market as Market] ?? s.market}</span>
            <span className="ml-auto text-xs">
              {s.configured ? 'configurada' : 'sem chave — veja o guia'}
            </span>
          </li>
        ))}
      </ul>
      <section className="space-y-2">
        <h2 className="font-semibold">Limitações conhecidas</h2>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>
            <b>Cripto (Binance):</b> volume só da Binance, não do mercado inteiro. Preços em USDT,
            não em reais.
          </li>
          <li>
            <b>Ações dos EUA (Alpaca grátis):</b> histórico com 15 min de atraso; ao vivo só a bolsa
            IEX, então o volume do candle em formação é <b>parcial</b>.
          </li>
          <li>
            <b>B3 (brapi grátis):</b> cerca de 30 min de atraso e só 3 meses de histórico. Para
            histórico longo, importe o COTAHIST da B3, que <b>não é ajustado por proventos</b>.
            Tempo real só com o MetaTrader 5 (Fase 7).
          </li>
          <li>
            <b>Forex:</b> ainda não disponível (Fase 7). O volume no forex é só "tick volume" da
            corretora.
          </li>
        </ul>
      </section>
    </div>
  );
}
