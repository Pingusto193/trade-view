import { SETUP_LABEL } from '@radar/core';
import {
  EXIT_CRITERIA,
  SETUP_IDS,
  PSYCH_CHECKS,
  TIMEFRAMES,
  TIMEFRAME_LABEL,
  type PsychCheck,
  type TradePlan,
} from '@radar/shared';
import { useState } from 'react';
import { imageToDataUrl } from '../lib/image';

const field = 'w-full rounded border border-line bg-bg px-2 py-1 text-sm';

export const emptyPlan = (): TradePlan => ({
  setup: '',
  tfContext: '1w',
  tfSetup: '1d',
  tfTrigger: '1d',
  aligned: false,
  exitCriterion: 'alvo',
  reason: '',
  checks: {},
  warnings: [],
  screenshot: null,
});

/**
 * Campos do plano de trade (SPEC §11) para o diário real. O que falta para "Liberado" vem de
 * `planMissing` (shared), a mesma regra da boleta do treino.
 */
export function PlanFields({
  value: p,
  onChange,
  missing,
}: {
  value: TradePlan;
  onChange(p: TradePlan): void;
  missing: readonly string[];
}) {
  const [imgErr, setImgErr] = useState<string | null>(null);
  const set = (x: Partial<TradePlan>) => onChange({ ...p, ...x });
  const tfSel = (k: 'tfContext' | 'tfSetup' | 'tfTrigger', label: string) => (
    <label className="block text-xs">
      <span className="text-muted">{label}</span>
      <select className={field} value={p[k]} onChange={(e) => set({ [k]: e.target.value })}>
        {TIMEFRAMES.map((t) => (
          <option key={t} value={t}>
            {TIMEFRAME_LABEL[t]}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="space-y-2" data-testid="plan-fields">
      <label className="block text-xs">
        <span className="text-muted">Setup</span>
        <select className={field} value={p.setup} onChange={(e) => set({ setup: e.target.value })}>
          <option value="">— escolha —</option>
          {SETUP_IDS.map((s) => (
            <option key={s} value={s}>
              {SETUP_LABEL[s]}
            </option>
          ))}
          <option value="outro">Outro (explique no motivo)</option>
        </select>
      </label>
      <div className="grid grid-cols-3 gap-2">
        {tfSel('tfContext', 'Contexto')}
        {tfSel('tfSetup', 'Setup')}
        {tfSel('tfTrigger', 'Gatilho')}
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={p.aligned}
          onChange={(e) => set({ aligned: e.target.checked })}
        />
        As três escalas estão a favor do trade
      </label>
      <label className="block text-xs">
        <span className="text-muted">Critério de saída</span>
        <select
          className={field}
          value={p.exitCriterion}
          onChange={(e) => set({ exitCriterion: e.target.value as TradePlan['exitCriterion'] })}
        >
          {Object.entries(EXIT_CRITERIA).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs">
        <span className="text-muted">Motivo técnico</span>
        <textarea
          className={field}
          rows={2}
          maxLength={1000}
          value={p.reason}
          onChange={(e) => set({ reason: e.target.value })}
          placeholder="Ex.: recuo à MME21 no diário com gatilho no 60 min, semanal subindo"
        />
      </label>
      <fieldset className="text-xs">
        <legend className="text-muted">Checklist psicológico</legend>
        {(Object.entries(PSYCH_CHECKS) as [PsychCheck, string][]).map(([k, l]) => (
          <label key={k} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={p.checks[k] === true}
              onChange={(e) => set({ checks: { ...p.checks, [k]: e.target.checked } })}
            />
            {l}
          </label>
        ))}
      </fieldset>
      <label className="block text-xs">
        <span className="text-muted">Print do gráfico ou da corretora</span>
        <input
          type="file"
          accept="image/*"
          className="block w-full text-xs"
          onChange={(e) => {
            const f = e.target.files?.[0];
            setImgErr(null);
            if (!f) return;
            imageToDataUrl(f)
              .then((url) => set({ screenshot: url }))
              .catch((err: Error) => setImgErr(err.message));
          }}
        />
        {p.screenshot && <span className="text-up">✓ print anexado</span>}
        {imgErr && <span className="text-down">{imgErr}</span>}
      </label>
      <p
        className={`text-xs ${missing.length ? 'text-warn' : 'text-up'}`}
        data-testid="plan-status"
      >
        {missing.length ? `Plano incompleto: falta ${missing.join(', ')}.` : '✓ Plano liberado'}
      </p>
    </div>
  );
}
