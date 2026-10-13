import type {
  FilterCheck,
  FilterCheckStatus,
  FilterOutcome,
  ScanAnalysis,
  ScanFilters,
  SlopeDir,
} from '@radar/shared';
import { SCAN_MA_LABEL, SCAN_PEAK_BARS, formatNumber, formatPercent } from '@radar/shared';
import { SETUP_LABEL, STATE_LABEL } from '../setups/types';

const pct = (v: number) => formatPercent(v, 0);
const side = (s: 'buy' | 'sell') => (s === 'buy' ? 'compra' : 'venda');
const NOT_VERIFIED = 'fundamentos não verificados';

/**
 * Aplica os filtros COMBINÁVEIS do scanner (SPEC §14) a uma linha. Pura: a mesma função roda no
 * servidor (varreduras salvas) e no navegador (filtrar de novo sem varrer de novo).
 * - Todos os filtros preenchidos precisam passar.
 * - Falta de dado nunca passa: indicador sem dados = "nodata"; fundamento ausente = "unverified" com o
 *   motivo "fundamentos não verificados".
 * - `chartOnly`: só os fundamentos ficaram sem verificar (passa na parte gráfica).
 */
export function applyFilters(a: ScanAnalysis | null, f: ScanFilters): FilterOutcome {
  if (!a) return { pass: false, chartOnly: false, checks: [], reasons: ['sem dados para filtrar'] };
  const checks: FilterCheck[] = [];
  const add = (key: string, label: string, status: FilterCheckStatus, detail: string) =>
    checks.push({ key, label, status, detail });

  if (f.setup) {
    const sel = f.setup;
    const hits = a.setups.filter(
      (h) =>
        sel.ids.includes(h.setup) &&
        sel.states.includes(h.state) &&
        (sel.side === 'any' || h.side === sel.side),
    );
    const good = sel.withHigher ? hits.filter((h) => !h.againstHigher) : hits;
    const names = sel.ids.map((id) => SETUP_LABEL[id]).join(', ');
    const states = sel.states.map((s) => STATE_LABEL[s].toLowerCase()).join('/');
    if (good.length)
      add(
        'setup',
        'Setup',
        'ok',
        good
          .map(
            (h) =>
              `${SETUP_LABEL[h.setup]} ${STATE_LABEL[h.state].toLowerCase()} (${side(h.side)})`,
          )
          .join('; '),
      );
    else if (hits.length)
      add('setup', 'Setup', 'fail', `${names}: só contra a escala maior (aviso vermelho)`);
    else add('setup', 'Setup', 'fail', `nenhum ${names} ativo (${states})`);
  }

  if (f.trend) {
    if (f.trend.includes(a.trend)) add('trend', 'Tendência', 'ok', `tendência ${a.trend}`);
    else
      add(
        'trend',
        'Tendência',
        a.trend === 'indefinida' ? 'nodata' : 'fail',
        `tendência ${a.trend} (pedido: ${f.trend.join(' ou ')})`,
      );
  }

  if (f.adxMin !== undefined) {
    if (a.adx === null) add('adx', 'ADX', 'nodata', 'ADX indisponível (poucos candles)');
    else if (a.adx >= f.adxMin)
      add(
        'adx',
        'ADX',
        'ok',
        `ADX ${formatNumber(a.adx, 1)} (mínimo ${formatNumber(f.adxMin, 0)})`,
      );
    else
      add(
        'adx',
        'ADX',
        'fail',
        `ADX ${formatNumber(a.adx, 1)} abaixo de ${formatNumber(f.adxMin, 0)}`,
      );
  }

  if (f.respected) {
    const r = a.respected;
    const want = f.respected.map((m) => SCAN_MA_LABEL[m]).join(' ou ');
    if (r && f.respected.includes(r.ma))
      add(
        'respected',
        'Média respeitada',
        'ok',
        `respeita a ${SCAN_MA_LABEL[r.ma]} (${r.hits} de ${r.of} recuos)`,
      );
    else
      add(
        'respected',
        'Média respeitada',
        'fail',
        r
          ? `respeita a ${SCAN_MA_LABEL[r.ma]}, não a ${want}`
          : 'nenhuma média respeitada com clareza (ou menos de 3 recuos confirmados)',
      );
  }

  for (const sf of f.slopes ?? []) {
    const weekly = sf.scale === '1w';
    const name = `${SCAN_MA_LABEL[sf.ma]}${weekly ? ' semanal' : ''}`;
    const dir: SlopeDir | null =
      sf.scale === '1w' ? (a.weekly?.slopes[sf.ma] ?? null) : a.slopes[sf.ma];
    const key = `slope:${sf.scale}:${sf.ma}`;
    if (dir === null)
      add(
        key,
        name,
        'nodata',
        weekly
          ? a.weekly
            ? `${name}: sem dados suficientes (${a.weekly.bars} semanas fechadas)`
            : `${name}: sem candles semanais`
          : `${name}: sem dados suficientes (${a.bars} candles fechados)`,
      );
    else if (dir === sf.dir) add(key, name, 'ok', `${name} ${dir}`);
    else add(key, name, 'fail', `${name} ${dir} (pedido: ${sf.dir})`);
  }

  if (f.minDrawdown) {
    const { ref, value } = f.minDrawdown;
    const v = ref === 'tf' ? a.drawdown.tf : a.drawdown.w52;
    const top = ref === 'tf' ? `do topo de ${SCAN_PEAK_BARS} candles` : 'do topo de 52 semanas';
    if (v === null)
      add(
        'drawdown',
        'Queda',
        'nodata',
        ref === 'tf'
          ? `menos de ${SCAN_PEAK_BARS} candles fechados para medir a queda`
          : 'menos de 52 semanas fechadas para medir a queda',
      );
    else if (v >= value)
      add('drawdown', 'Queda', 'ok', `queda de ${pct(v)} desde ${top} (mínimo ${pct(value)})`);
    else
      add('drawdown', 'Queda', 'fail', `queda de ${pct(v)} desde ${top}, menor que ${pct(value)}`);
  }

  if (f.minRelVolume !== undefined) {
    const rv = a.relVolume;
    const min = formatNumber(f.minRelVolume, 1);
    if (rv === null) add('volume', 'Volume relativo', 'nodata', 'sem dado de volume');
    else if (rv >= f.minRelVolume)
      add(
        'volume',
        'Volume relativo',
        'ok',
        `volume ${formatNumber(rv, 1)}× a média (mínimo ${min}×)`,
      );
    else
      add(
        'volume',
        'Volume relativo',
        'fail',
        `volume ${formatNumber(rv, 1)}× a média, abaixo de ${min}×`,
      );
  }

  if (f.fundamentals) {
    const fu = a.fundamentals;
    // o porquê do campo nulo (histórico curto, fonte fora do ar...) vem nas notas da fonte
    const why = (prefix: string) => {
      const n = fu?.notes?.find((x) => x.startsWith(prefix));
      return n ? ` (${n.slice(prefix.length).trim().replace(/\.$/, '')})` : '';
    };
    const missing = (what: string, prefix: string) =>
      fu
        ? `${NOT_VERIFIED}: ${fu.source} sem dado de ${what}${why(prefix)}`
        : `${NOT_VERIFIED} (sem fonte de fundamentos para este ativo)`;
    if (f.fundamentals.minEpsGrowth !== undefined) {
      const min = f.fundamentals.minEpsGrowth;
      const eps = fu?.epsGrowth2y ?? null;
      if (fu?.epsNegative)
        add('eps', 'LPA', 'fail', 'LPA negativo ou zero no último exercício (prejuízo)');
      else if (eps === null) add('eps', 'LPA', 'unverified', missing('LPA', 'LPA:'));
      else if (eps >= min)
        add('eps', 'LPA', 'ok', `LPA cresceu ${pct(eps)} a.a. em 2 anos (mínimo ${pct(min)})`);
      else
        add('eps', 'LPA', 'fail', `LPA cresceu ${pct(eps)} a.a. em 2 anos, menos que ${pct(min)}`);
    }
    if (f.fundamentals.revenueNoDecline) {
      const rev = fu?.revenueNoDecline ?? null;
      if (rev === null) add('revenue', 'Receita', 'unverified', missing('receita', 'Receita:'));
      else if (rev) add('revenue', 'Receita', 'ok', 'receita sem queda');
      else add('revenue', 'Receita', 'fail', 'receita em queda');
    }
  }

  const failing = checks.filter((c) => c.status !== 'ok');
  const pass = failing.length === 0;
  return {
    pass,
    chartOnly: !pass && failing.every((c) => c.status === 'unverified'),
    checks,
    reasons: failing.map((c) => c.detail),
  };
}
