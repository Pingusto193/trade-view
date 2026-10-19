import { SETUP_LABEL } from '@radar/core';
import { TIMEFRAME_LABEL, type Timeframe } from '@radar/shared';
import { analysisKey, useAnalysis } from './analysis-store';
import { useLab } from './lab-store';
import { usePaper } from './paper-store';
import { usePrefs } from './prefs';
import { useReal } from './real-store';
import { useReplay } from './replay-store';

/**
 * Resumo da tela atual enviado ao assistente junto com a pergunta (SPEC §16). Só números e rótulos que
 * o usuário já está vendo; nunca senha, chaves ou dados da conta. O usuário vê o JSON antes de enviar.
 */
export function screenContext(
  pathname: string,
  search: string,
): { screen: string; context: Record<string, unknown> } {
  const q = new URLSearchParams(search);
  const prefs = usePrefs.getState();
  const base = {
    modo: prefs.mode,
    riscoPorTradePct: prefs.riskPct,
    limiteRiscoPct: prefs.maxRiskPct,
  };
  if (pathname.startsWith('/grafico')) {
    const id = q.get('id') ?? prefs.recent[0]?.id ?? null;
    const tf = (q.get('tf') ?? prefs.recent[0]?.tf ?? '1d') as Timeframe;
    const a = id ? useAnalysis.getState().byKey[analysisKey(id, tf)] : undefined;
    const c = a?.context;
    return {
      screen: 'gráfico',
      context: {
        ...base,
        ativo: id,
        escala: TIMEFRAME_LABEL[tf] ?? tf,
        contexto: c
          ? {
              tendencia: c.trend.label,
              estrutura: c.structure.label,
              adx: c.adx.label,
              alinhamentoMedias: c.alignment.label,
              mediaRespeitada: c.respected.label,
              escalaMaior: c.wind.label,
            }
          : 'sem leitura de contexto (poucos candles ou gráfico ainda carregando)',
        setupsAbertos: (a?.open ?? []).map((o) => ({
          setup: SETUP_LABEL[o.setup] ?? o.setup,
          lado: o.side === 'buy' ? 'compra' : 'venda',
          estado: o.state,
          gatilho: o.trigger,
          stop: o.stop,
          alvo: o.target,
        })),
      },
    };
  }
  if (pathname.startsWith('/laboratorio')) {
    const r = useLab.getState().current;
    return {
      screen: 'laboratório',
      context: r
        ? {
            ...base,
            ativo: r.symbol,
            escala: r.input.tf,
            setups: r.input.setups.map((s) => SETUP_LABEL[s] ?? s),
            periodo: {
              de: new Date(r.from).toISOString().slice(0, 10),
              ate: new Date(r.to).toISOString().slice(0, 10),
              candles: r.bars,
            },
            tudo: r.metrics,
            treino: r.train,
            teste: r.test,
            veredito: r.verdict,
            buyAndHold: r.buyHold,
            cdiNoPeriodo: r.cdi?.acc ?? null,
            monteCarlo: {
              quedaMaxima: r.monteCarlo.drawdown,
              retornoFinal: r.monteCarlo.finalReturn,
            },
            walkForward: r.walkForward
              ? {
                  parametro: r.walkForward.param,
                  tradesForaDaAmostra: r.walkForward.oosTrades,
                  expectativaForaDaAmostraR: r.walkForward.oosExpectancyR,
                }
              : null,
            avisosDosDados: r.dataNotes,
            tentativasNesteAtivo: r.attempts,
          }
        : { ...base, aviso: 'nenhum teste aberto na tela' },
    };
  }
  if (pathname.startsWith('/diario')) {
    const j = useReal.getState().journal;
    return {
      screen: 'diário real',
      context: { ...base, estatisticas: j?.stats ?? null, irEstimado: j?.tax ?? [] },
    };
  }
  if (pathname.startsWith('/treino')) {
    const j = usePaper.getState().journal;
    return {
      screen: 'treino',
      context: { ...base, estatisticas: j?.stats ?? null, conta: j?.account ?? null },
    };
  }
  if (pathname.startsWith('/replay')) {
    const v = useReplay.getState().view;
    return {
      screen: 'replay',
      context: v
        ? {
            ...base,
            // no sorteio o ativo segue oculto (o servidor já manda mascarado)
            ativo: v.symbol,
            escala: v.tf,
            candlesRevelados: v.cursor - v.startIndex,
            patrimonio: v.equity,
            posicao: v.book.position,
            trades: v.book.trades.map((t) => ({
              r: t.r,
              resultado: t.realizedBrl,
              saida: t.exitKind,
              stopParaTras: t.stopMovedBack,
              plano: t.plan?.released ?? false,
            })),
          }
        : base,
    };
  }
  return { screen: pathname.replace(/^\//, '') || 'início', context: base };
}
