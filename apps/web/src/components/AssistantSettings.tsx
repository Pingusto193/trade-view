import type { AssistantSettings } from '@radar/shared';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAssistant } from '../lib/assistant-store';

const field = 'w-full rounded border border-line bg-bg px-2 py-1 text-sm';
const num = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(',', '.')));

/** Configuração do assistente com IA (SPEC §16): opcional, desligado por padrão. */
export function AssistantSettingsPanel() {
  const { settings, load, set } = useAssistant();
  const [form, setForm] = useState({
    enabled: false,
    model: '',
    limit: '5',
    pin: '',
    pout: '',
    key: '',
  });
  const [models, setModels] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!settings) return;
    setForm((f) => ({
      ...f,
      enabled: settings.enabled,
      model: settings.model,
      limit: String(settings.monthlyLimitUsd),
      pin: String(settings.priceInPerMTok),
      pout: String(settings.priceOutPerMTok),
    }));
  }, [settings]);
  const save = async (extra: { clearKey?: boolean } = {}) => {
    setMsg(null);
    setErr(null);
    const problem =
      form.model.trim().length < 3
        ? 'Informe o modelo (ex.: o da página de preços da Anthropic, ou use "Ver modelos da minha chave").'
        : !(num(form.limit) >= 0.5 && num(form.limit) <= 1000)
          ? 'O limite por mês vai de US$ 0,50 a US$ 1.000.'
          : !(num(form.pin) >= 0) || !(num(form.pout) >= 0)
            ? 'Preços por milhão de tokens: use números (ex.: 4 e 20).'
            : form.key.trim() && form.key.trim().length < 20
              ? 'Essa chave parece curta demais: copie a chave inteira.'
              : null;
    if (problem) {
      setErr(problem);
      return;
    }
    try {
      const s = await api<AssistantSettings>('/api/assistant/settings', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: extra.clearKey ? false : form.enabled,
          model: form.model,
          monthlyLimitUsd: num(form.limit),
          priceInPerMTok: num(form.pin),
          priceOutPerMTok: num(form.pout),
          ...(form.key.trim() ? { apiKey: form.key.trim() } : {}),
          ...extra,
        }),
      });
      set(s);
      setForm((f) => ({ ...f, key: '' }));
      setMsg('Salvo.');
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <section className="space-y-2 rounded border border-line p-3" aria-label="Assistente com IA">
      <h2 className="font-semibold">Assistente com IA (opcional)</h2>
      <p className="text-xs text-muted">
        Usa a API da Anthropic com a <b>sua</b> chave (pagamento por uso, na sua conta da
        Anthropic). A chave fica só no servidor, criptografada. O que é enviado: a pergunta e o
        resumo da tela (ativo, indicadores, setups, estatísticas) — você vê antes de enviar. Nunca
        vai senha nem dado da conta.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
        />
        Ligado
      </label>
      <label className="block text-xs">
        <span className="text-muted">
          Chave da API{' '}
          {settings?.keyHint ? `(guardada: ${settings.keyHint})` : '(nenhuma guardada)'}
        </span>
        <input
          className={field}
          type="password"
          autoComplete="off"
          value={form.key}
          onChange={(e) => setForm({ ...form, key: e.target.value })}
          placeholder="sk-ant-…"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2 block text-xs">
          <span className="text-muted">Modelo</span>
          <input
            className={field}
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
          />
        </label>
        <label className="block text-xs">
          <span className="text-muted">Limite por mês (US$)</span>
          <input
            className={field}
            inputMode="decimal"
            value={form.limit}
            onChange={(e) => setForm({ ...form, limit: e.target.value })}
          />
        </label>
        <span />
        <label className="block text-xs">
          <span className="text-muted">Preço entrada (US$/milhão de tokens)</span>
          <input
            className={field}
            inputMode="decimal"
            value={form.pin}
            onChange={(e) => setForm({ ...form, pin: e.target.value })}
          />
        </label>
        <label className="block text-xs">
          <span className="text-muted">Preço saída (US$/milhão de tokens)</span>
          <input
            className={field}
            inputMode="decimal"
            value={form.pout}
            onChange={(e) => setForm({ ...form, pout: e.target.value })}
          />
        </label>
      </div>
      <p className="text-[11px] text-muted">
        Confira modelo e preços na página de preços da Anthropic: eles mudam. O limite é conferido
        antes de cada pergunta pelo pior caso; o gasto é estimado pelos preços acima.
        {settings &&
          ` Este mês: US$ ${settings.spentUsd.toFixed(2)} em ${settings.requests} perguntas.`}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded border border-line px-3 py-2 text-sm hover:bg-panel-2"
          onClick={() => void save()}
        >
          Salvar
        </button>
        <button
          type="button"
          className="rounded border border-line px-3 py-2 text-sm hover:bg-panel-2 disabled:opacity-50"
          disabled={!settings?.keyHint}
          onClick={() => {
            api<{ models: string[] }>('/api/assistant/models')
              .then((r) => setModels(r.models))
              .catch((e: Error) => setErr(e.message));
          }}
        >
          Ver modelos da minha chave
        </button>
        {settings?.keyHint && (
          <button
            type="button"
            className="rounded border border-line px-3 py-2 text-sm text-down hover:bg-panel-2"
            onClick={() => void save({ clearKey: true })}
          >
            Apagar chave
          </button>
        )}
      </div>
      {models && (
        <ul className="flex flex-wrap gap-1 text-xs">
          {models.map((m) => (
            <li key={m}>
              <button
                type="button"
                className="rounded border border-line px-2 py-0.5"
                onClick={() => setForm({ ...form, model: m })}
              >
                {m}
              </button>
            </li>
          ))}
        </ul>
      )}
      {msg && (
        <p className="text-xs text-up" role="status">
          {msg}
        </p>
      )}
      {err && (
        <p className="text-xs text-down" role="alert">
          {err}
        </p>
      )}
    </section>
  );
}
