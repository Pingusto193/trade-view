import { SETUP_LABEL } from '@radar/core';
import {
  CHANNELS,
  CHANNEL_LABEL,
  INDICATOR_RULE_LABEL,
  TIMEFRAME_LABEL,
  formatDateTime,
  formatNumber,
  type Alert,
  type Channel,
} from '@radar/shared';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toInput, useAlertForm, useAlerts } from '../lib/alerts-store';
import { api } from '../lib/api';
import { enablePush, pushSupport } from '../lib/push';

type Tab = 'alertas' | 'historico' | 'canais';

export function describeAlert(a: Alert): string {
  const c = a.condition;
  switch (c.kind) {
    case 'price':
      return `Preço cruzar ${c.direction === 'up' ? 'para cima' : 'para baixo'} ${formatNumber(c.level, 2)}`;
    case 'drawing':
      return {
        'cross-up': 'Cruzar a linha desenhada para cima',
        'cross-down': 'Cruzar a linha desenhada para baixo',
        enter: 'Entrar na zona desenhada',
        exit: 'Sair da zona desenhada',
      }[c.event];
    case 'indicator':
      return `${INDICATOR_RULE_LABEL[c.rule]} (${c.period})`;
    case 'setup':
      return `${c.setups.map((s) => SETUP_LABEL[s].replace('Setup ', '')).join(', ')}: ${c.states.join(', ')}`;
    case 'system':
      return 'Fonte de dados com erro';
  }
}

/** Link relativo do gráfico a partir da URL absoluta do disparo. */
function chartLink(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return '/grafico';
  }
}

function AlertList() {
  const { alerts, loaded, load, update, remove } = useAlerts();
  const open = useAlertForm((s) => s.open);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div>
      <button
        className="mb-3 rounded bg-accent px-3 py-1.5 text-sm font-semibold text-black"
        onClick={() => open({})}
      >
        + Novo alerta
      </button>
      {!loaded && <p className="text-sm text-muted">Carregando…</p>}
      {loaded && alerts.length === 0 && (
        <p className="text-sm text-muted">
          Nenhum alerta. Crie aqui, pelo sino 🔔 do gráfico, por um desenho selecionado ou pelo
          painel de Setups.
        </p>
      )}
      <ul className="divide-y divide-line rounded border border-line">
        {alerts.map((a) => (
          <li key={a.id} className="flex items-start gap-2 p-2 text-sm">
            <input
              type="checkbox"
              checked={a.enabled}
              onChange={(e) => void update(a.id, { ...toInput(a), enabled: e.target.checked })}
              aria-label={`Ligar alerta ${describeAlert(a)}`}
              className="mt-1"
            />
            <div className="min-w-0 flex-1">
              <p className={a.enabled ? '' : 'text-muted'}>
                <b>{a.symbolId.split(':')[1]}</b> · {TIMEFRAME_LABEL[a.tf]} · {describeAlert(a)}
              </p>
              <p className="text-xs text-muted">
                {a.trigger === 'touch' ? 'no toque' : 'no fechamento'} ·{' '}
                {a.channels.map((c) => CHANNEL_LABEL[c]).join(', ')} ·{' '}
                {a.repeat === 'once' ? 'uma vez' : `sempre (mín. ${a.cooldownMin} min)`}
                {a.lastFiredAt ? ` · último disparo ${formatDateTime(a.lastFiredAt)}` : ''}
              </p>
              {a.note && <p className="text-xs text-muted">“{a.note}”</p>}
              {a.status && <p className="text-xs text-warn">⚠ {a.status}</p>}
            </div>
            <button
              className="text-xs text-accent"
              onClick={() => open({ ...toInput(a), id: a.id })}
            >
              Editar
            </button>
            <button
              className="text-xs text-down"
              onClick={() => {
                if (window.confirm('Apagar este alerta?')) void remove(a.id);
              }}
            >
              Apagar
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function History() {
  const { fires, loadHistory } = useAlerts();
  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);
  if (fires.length === 0) return <p className="text-sm text-muted">Nenhum disparo ainda.</p>;
  return (
    <ul className="divide-y divide-line rounded border border-line">
      {fires.map((f) => (
        <li key={f.id} className="p-2 text-sm">
          <p className="text-xs text-muted">{formatDateTime(f.firedAt)}</p>
          <p>
            <b>{f.title}</b> — {f.body}
          </p>
          <p className="mt-0.5 flex flex-wrap gap-2 text-[11px]">
            {Object.entries(f.delivery).map(([ch, r]) => (
              <span
                key={ch}
                className={r === 'ok' ? 'text-up' : r === 'silenciado' ? 'text-muted' : 'text-down'}
              >
                {CHANNEL_LABEL[ch as Channel]}: {r}
              </span>
            ))}
            <Link to={chartLink(f.url)} className="text-accent underline">
              Abrir gráfico
            </Link>
          </p>
        </li>
      ))}
    </ul>
  );
}

function TestButton({ ch }: { ch: Channel }) {
  const [r, setR] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        className="rounded border border-line px-2 py-0.5 text-xs"
        onClick={async () => {
          setR('enviando…');
          try {
            setR(await useAlerts.getState().test(ch));
          } catch (e) {
            setR(`erro: ${(e as Error).message}`);
          }
        }}
      >
        Enviar teste
      </button>
      {r && (
        <span
          className={`text-xs ${r === 'ok' ? 'text-up' : 'text-muted'}`}
          data-testid={`test-${ch}`}
        >
          {r === 'ok' ? 'enviado ✓' : r}
        </span>
      )}
    </span>
  );
}

/** Passo a passo do iPhone (SPEC §10): instalado na Tela de Início, iOS 16.4+, permissão por toque. */
function IphoneGuide() {
  const s = pushSupport();
  const okVersion = s.iosVersion !== null && s.iosVersion >= 16.4;
  const step = (ok: boolean | null, text: string) => (
    <li className="flex gap-2">
      <span aria-hidden>{ok === null ? '•' : ok ? '✅' : '⬜'}</span>
      <span>{text}</span>
    </li>
  );
  return (
    <section className="rounded border border-line p-3 text-sm" aria-label="Notificações no iPhone">
      <h3 className="font-semibold">📱 Notificações no iPhone</h3>
      <ol className="mt-2 space-y-1">
        {step(
          s.ios ? okVersion : null,
          s.ios
            ? `iOS ${s.iosVersion ?? '?'}: precisa ser 16.4 ou mais novo${okVersion ? '' : ' — atualize em Ajustes › Geral › Atualização de Software'}.`
            : 'Use um iPhone com iOS 16.4 ou mais novo.',
        )}
        {step(
          s.ios ? s.standalone : null,
          'Instale o app: no Safari, toque em Compartilhar (quadrado com seta) › "Adicionar à Tela de Início" e abra o Radar pelo ícone.',
        )}
        {step(
          s.permission === 'granted',
          'Dentro do app instalado, toque em "Ativar notificações neste aparelho" (abaixo) e aceite.',
        )}
        {step(null, 'Toque em "Enviar teste". A notificação deve chegar mesmo com o app fechado.')}
      </ol>
      {s.ios && !s.standalone && (
        <p className="mt-2 rounded bg-warn/15 p-2 text-xs text-warn">
          Você está numa aba do Safari: aqui o iPhone não deixa ativar notificações. Abra pelo ícone
          da Tela de Início.{' '}
          <Link to="/instalar" className="underline">
            Como instalar
          </Link>
        </p>
      )}
    </section>
  );
}

function Channels() {
  const { settings, loadSettings, saveSettings } = useAlerts();
  const [msg, setMsg] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);
  if (!settings) return <p className="text-sm text-muted">Carregando…</p>;
  const sup = pushSupport();
  const base = {
    quietEnabled: settings.quietEnabled,
    quietStart: settings.quietStart,
    quietEnd: settings.quietEnd,
  };
  const save = async (patch: Parameters<typeof saveSettings>[0]) => {
    setMsg(null);
    try {
      await saveSettings(patch);
      setMsg('Salvo.');
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const box = 'space-y-2 rounded border border-line p-3 text-sm';
  return (
    <div className="space-y-3">
      {msg && <p className="text-xs text-muted">{msg}</p>}
      <section className={box} aria-label="Notificação no aparelho">
        <h3 className="font-semibold">🔔 {CHANNEL_LABEL.push}</h3>
        {!sup.supported && (
          <p className="text-xs text-warn">Este navegador não suporta notificações push.</p>
        )}
        <button
          className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
          disabled={!sup.supported || (sup.ios && !sup.standalone)}
          onClick={async () => {
            setMsg(null);
            try {
              await enablePush(settings.vapidPublicKey); // direto do toque (exigência do iPhone)
              await loadSettings();
              setMsg('Notificações ativadas neste aparelho.');
            } catch (e) {
              setMsg((e as Error).message);
            }
          }}
        >
          Ativar notificações neste aparelho
        </button>
        <ul className="text-xs">
          {settings.pushDevices.map((d) => (
            <li key={d.id} className="flex items-center gap-2">
              <span>
                {d.label} · desde {formatDateTime(d.createdAt)}
                {d.lastOkAt ? ` · último envio ok ${formatDateTime(d.lastOkAt)}` : ''}
              </span>
              <button
                className="text-down"
                onClick={async () => {
                  await api(`/api/notify/push/${d.id}`, { method: 'DELETE' }).catch(() => null);
                  await loadSettings();
                }}
              >
                remover
              </button>
            </li>
          ))}
          {settings.pushDevices.length === 0 && (
            <li className="text-muted">Nenhum aparelho ativado.</li>
          )}
        </ul>
        <TestButton ch="push" />
      </section>

      <IphoneGuide />

      <section className={box} aria-label="Telegram">
        <h3 className="font-semibold">✈️ Telegram (bot seu)</h3>
        <ol className="list-decimal space-y-1 pl-5 text-xs text-muted">
          <li>No Telegram, fale com @BotFather, mande /newbot e siga as perguntas.</li>
          <li>Copie o token que ele mostra e cole abaixo (fica guardado cifrado no servidor).</li>
          <li>Abra o seu bot novo e mande /start. Depois toque em "Detectar meu chat".</li>
        </ol>
        <div className="flex flex-wrap gap-2">
          <input
            value={token}
            onChange={(e) => setToken(e.target.value.trim())}
            placeholder={
              settings.telegramConfigured ? 'token salvo (cole outro para trocar)' : '123456:ABC…'
            }
            className="min-w-0 flex-1 rounded border border-line bg-bg px-2 py-1 text-xs"
            aria-label="Token do bot"
            autoComplete="off"
          />
          <button
            className="rounded border border-line px-2 text-xs"
            onClick={() => void save({ ...base, telegramToken: token }).then(() => setToken(''))}
            disabled={!token}
          >
            Salvar token
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            className="rounded border border-line px-2 py-0.5"
            disabled={!settings.telegramConfigured}
            onClick={async () => {
              setMsg(null);
              try {
                const c = await api<{ chatId: string; name: string }>(
                  '/api/notify/telegram/detect',
                  { method: 'POST' },
                );
                setMsg(`Chat encontrado: ${c.name} (${c.chatId}).`);
              } catch (e) {
                setMsg((e as Error).message);
              }
              await loadSettings();
            }}
          >
            Detectar meu chat
          </button>
          <span className="text-muted">Chat: {settings.telegramChatId ?? 'não definido'}</span>
          {settings.telegramConfigured && (
            <button
              className="text-down"
              onClick={() => void save({ ...base, telegramToken: null, telegramChatId: null })}
            >
              desligar Telegram
            </button>
          )}
        </div>
        <TestButton ch="telegram" />
      </section>

      <section className={box} aria-label="E-mail">
        <h3 className="font-semibold">✉️ E-mail</h3>
        {!settings.emailAvailable && (
          <p className="text-xs text-warn">
            O servidor ainda não tem SMTP configurado (variáveis SMTP_* no .env). Veja o guia de
            publicação.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <input
            type="email"
            value={email ?? settings.email ?? ''}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@exemplo.com"
            className="min-w-0 flex-1 rounded border border-line bg-bg px-2 py-1 text-xs"
            aria-label="E-mail para alertas"
          />
          <button
            className="rounded border border-line px-2 text-xs"
            onClick={() => void save({ ...base, email: email || null })}
          >
            Salvar
          </button>
        </div>
        <TestButton ch="email" />
      </section>

      <section className={box} aria-label="Horário de silêncio">
        <h3 className="font-semibold">🌙 Horário de silêncio</h3>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={settings.quietEnabled}
            onChange={(e) => void save({ ...base, quietEnabled: e.target.checked })}
          />
          Não enviar nada entre
          <input
            type="time"
            value={settings.quietStart}
            onChange={(e) => void save({ ...base, quietStart: e.target.value })}
            className="rounded border border-line bg-bg px-1"
            aria-label="Início do silêncio"
          />
          e
          <input
            type="time"
            value={settings.quietEnd}
            onChange={(e) => void save({ ...base, quietEnd: e.target.value })}
            className="rounded border border-line bg-bg px-1"
            aria-label="Fim do silêncio"
          />
        </label>
        <p className="text-[11px] text-muted">
          Horário de Brasília. Disparos no silêncio ficam no histórico como "silenciado".
        </p>
      </section>
      <p className="text-[11px] text-muted">
        Canais disponíveis: {CHANNELS.map((c) => CHANNEL_LABEL[c]).join(', ')}. Os alertas são
        avaliados no servidor, 24 horas, mesmo com o app fechado.
      </p>
    </div>
  );
}

/** Alertas e notificações (SPEC §10). */
export function AlertsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('aba') as Tab | null) ?? 'alertas';
  const tabs: [Tab, string][] = [
    ['alertas', 'Alertas'],
    ['historico', 'Histórico'],
    ['canais', 'Canais'],
  ];
  return (
    <div className="mx-auto max-w-2xl p-3">
      <div className="mb-3 flex gap-1" role="tablist">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setParams({ aba: k }, { replace: true })}
            className={`rounded px-3 py-1 text-sm ${tab === k ? 'bg-panel-2 text-text' : 'text-muted'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'alertas' && <AlertList />}
      {tab === 'historico' && <History />}
      {tab === 'canais' && <Channels />}
    </div>
  );
}
