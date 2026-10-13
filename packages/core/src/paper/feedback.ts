import type { Candle, PaperPosition, Timeframe } from '@radar/shared';
import {
  INTRADAY_MS,
  TIMEFRAME_LABEL,
  formatDateTime,
  formatNumber,
  formatSessionDate,
  isIntraday,
  planAgainstHigher,
} from '@radar/shared';
import { periodKey } from '../candles/aggregate';
import { SetupEngine } from '../setups/engine';
import { exitFill } from '../setups/fills';
import type { SetupParams } from '../setups/params';
import { EXIT_LABEL, SETUP_LABEL, type ExitKind, type SetupId } from '../setups/types';

/**
 * Feedback depois de cada trade de treino (SPEC §13): seguiu o plano? entrou no gatilho? estava a
 * favor da escala maior? risco dentro do limite? moveu o stop para trás? realizou cedo? E o resultado
 * em R comparado ao do setup "puro" (o MESMO detector do gráfico, do backtest e dos alertas).
 *
 * Lógica pura: o servidor busca os candles reais e chama esta função. Regras:
 * - sem look-ahead: o gatilho é conferido só com os candles FECHADOS antes do candle que contém a
 *   abertura do trade;
 * - nunca inventar: sem candles (fonte falhou) ou com poucos candles, o item vira "sem dados" e diz
 *   por quê.
 */

/** Candles da escala do setup olhados depois da saída para "realizou cedo?" (decisão nossa). */
export const FEEDBACK_AFTER_BARS = 20;
/** Mínimo de candles fechados antes da entrada para o detector aquecer as médias (MMA50 + folga). */
export const FEEDBACK_MIN_BARS = 60;
/** Candles pedidos à fonte ANTES da entrada (aquecimento: MMA200, contração de 120 candles…). */
export const FEEDBACK_WARMUP_BARS = 300;
/** Teto de candles por pedido do feedback (trades antigos em escala curta podem não caber). */
export const FEEDBACK_MAX_CANDLES = 5000;
/** Diferença em R tratada como "praticamente igual" ao comparar com o setup puro (custos). */
export const FEEDBACK_R_TOLERANCE = 0.1;

export type FeedbackStatus = 'ok' | 'atencao' | 'sem-dados';
export type FeedbackKey =
  'plano' | 'gatilho' | 'escala' | 'risco' | 'stop' | 'saida' | 'setup-puro';

export interface FeedbackItem {
  key: FeedbackKey;
  status: FeedbackStatus;
  titulo: string;
  /** O porquê, em PT-BR simples, com os números. */
  detalhe: string;
}

/** Como o trade terminou: stop, alvo, venda à mão ou reinício da conta. */
export type FeedbackExitKind = 'stop' | 'alvo' | 'manual' | 'reinicio';

export interface FeedbackTrade {
  /** Instante da abertura (UTC ms, já no tempo do preço: ativo com atraso → descontado). */
  openedAt: number;
  closedAt: number;
  /** Preço médio de entrada (já com derrapagem). */
  entryPrice: number;
  /**
   * Custo de execução por unidade embutido na entrada (meio spread + derrapagem). O gatilho é comparado
   * com o preço ANTES dos custos, senão uma compra abaixo do gatilho pareceria "no gatilho".
   */
  entryCostPerUnit?: number;
  initialStop: number | null;
  /** Stop em vigor na saída (pode ter andado a favor). */
  stopAtExit: number | null;
  /** Alvo planejado na entrada. */
  target: number | null;
  /** Preço médio de saída. */
  exitPrice: number;
  exitKind: FeedbackExitKind;
  /** Resultado em R (com custos); null sem stop. */
  r: number | null;
  /** Risco na entrada em % do patrimônio; null quando não dá para medir. */
  riskPct: number | null;
  stopMovedBack: boolean;
}

export type FeedbackPlan = Pick<
  NonNullable<PaperPosition['plan']>,
  'setup' | 'tfSetup' | 'aligned' | 'warnings' | 'released' | 'missing'
>;

export interface FeedbackInput {
  /** Candles da escala do setup, em ordem crescente; null quando a fonte falhou. */
  candles: readonly Candle[] | null;
  /** Por que não há candles (mensagem da fonte e data do último dado válido). */
  candlesError?: string | null;
  /** O último candle ainda está em formação: fica de fora (só candles fechados contam). */
  lastOpen?: boolean;
  tf: Timeframe;
  /** Fuso da bolsa (define a que candle pertence cada instante). */
  tz: string;
  tick: number;
  /** Casas decimais dos preços no texto (padrão: as do tick). */
  decimals?: number;
  /** Parâmetros dos setups do usuário (os mesmos do gráfico). */
  params: SetupParams;
  trade: FeedbackTrade;
  plan: FeedbackPlan | null;
  /** Limite de risco por trade das preferências (%). */
  maxRiskPct: number;
}

/** Resultado do setup "puro": o que o detector registrou para a mesma ocorrência. */
export interface PureSetupComparison {
  setup: SetupId;
  label: string;
  /** 'aberto' = a ocorrência ainda não terminou. */
  state: 'encerrado' | 'aberto';
  exit: ExitKind | null;
  /** O setup puro chegou a entrar (acionou)? */
  entered: boolean;
  /** R do setup puro, sem custos (0 se não entrou; null se ainda aberto ou sem R). */
  setupR: number | null;
  /** R real do trade (com custos). */
  realR: number | null;
}

export interface TradeFeedback {
  tf: Timeframe;
  items: FeedbackItem[];
  pure: PureSetupComparison | null;
}

const decimalsOf = (tick: number) =>
  tick > 0 ? Math.max(0, Math.min(8, Math.ceil(-Math.log10(tick) - 1e-9))) : 2;

const isSetupId = (s: string): s is SetupId => s in SETUP_LABEL;

/** Quantos candles pedir à fonte para cobrir aquecimento, o trade e os candles depois da saída. */
export function feedbackCandleLimit(tf: Timeframe, openedAt: number, now: number): number {
  const span = Math.max(0, now - openedAt);
  const bar = isIntraday(tf)
    ? INTRADAY_MS[tf]
    : tf === '1d'
      ? 86_400_000
      : tf === '1w'
        ? 7 * 86_400_000
        : 28 * 86_400_000;
  // calendário corrido superestima (fins de semana, pregão fechado): sobra, nunca falta
  const bars = Math.ceil(span / bar) + 2;
  return Math.min(FEEDBACK_MAX_CANDLES, FEEDBACK_WARMUP_BARS + bars + FEEDBACK_AFTER_BARS);
}

interface Occurrence {
  id: string;
  state: 'radar' | 'armado' | 'acionado';
  trigger: number | null;
  entry: number | null;
}

export function tradeFeedback(i: FeedbackInput): TradeFeedback {
  const t = i.trade;
  const plan = i.plan;
  const d = i.decimals ?? decimalsOf(i.tick);
  const px = (v: number) => formatNumber(v, d);
  const rr = (v: number) => `${v >= 0 ? '+' : ''}${formatNumber(v, 2)}R`;
  const pct = (v: number) => `${formatNumber(v, 2)}%`;
  const when = (time: number) =>
    isIntraday(i.tf) ? formatDateTime(time) : formatSessionDate(time);
  const tfLabel = TIMEFRAME_LABEL[i.tf];

  // ---- candles: a que período pertence cada instante (candle diário+ já vem com a data de pregão)
  const keyOf = periodKey(i.tf, i.tz);
  const candleKey = (c: Candle) => (isIntraday(i.tf) ? keyOf(c.time) : c.time);
  const kOpen = keyOf(t.openedAt);
  const kExit = keyOf(t.closedAt);
  let all: Candle[] | null = null;
  if (i.candles) {
    all = [];
    for (const c of i.candles) if (!all.length || c.time > all[all.length - 1]!.time) all.push(c);
  }
  const closed = all && i.lastOpen ? all.slice(0, -1) : all;
  const noCandles = `Sem candles da fonte (${i.candlesError ?? 'motivo desconhecido'}): não dá para avaliar — o Radar não inventa dados.`;

  const items: FeedbackItem[] = [];

  // ---- a. plano
  {
    const titulo = 'Entrou com plano liberado?';
    if (!plan)
      items.push({
        key: 'plano',
        status: 'atencao',
        titulo,
        detalhe:
          'Entrou sem plano de trade. Sem plano não há como saber se a entrada seguiu uma regra ou foi impulso.',
      });
    else if (plan.released)
      items.push({
        key: 'plano',
        status: 'ok',
        titulo,
        detalhe: 'Plano liberado: todos os itens estavam preenchidos antes de entrar.',
      });
    else
      items.push({
        key: 'plano',
        status: 'atencao',
        titulo,
        detalhe: plan.missing?.length
          ? `Plano incompleto. Faltou: ${plan.missing.join(', ')}.`
          : 'Plano incompleto (não ficou registrado o que faltava).',
      });
  }

  // ---- b. gatilho (sem look-ahead) e g. setup puro (mesma ocorrência, até o fim)
  let occurrence: Occurrence | null = null;
  let engine: SetupEngine | null = null;
  let pureWhy = '';
  const setup = plan && isSetupId(plan.setup) ? plan.setup : null;
  {
    const titulo = 'Entrou no gatilho do setup?';
    const semDados = (detalhe: string) => {
      pureWhy = detalhe;
      items.push({ key: 'gatilho', status: 'sem-dados', titulo, detalhe });
    };
    if (!plan) semDados('Sem plano: não dá para saber qual setup você queria seguir.');
    else if (plan.setup === 'manual')
      semDados(
        'Leitura própria: o Radar não tem um detector para conferir o gatilho. Confira no print do plano se havia um gatilho claro.',
      );
    else if (!setup) semDados('O plano não cita um setup do Radar para conferir.');
    else if (!closed || !all) semDados(noCandles);
    else {
      const label = SETUP_LABEL[setup];
      const before = closed.filter((c) => candleKey(c) < kOpen);
      if (before.length < FEEDBACK_MIN_BARS)
        semDados(
          `Só ${before.length} candles ${tfLabel.toLowerCase()} fechados antes da entrada; o detector precisa de pelo menos ${FEEDBACK_MIN_BARS} para calcular as médias.`,
        );
      else {
        engine = new SetupEngine({
          params: { ...i.params, [setup]: { ...i.params[setup], enabled: true } } as SetupParams,
          tf: i.tf,
          tz: i.tz,
          tick: i.tick,
          only: [setup],
        });
        for (const c of before) engine.push(c);
        const lastBefore = before[before.length - 1]!;
        const inst = engine.open().find((o) => o.setup === setup && o.side === 'buy');
        const ref = `no candle fechado antes da entrada (${when(lastBefore.time)}, ${tfLabel.toLowerCase()})`;
        if (!inst) {
          pureWhy = `Não havia ocorrência de ${label} para comparar.`;
          items.push({
            key: 'gatilho',
            status: 'atencao',
            titulo,
            detalhe: `Não havia ${label} armado ${ref}. Sem o gatilho do setup, a entrada foi só porque o preço "tocou a média" ou parecia bom?`,
          });
        } else {
          occurrence = {
            id: inst.id,
            state: inst.state,
            trigger: inst.trigger,
            entry: inst.entry,
          };
          const since = engine.events.find((e) => e.id === inst.id && e.state === inst.state);
          const desde = since ? ` desde ${when(since.time)}` : '';
          const T = inst.trigger;
          const E = t.entryPrice;
          // preço de mercado antes dos custos (spread/derrapagem não contam como "chegar ao gatilho")
          const raw = E - (t.entryCostPerUnit ?? 0);
          if (inst.state === 'radar' || T === null)
            items.push({
              key: 'gatilho',
              status: 'atencao',
              titulo,
              detalhe: `${label} estava só no radar${desde} (ainda sem gatilho) ${ref}: você antecipou o setup, entrando a ${px(E)} antes de ele armar.`,
            });
          else {
            // compra: no gatilho ou além (meio tick de folga para arredondamento)
            const ok = raw >= T - i.tick / 2;
            const diff = T > 0 ? ((E - T) / T) * 100 : 0;
            const acima = E > T ? ` (${pct(diff)} acima)` : '';
            let detalhe: string;
            if (inst.state === 'acionado') {
              const at = inst.entry !== null ? ` a ${px(inst.entry)}` : '';
              detalhe = ok
                ? `${label} já tinha acionado${desde}${at} (gatilho em ${px(T)}) ${ref}. Você entrou depois, a ${px(E)}, no gatilho ou além${acima}.`
                : `${label} já tinha acionado${desde}${at} (gatilho em ${px(T)}) ${ref}. Você entrou depois, a ${px(E)}, ${pct(-diff)} abaixo do gatilho.`;
            } else
              detalhe = ok
                ? `Havia ${label} armado${desde} com gatilho em ${px(T)} ${ref}. Sua entrada foi a ${px(E)}, no gatilho ou além${acima}.`
                : `Havia ${label} armado${desde} com gatilho em ${px(T)} ${ref}, mas você entrou a ${px(E)}, ${pct(-diff)} abaixo: antecipou a entrada antes de o setup confirmar.`;
            items.push({ key: 'gatilho', status: ok ? 'ok' : 'atencao', titulo, detalhe });
          }
        }
      }
    }
  }

  // ---- c. escala maior: resposta do plano × aviso automático gravado na entrada
  {
    const titulo = 'A favor da escala maior?';
    if (!plan)
      items.push({
        key: 'escala',
        status: 'sem-dados',
        titulo,
        detalhe: 'Sem plano: não há registro do que você viu nas escalas ao entrar.',
      });
    else {
      const contra = planAgainstHigher(plan.warnings);
      const [status, detalhe]: [FeedbackStatus, string] = contra
        ? plan.aligned
          ? [
              'atencao',
              'Você marcou as escalas a favor, mas o aviso automático na hora da entrada dizia: compra contra a escala maior (aviso vermelho).',
            ]
          : [
              'atencao',
              'Entrou contra a escala maior: o aviso vermelho apareceu e você mesmo marcou que as escalas não estavam a favor.',
            ]
        : plan.aligned
          ? [
              'ok',
              'Você marcou as três escalas a favor e não houve aviso de compra contra a escala maior.',
            ]
          : ['atencao', 'Você mesmo marcou que as três escalas não estavam a favor da compra.'];
      items.push({ key: 'escala', status, titulo, detalhe });
    }
  }

  // ---- d. risco
  {
    const titulo = 'Risco dentro do limite?';
    const lim = pct(i.maxRiskPct);
    if (t.initialStop === null)
      items.push({
        key: 'risco',
        status: 'atencao',
        titulo,
        detalhe: `Sem stop na entrada: a perda não tinha limite (o seu limite é ${lim} do patrimônio por trade).`,
      });
    else if (t.initialStop >= t.entryPrice)
      items.push({
        key: 'risco',
        status: 'sem-dados',
        titulo,
        detalhe: `A entrada (${px(t.entryPrice)}) saiu no stop ou abaixo dele (${px(t.initialStop)}), provavelmente por gap: o risco planejado não se aplica a este trade.`,
      });
    else if (t.riskPct === null)
      items.push({
        key: 'risco',
        status: 'sem-dados',
        titulo,
        detalhe:
          'Não dá para medir o risco deste trade: ele é de antes de um reinício da conta, e o saldo daquela fase não ficou guardado.',
      });
    else if (t.riskPct <= i.maxRiskPct + 1e-9)
      items.push({
        key: 'risco',
        status: 'ok',
        titulo,
        detalhe: `Arriscou ${pct(t.riskPct)} do patrimônio (entrada até o stop inicial), dentro do limite de ${lim}.`,
      });
    else
      items.push({
        key: 'risco',
        status: 'atencao',
        titulo,
        detalhe: `Arriscou ${pct(t.riskPct)} do patrimônio, acima do seu limite de ${lim}. Posição grande demais para o stop escolhido.`,
      });
  }

  // ---- e. stop
  {
    const titulo = 'Stop respeitado?';
    if (t.initialStop === null)
      items.push({
        key: 'stop',
        status: 'atencao',
        titulo,
        detalhe:
          'Entrou sem stop. Sem stop não existe R, e uma queda grande pode levar muito do saldo.',
      });
    else if (t.stopMovedBack || t.stopAtExit === null || t.stopAtExit < t.initialStop - i.tick / 2)
      items.push({
        key: 'stop',
        status: 'atencao',
        titulo,
        detalhe: `Tinha stop em ${px(t.initialStop)}, mas ele foi afastado (movido para trás) durante o trade: o risco aumentou depois da entrada.`,
      });
    else
      items.push({
        key: 'stop',
        status: 'ok',
        titulo,
        detalhe: `Tinha stop desde a entrada (${px(t.initialStop)}) e ele só andou a favor.`,
      });
  }

  // ---- f. saída: realizou cedo?
  {
    const titulo = 'Realizou o lucro cedo demais?';
    const push = (status: FeedbackStatus, detalhe: string) =>
      items.push({ key: 'saida', status, titulo, detalhe });
    const stop = t.stopAtExit ?? t.initialStop;
    // alvo trazido para perto e executado = realização antecipada, avaliada como saída à mão
    const nearerTarget =
      t.exitKind === 'alvo' && t.target !== null && t.exitPrice < t.target - i.tick / 2;
    const como = nearerTarget ? 'aproximou o alvo e saiu' : 'saiu à mão';
    if (t.exitKind === 'stop')
      push('ok', `Saiu no stop (a ${px(t.exitPrice)}): a regra de saída foi seguida.`);
    else if (t.exitKind === 'alvo' && !nearerTarget)
      push('ok', `Saiu no alvo planejado (a ${px(t.exitPrice)}).`);
    else if (t.exitKind === 'reinicio')
      push(
        'sem-dados',
        'O trade foi encerrado pelo reinício da conta, não por uma decisão de saída.',
      );
    else if (t.exitPrice <= t.entryPrice)
      push(
        'ok',
        `Saiu à mão a ${px(t.exitPrice)}, sem lucro (entrada a ${px(t.entryPrice)}): não houve lucro realizado cedo. Se foi medo antes do stop, vale anotar.`,
      );
    else if (t.target === null)
      push(
        'sem-dados',
        `Saiu à mão com lucro (a ${px(t.exitPrice)}), mas não havia alvo planejado para comparar.`,
      );
    else if (!closed) push('sem-dados', noCandles);
    else {
      const after = closed.filter((c) => candleKey(c) > kExit).slice(0, FEEDBACK_AFTER_BARS);
      let hit: { kind: 'stop' | 'alvo'; time: number } | null = null;
      for (const c of after) {
        // mesmo modelo do backtest: gap primeiro; stop e alvo no mesmo candle = stop primeiro
        const ex = exitFill(c, 'buy', stop ?? Number.NEGATIVE_INFINITY, t.target, false);
        if (ex) {
          hit = { kind: ex.kind, time: c.time };
          break;
        }
      }
      const stopTxt = stop === null ? 'sem stop' : `stop de ${px(stop)}`;
      if (hit?.kind === 'alvo') {
        const risk = t.initialStop !== null ? t.entryPrice - t.initialStop : 0;
        const missed =
          risk > 0
            ? ` Deixou na mesa cerca de ${formatNumber((t.target - t.exitPrice) / risk, 2)}R.`
            : '';
        push(
          'atencao',
          `Você ${como} a ${px(t.exitPrice)}, e depois o preço chegou ao alvo planejado de ${px(t.target)} (${when(hit.time)}) antes do ${stopTxt}: realizou cedo.${missed}`,
        );
      } else if (hit?.kind === 'stop')
        push(
          'ok',
          `Depois da sua saída a ${px(t.exitPrice)}, o preço bateu no ${stopTxt} (${when(hit.time)}) antes do alvo de ${px(t.target)}: sair foi bom.`,
        );
      else if (after.length >= FEEDBACK_AFTER_BARS)
        push(
          'ok',
          `Nos ${FEEDBACK_AFTER_BARS} candles ${tfLabel.toLowerCase()} depois da saída o preço não chegou ao alvo de ${px(t.target)}: sair antes não custou o alvo.`,
        );
      else
        push(
          'sem-dados',
          `Ainda não dá para avaliar: só ${after.length} de ${FEEDBACK_AFTER_BARS} candles ${tfLabel.toLowerCase()} fechados depois da saída, e o preço ainda não chegou ao alvo de ${px(t.target)} nem ao ${stopTxt}.`,
        );
    }
  }

  // ---- g. setup puro: a mesma ocorrência, levada até o fim pelo detector
  let pure: PureSetupComparison | null = null;
  {
    const titulo = 'Comparação com o setup "puro"';
    const occ = occurrence as Occurrence | null;
    const eng = engine as SetupEngine | null;
    if (!occ || !eng || !setup || !closed) {
      items.push({
        key: 'setup-puro',
        status: 'sem-dados',
        titulo,
        detalhe: pureWhy || 'Sem ocorrência do setup para comparar.',
      });
    } else {
      const label = SETUP_LABEL[setup];
      for (const c of closed) if (candleKey(c) >= kOpen) eng.push(c);
      const end = eng.events.find((e) => e.id === occ.id && e.state === 'encerrado');
      const entered =
        occ.state === 'acionado' ||
        eng.events.some((e) => e.id === occ.id && e.state === 'acionado');
      const realTxt = t.r === null ? 'sem R (entrou sem stop)' : rr(t.r);
      const base = {
        setup,
        label,
        exit: end?.exit ?? null,
        entered,
        realR: t.r,
      };
      const costs = ' O R do setup puro não tem custos; o seu já tem.';
      if (!end) {
        pure = { ...base, state: 'aberto', setupR: null };
        items.push({
          key: 'setup-puro',
          status: 'sem-dados',
          titulo,
          detalhe: `A ocorrência de ${label} ainda está em andamento: o resultado do setup puro sai quando ela encerrar. Seu trade: ${realTxt}.`,
        });
      } else {
        const setupR = end.resultR !== undefined ? end.resultR : entered ? null : 0;
        pure = { ...base, state: 'encerrado', setupR };
        const how = end.exit ? EXIT_LABEL[end.exit] : 'encerrado';
        const pureTxt =
          setupR === null
            ? null
            : entered
              ? `${rr(setupR)} (saída: ${how}, ${when(end.time)})`
              : `0R (não chegou a entrar: ${how} em ${when(end.time)})`;
        if (pureTxt === null)
          items.push({
            key: 'setup-puro',
            status: 'sem-dados',
            titulo,
            detalhe: `O detector encerrou a ocorrência de ${label} sem resultado em R. Seu trade: ${realTxt}.`,
          });
        else if (t.r === null || setupR === null)
          items.push({
            key: 'setup-puro',
            status: 'sem-dados',
            titulo,
            detalhe: `Setup puro (${label}): ${pureTxt}. Seu trade não tem R (entrou sem stop), então não dá para comparar.`,
          });
        else {
          const better = t.r >= setupR - FEEDBACK_R_TOLERANCE;
          items.push({
            key: 'setup-puro',
            status: better ? 'ok' : 'atencao',
            titulo,
            detalhe: `Seu trade: ${realTxt}. Setup puro (${label}): ${pureTxt}. ${
              better
                ? 'Você ficou igual ou melhor que a regra seguida à risca.'
                : 'A regra seguida à risca teria ido melhor.'
            }${costs}`,
          });
        }
      }
    }
  }

  return { tf: i.tf, items, pure };
}
