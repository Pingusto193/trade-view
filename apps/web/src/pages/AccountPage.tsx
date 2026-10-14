import { useState } from 'react';
import { DataExport } from '../components/DataExport';
import { api } from '../lib/api';
import { logout, useAuth } from '../lib/auth';

const input =
  'w-full rounded border border-line bg-bg px-3 py-2 text-base outline-none focus:border-accent';
const btn = 'rounded bg-accent px-3 py-2 text-sm font-semibold text-black disabled:opacity-60';

/** Conta: senha, 2FA (TOTP), convites e saída. */
export function AccountPage() {
  const { user, devNoAuth, refresh } = useAuth();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [totp, setTotp] = useState<{ secret: string; uri: string; svg: string } | null>(null);
  const [code, setCode] = useState('');
  const [invite, setInvite] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setErr(null);
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  if (devNoAuth) {
    return (
      <div className="mx-auto max-w-xl p-4 text-sm">
        <h1 className="mb-2 text-xl font-semibold">Conta</h1>
        <p className="rounded bg-warn/20 p-3">
          Modo de desenvolvimento sem login (RADAR_DEV_NO_AUTH). Em produção o login é obrigatório.
        </p>
        <div className="mt-4">
          <DataExport />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-6 p-4 text-sm">
      <h1 className="text-xl font-semibold">Conta</h1>
      <p className="text-muted">Conectado como {user?.email}</p>
      {msg && <p className="rounded border border-up/50 bg-up/10 p-2">{msg}</p>}
      {err && <p className="rounded border border-down/50 bg-down/10 p-2 text-down">{err}</p>}

      <section className="space-y-2 rounded border border-line p-3">
        <h2 className="font-semibold">Trocar senha</h2>
        <input
          className={input}
          type="password"
          placeholder="Senha atual"
          value={cur}
          onChange={(e) => setCur(e.target.value)}
          aria-label="Senha atual"
        />
        <input
          className={input}
          type="password"
          placeholder="Nova senha (mín. 10)"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          aria-label="Nova senha"
        />
        <button
          className={btn}
          onClick={() =>
            run(
              () =>
                api('/api/auth/password', {
                  method: 'POST',
                  body: JSON.stringify({ current: cur, next }),
                }),
              'Senha alterada.',
            )
          }
        >
          Salvar nova senha
        </button>
      </section>

      <section className="space-y-2 rounded border border-line p-3">
        <h2 className="font-semibold">Verificação em duas etapas (2FA)</h2>
        <p className="text-muted">
          Opcional e recomendado. Use um app autenticador (Google Authenticator, Microsoft
          Authenticator, 1Password ou o app Senhas do iPhone).
        </p>
        {user?.totpEnabled ? (
          <>
            <p>✅ Ligado.</p>
            <input
              className={input}
              type="password"
              placeholder="Sua senha para desligar"
              value={cur}
              onChange={(e) => setCur(e.target.value)}
              aria-label="Senha para desligar 2FA"
            />
            <button
              className="rounded border border-down px-3 py-2 text-sm text-down"
              onClick={() =>
                run(async () => {
                  await api('/api/auth/totp/disable', {
                    method: 'POST',
                    body: JSON.stringify({ password: cur }),
                  });
                  await refresh();
                }, '2FA desligado.')
              }
            >
              Desligar 2FA
            </button>
          </>
        ) : totp ? (
          <>
            <ol className="list-decimal space-y-1 pl-5">
              <li>Escaneie o QR code com o app autenticador (ou toque no link, no iPhone).</li>
              <li>Digite o código de 6 dígitos que aparecer.</li>
            </ol>
            <div
              className="mx-auto w-48 rounded bg-white p-2"
              dangerouslySetInnerHTML={{ __html: totp.svg }}
            />
            <p className="break-all text-xs text-muted">
              Chave manual: <code>{totp.secret}</code> ·{' '}
              <a className="text-accent underline" href={totp.uri}>
                abrir no autenticador
              </a>
            </p>
            <input
              className={input}
              inputMode="numeric"
              placeholder="Código de 6 dígitos"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              aria-label="Código do autenticador"
            />
            <button
              className={btn}
              onClick={() =>
                run(async () => {
                  await api('/api/auth/totp/confirm', {
                    method: 'POST',
                    body: JSON.stringify({ code }),
                  });
                  setTotp(null);
                  await refresh();
                }, '2FA ligado. A partir de agora o login pede o código.')
              }
            >
              Confirmar e ligar
            </button>
          </>
        ) : (
          <button
            className={btn}
            onClick={() =>
              run(
                async () =>
                  setTotp(await api('/api/auth/totp/start', { method: 'POST', body: '{}' })),
                'Siga os passos abaixo.',
              )
            }
          >
            Configurar 2FA
          </button>
        )}
      </section>

      <section className="space-y-2 rounded border border-line p-3">
        <h2 className="font-semibold">Convidar alguém</h2>
        <p className="text-muted">
          O cadastro é fechado. Um convite vale para uma conta e expira em 7 dias.
        </p>
        <button
          className={btn}
          onClick={() =>
            run(
              async () =>
                setInvite(
                  (await api<{ url: string }>('/api/auth/invites', { method: 'POST', body: '{}' }))
                    .url,
                ),
              'Convite criado.',
            )
          }
        >
          Gerar link de convite
        </button>
        {invite && <p className="break-all rounded bg-bg p-2 text-xs">{invite}</p>}
      </section>

      <DataExport />
      <section className="flex gap-2">
        <button
          className="rounded border border-line px-3 py-2"
          onClick={async () => {
            await logout().catch(() => undefined);
            await refresh();
          }}
        >
          Sair
        </button>
        <button
          className="rounded border border-line px-3 py-2 text-muted"
          onClick={() =>
            run(async () => {
              await api('/api/auth/logout-all', { method: 'POST', body: '{}' });
              await refresh();
            }, 'Todas as sessões encerradas.')
          }
        >
          Sair de todos os aparelhos
        </button>
      </section>
    </div>
  );
}
