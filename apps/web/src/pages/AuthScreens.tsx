import { useState, type FormEvent, type ReactNode } from 'react';
import { login, register, useAuth } from '../lib/auth';

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="safe-top flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-lg border border-line bg-panel p-5 shadow-xl">
        <p className="mb-1 text-lg font-bold">
          <span className="text-up">●</span> Radar
        </p>
        <h1 className="mb-4 text-base font-semibold">{title}</h1>
        {children}
      </div>
    </div>
  );
}

const input =
  'w-full rounded border border-line bg-bg px-3 py-2 text-base outline-none focus:border-accent';

/** Primeiro acesso (sem nenhuma conta) ou cadastro por convite. */
export function RegisterScreen({ invite }: { invite?: string }) {
  const setUser = useAuth((s) => s.setUser);
  const needCode = useAuth((s) => s.setupCodeRequired) && !invite;
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pw !== pw2) return setErr('As senhas não conferem.');
    setBusy(true);
    setErr(null);
    try {
      const r = await register(email, pw, invite, needCode ? code : undefined);
      setUser(r.user);
      history.replaceState(null, '', '/grafico');
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title={invite ? 'Criar conta com convite' : 'Primeiro acesso: crie sua conta'}>
      {!invite && (
        <p className="mb-3 text-sm text-muted">
          Esta será a única conta do Radar. Depois dela, o cadastro fica fechado (só por convite).
        </p>
      )}
      <form onSubmit={submit} className="space-y-3">
        {needCode && (
          <label className="block text-xs text-muted">
            Código de instalação (aparece no fim da instalação no servidor; protege o seu Radar de
            quem achar o endereço antes de você)
            <input
              className={`${input} mt-1`}
              autoComplete="off"
              placeholder="Código de instalação"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              aria-label="Código de instalação"
            />
          </label>
        )}
        <input
          className={input}
          type="email"
          autoComplete="email"
          placeholder="E-mail"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          aria-label="E-mail"
        />
        <input
          className={input}
          type="password"
          autoComplete="new-password"
          placeholder="Senha (mín. 10 caracteres)"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          required
          minLength={10}
          aria-label="Senha"
        />
        <input
          className={input}
          type="password"
          autoComplete="new-password"
          placeholder="Repita a senha"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          required
          aria-label="Repita a senha"
        />
        {err && <p className="text-sm text-down">{err}</p>}
        <button
          disabled={busy}
          className="w-full rounded bg-accent py-2 font-semibold text-black disabled:opacity-60"
        >
          {busy ? 'Criando…' : 'Criar conta'}
        </button>
      </form>
    </Shell>
  );
}

export function LoginScreen() {
  const setUser = useAuth((s) => s.setUser);
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [code, setCode] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await login(email, pw, needTotp ? code : undefined);
      if (r.needTotp) setNeedTotp(true);
      else if (r.user) setUser(r.user);
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Entrar">
      <form onSubmit={submit} className="space-y-3">
        <input
          className={input}
          type="email"
          autoComplete="username"
          placeholder="E-mail"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          aria-label="E-mail"
        />
        <input
          className={input}
          type="password"
          autoComplete="current-password"
          placeholder="Senha"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          required
          aria-label="Senha"
        />
        {needTotp && (
          <input
            className={input}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="Código de 6 dígitos do autenticador"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            required
            aria-label="Código do autenticador"
            autoFocus
          />
        )}
        {err && <p className="text-sm text-down">{err}</p>}
        <button
          disabled={busy}
          className="w-full rounded bg-accent py-2 font-semibold text-black disabled:opacity-60"
        >
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </Shell>
  );
}
