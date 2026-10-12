import {
  CHANNELS,
  CHANNEL_LABEL,
  INDICATOR_RULES,
  INDICATOR_RULE_LABEL,
  SETUP_IDS,
  TIMEFRAMES,
  TIMEFRAME_LABEL,
  alertInputSchema,
  type AlertCondition,
  type AlertInput,
  type Channel,
  type Timeframe,
} from '@radar/shared';
import { SETUP_LABEL } from '@radar/core';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAlertForm, useAlerts } from '../lib/alerts-store';
import { SymbolSearch } from './SymbolSearch';

type Kind = AlertCondition['kind'];

const KIND_LABEL: Record<Kind, string> = {
  price: 'Preço',
  drawing: 'Desenho',
  indicator: 'Indicador',
  setup: 'Setup',
  system: 'Fonte de dados caiu',
};

function defaultCondition(kind: Kind, level?: number): AlertCondition {
  switch (kind) {
    case 'price':
      return { kind, level: level ?? 1, direction: 'up' };
    case 'indicator':
      return { kind, rule: 'ema-turn-up', period: 9, ma: 'ema', stdDev: 3, level: 25 };
    case 'setup':
      return { kind, setups: ['s91'], states: ['armado', 'acionado'], sides: ['buy'] };
    case 'system':
      return { kind, event: 'source-down' };
    case 'drawing':
      return { kind, drawingId: '', event: 'cross-up' };
  }
}

const field = 'rounded border border-line bg-bg px-2 py-1 text-sm';

/** Criar/editar alerta (SPEC §10). Abre de qualquer tela via `useAlertForm`. */
export function AlertForm() {
  const draft = useAlertForm((s) => s.draft);
  const close = useAlertForm((s) => s.close);
  if (!draft) return null;
  return <Form key={draft.id ?? 'novo'} draft={draft} onClose={close} />;
}

function Form({
  draft,
  onClose,
}: {
  draft: Partial<AlertInput> & { id?: string };
  onClose(): void;
}) {
  const [symbolId, setSymbol] = useState(draft.symbolId ?? 'binance:BTCUSDT');
  const [tf, setTf] = useState<Timeframe>(draft.tf ?? '1d');
  const [cond, setCond] = useState<AlertCondition>(draft.condition ?? defaultCondition('price'));
  const [trigger, setTrigger] = useState<'touch' | 'close'>(draft.trigger ?? 'close');
  const [channels, setChannels] = useState<Channel[]>(draft.channels ?? ['push']);
  const [repeat, setRepeat] = useState<'once' | 'every'>(draft.repeat ?? 'once');
  const [cooldownMin, setCooldown] = useState(draft.cooldownMin ?? 15);
  const [note, setNote] = useState(draft.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const touchAllowed = cond.kind === 'price' || cond.kind === 'drawing';

  // alerta de preço novo: começa no último preço do ativo
  const needsLevel = cond.kind === 'price' && !draft.id && draft.condition === undefined;
  useEffect(() => {
    if (!needsLevel) return;
    let alive = true;
    void api<{ quotes: Record<string, { last?: number | null }> }>(
      `/api/quotes?ids=${encodeURIComponent(symbolId)}`,
    )
      .then((r) => {
        const last = r.quotes[symbolId]?.last;
        if (alive && typeof last === 'number')
          setCond((c) => (c.kind === 'price' ? { ...c, level: last } : c));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [symbolId, needsLevel]);

  const setKind = (k: Kind) => {
    setCond(defaultCondition(k, cond.kind === 'price' ? cond.level : undefined));
    if (k !== 'price' && k !== 'drawing') setTrigger('close');
  };

  const submit = async () => {
    setError(null);
    const parsed = alertInputSchema.safeParse({
      symbolId,
      tf,
      condition: cond,
      trigger: touchAllowed ? trigger : 'close',
      channels,
      repeat,
      cooldownMin,
      enabled: true,
      note,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Confira os campos');
      return;
    }
    if (channels.length === 0) {
      setError('Escolha pelo menos um canal.');
      return;
    }
    setBusy(true);
    try {
      if (draft.id) await useAlerts.getState().update(draft.id, parsed.data);
      else await useAlerts.getState().create(parsed.data);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      role="dialog"
      aria-label={draft.id ? 'Editar alerta' : 'Novo alerta'}
    >
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-xl border border-line bg-panel p-3 text-sm sm:rounded-xl">
        <div className="mb-2 flex items-center gap-2">
          <b>{draft.id ? 'Editar alerta' : 'Novo alerta'}</b>
          <button className="ml-auto text-muted" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <SymbolSearch current={symbolId} onPick={setSymbol} />
            <select
              value={tf}
              onChange={(e) => setTf(e.target.value as Timeframe)}
              className={field}
              aria-label="Escala"
            >
              {TIMEFRAMES.map((t) => (
                <option key={t} value={t}>
                  {TIMEFRAME_LABEL[t]}
                </option>
              ))}
            </select>
          </div>

          {cond.kind !== 'drawing' && (
            <div className="flex flex-wrap gap-1" role="group" aria-label="Tipo de alerta">
              {(['price', 'indicator', 'setup', 'system'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  aria-pressed={cond.kind === k}
                  className={`rounded border px-2 py-1 text-xs ${cond.kind === k ? 'border-accent bg-accent/20 text-accent' : 'border-line text-muted'}`}
                >
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
          )}

          {cond.kind === 'price' && (
            <div className="flex items-center gap-2">
              <select
                value={cond.direction}
                onChange={(e) => setCond({ ...cond, direction: e.target.value as 'up' | 'down' })}
                className={field}
                aria-label="Direção"
              >
                <option value="up">Cruzar para cima</option>
                <option value="down">Cruzar para baixo</option>
              </select>
              <input
                type="number"
                step="any"
                inputMode="decimal"
                value={Number.isFinite(cond.level) ? cond.level : ''}
                onChange={(e) => setCond({ ...cond, level: Number(e.target.value) })}
                className={`${field} w-32`}
                aria-label="Preço"
              />
            </div>
          )}

          {cond.kind === 'drawing' && (
            <div className="space-y-1">
              <p className="text-xs text-muted">Alerta ligado ao desenho selecionado no gráfico.</p>
              <select
                value={cond.event}
                onChange={(e) => setCond({ ...cond, event: e.target.value as typeof cond.event })}
                className={field}
                aria-label="Evento do desenho"
              >
                <option value="cross-up">Cruzar a linha para cima</option>
                <option value="cross-down">Cruzar a linha para baixo</option>
                <option value="enter">Entrar na zona</option>
                <option value="exit">Sair da zona</option>
              </select>
              <p className="text-[11px] text-muted">
                Linhas de tendência e raios são prolongados para a direita; zonas valem para a
                direita, sem fim.
              </p>
            </div>
          )}

          {cond.kind === 'indicator' && (
            <div className="space-y-2">
              <select
                value={cond.rule}
                onChange={(e) => setCond({ ...cond, rule: e.target.value as typeof cond.rule })}
                className={`${field} w-full`}
                aria-label="Condição do indicador"
              >
                {INDICATOR_RULES.map((r) => (
                  <option key={r} value={r}>
                    {INDICATOR_RULE_LABEL[r]}
                  </option>
                ))}
              </select>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <label className="flex items-center gap-1">
                  Período
                  <input
                    type="number"
                    min={2}
                    value={cond.period}
                    onChange={(e) => setCond({ ...cond, period: Number(e.target.value) })}
                    className={`${field} w-16`}
                  />
                </label>
                {cond.rule.startsWith('close-cross-ma') && (
                  <select
                    value={cond.ma}
                    onChange={(e) => setCond({ ...cond, ma: e.target.value as 'ema' | 'sma' })}
                    className={field}
                    aria-label="Tipo de média"
                  >
                    <option value="ema">Exponencial (MME)</option>
                    <option value="sma">Aritmética (MMA)</option>
                  </select>
                )}
                {cond.rule.includes('bb') && (
                  <label className="flex items-center gap-1">
                    Desvios
                    <input
                      type="number"
                      step={0.5}
                      value={cond.stdDev}
                      onChange={(e) => setCond({ ...cond, stdDev: Number(e.target.value) })}
                      className={`${field} w-16`}
                    />
                  </label>
                )}
                {cond.rule.startsWith('adx') && (
                  <label className="flex items-center gap-1">
                    Nível
                    <input
                      type="number"
                      value={cond.level}
                      onChange={(e) => setCond({ ...cond, level: Number(e.target.value) })}
                      className={`${field} w-16`}
                    />
                  </label>
                )}
              </div>
            </div>
          )}

          {cond.kind === 'setup' && (
            <div className="space-y-2 text-xs">
              <div className="flex flex-wrap gap-1" role="group" aria-label="Setups">
                {SETUP_IDS.map((s) => {
                  const on = cond.setups.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setCond({
                          ...cond,
                          setups: on ? cond.setups.filter((x) => x !== s) : [...cond.setups, s],
                        })
                      }
                      className={`rounded border px-1.5 py-0.5 ${on ? 'border-accent text-text' : 'border-line text-muted'}`}
                    >
                      {SETUP_LABEL[s].replace('Setup ', '')}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-3">
                {(['radar', 'armado', 'acionado', 'encerrado'] as const).map((st) => (
                  <label key={st} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={cond.states.includes(st)}
                      onChange={(e) =>
                        setCond({
                          ...cond,
                          states: e.target.checked
                            ? [...cond.states, st]
                            : cond.states.filter((x) => x !== st),
                        })
                      }
                    />
                    {st === 'encerrado' ? 'encerrado/desarmado' : st}
                  </label>
                ))}
              </div>
              <div className="flex gap-3">
                {(['buy', 'sell'] as const).map((sd) => (
                  <label key={sd} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={cond.sides.includes(sd)}
                      onChange={(e) =>
                        setCond({
                          ...cond,
                          sides: e.target.checked
                            ? [...cond.sides, sd]
                            : cond.sides.filter((x) => x !== sd),
                        })
                      }
                    />
                    {sd === 'buy' ? 'compra' : 'venda (espelhada)'}
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-muted">
                Usa os mesmos parâmetros de setup das suas preferências. Avaliado no fechamento do
                candle.
              </p>
            </div>
          )}

          {cond.kind === 'system' && (
            <p className="text-xs text-muted">
              Avisa quando a fonte de dados deste ativo ficar com erro por mais de 3 minutos.
            </p>
          )}

          {touchAllowed && (
            <div className="flex gap-3 text-xs" role="radiogroup" aria-label="Quando avaliar">
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={trigger === 'close'}
                  onChange={() => setTrigger('close')}
                />
                No fechamento do candle
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={trigger === 'touch'}
                  onChange={() => setTrigger('touch')}
                />
                No toque (intrabar)
              </label>
            </div>
          )}

          <fieldset className="text-xs">
            <legend className="mb-1 text-muted">Canais</legend>
            <div className="flex flex-wrap gap-3">
              {CHANNELS.map((ch) => (
                <label key={ch} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={channels.includes(ch)}
                    onChange={(e) =>
                      setChannels(
                        e.target.checked ? [...channels, ch] : channels.filter((x) => x !== ch),
                      )
                    }
                  />
                  {CHANNEL_LABEL[ch]}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              value={repeat}
              onChange={(e) => setRepeat(e.target.value as 'once' | 'every')}
              className={field}
              aria-label="Repetição"
            >
              <option value="once">Avisar uma vez e desligar</option>
              <option value="every">Avisar sempre que acontecer</option>
            </select>
            {repeat === 'every' && (
              <label className="flex items-center gap-1">
                intervalo mínimo
                <input
                  type="number"
                  min={1}
                  value={cooldownMin}
                  onChange={(e) => setCooldown(Number(e.target.value))}
                  className={`${field} w-16`}
                />
                min
              </label>
            )}
          </div>

          <input
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 280))}
            placeholder="Nota (opcional): por que este alerta?"
            className={`${field} w-full`}
            aria-label="Nota"
          />

          {error && <p className="text-xs text-down">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy}
              className="rounded bg-accent px-3 py-1.5 font-semibold text-black disabled:opacity-50"
            >
              {draft.id ? 'Salvar' : 'Criar alerta'}
            </button>
            <button type="button" onClick={onClose} className="rounded border border-line px-3">
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
