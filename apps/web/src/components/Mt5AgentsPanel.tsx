import { formatAgo, formatDateTime, type Mt5AgentStatus } from '@radar/shared';
import { useCallback, useEffect, useState } from 'react';
import { createMt5Token, getMt5Agents, revokeMt5Token } from '../lib/api';

type Data = { agents: Mt5AgentStatus[]; simulatedAllowed: boolean; url: string };

function stateOf(a: Mt5AgentStatus): { dot: string; text: string } {
  if (a.online && a.terminalConnected === false) {
    return {
      dot: 'bg-warn',
      text: 'Agente rodando, mas o MetaTrader 5 está sem conexão com a corretora',
    };
  }
  if (a.online) {
    const what = a.mode === 'simulated' ? 'SIMULADOR (dados simulados)' : 'MetaTrader 5';
    return { dot: 'bg-up', text: `Conectado — ${what}${a.company ? ` · ${a.company}` : ''}` };
  }
  if (!a.lastSeenAt) return { dot: 'bg-down', text: 'Nunca conectou' };
  if (a.mode === 'check') {
    return {
      dot: 'bg-warn',
      text: `Teste de conexão OK em ${formatDateTime(a.lastSeenAt)} (sem dados)`,
    };
  }
  return {
    dot: 'bg-down',
    text: `Sem contato desde ${formatDateTime(a.lastSeenAt)} (${formatAgo(a.lastSeenAt)})`,
  };
}

/**
 * Agentes MetaTrader 5 (ADR-0023): estado de cada um e geração de token. O token aparece uma vez só;
 * o servidor guarda só o hash. Nunca pede a senha da corretora.
 */
export function Mt5AgentsPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ name: string; token: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    getMt5Agents().then(
      (d) => {
        setData(d);
        setErr(null);
      },
      (e: Error) => setErr(e.message),
    );
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      const r = await createMt5Token(name);
      setCreated({ name: r.name, token: r.token, url: r.url });
      setCopied(false);
      setName('');
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const snippet = created ? `[radar]\nurl = ${created.url}\ntoken = ${created.token}` : '';

  return (
    <section className="space-y-3" data-testid="mt5-panel">
      <h2 className="font-semibold">MetaTrader 5 (B3 em tempo real e forex)</h2>
      <p className="text-muted">
        Um programa pequeno, o <b>agente</b>, roda no seu PC Windows com o MetaTrader 5 da corretora
        aberto e manda os candles para cá. Ele <b>só lê dados</b>: nunca envia ordens e nunca pede a
        senha da corretora. Só funciona com o PC ligado. Passo a passo: <b>docs/GUIA_MT5.md</b>.
      </p>
      {data?.simulatedAllowed && (
        <p className="rounded bg-warn/15 px-2 py-1 text-xs">
          Este servidor está em desenvolvimento e aceita o simulador do agente (
          <code>--simulate</code>), que aparece com a faixa DADOS SIMULADOS.
        </p>
      )}
      {err && <p className="text-down">Erro: {err}</p>}

      {data && data.agents.length === 0 && (
        <p className="text-muted">Nenhum agente ainda. Gere um token abaixo para começar.</p>
      )}
      {data && data.agents.length > 0 && (
        <ul className="divide-y divide-line rounded border border-line">
          {data.agents.map((a) => {
            const s = stateOf(a);
            return (
              <li key={a.id} className="space-y-1 px-3 py-2" data-testid="mt5-agent">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.dot}`} />
                  <span className="font-semibold">{a.name}</span>
                  <span className="text-xs text-muted">{s.text}</span>
                  <button
                    type="button"
                    className="ml-auto text-xs text-down underline"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Revogar o token de "${a.name}"? O agente desse PC para de enviar até receber um token novo.`,
                        )
                      ) {
                        revokeMt5Token(a.id).then(load, (e: Error) => setErr(e.message));
                      }
                    }}
                  >
                    revogar
                  </button>
                </div>
                {a.symbols.length > 0 && (
                  <div className="flex flex-wrap gap-1 text-xs">
                    {a.symbols.map((x) => (
                      <span key={x} className="rounded bg-panel-2 px-1.5 py-0.5">
                        {x}
                      </span>
                    ))}
                  </div>
                )}
                {a.clock && (
                  <p className="text-xs text-muted">Horário do servidor da corretora: {a.clock}</p>
                )}
                {a.errors.length > 0 && (
                  <ul className="list-disc pl-5 text-xs text-down">
                    {a.errors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                )}
                {a.notes.length > 0 && (
                  <ul className="list-disc pl-5 text-xs text-muted">
                    {a.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          placeholder="Nome do PC, ex.: PC de casa — B3"
          aria-label="Nome do agente"
          className="min-w-0 flex-1 rounded border border-line bg-panel px-2 py-1"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void create()}
          className="rounded bg-accent px-3 py-1 font-semibold text-black disabled:opacity-50"
        >
          Gerar token para um agente
        </button>
      </div>

      {created && (
        <div className="space-y-2 rounded border border-warn/60 p-3" data-testid="mt5-token">
          <p className="font-semibold">
            Token de "{created.name}" — copie agora: ele aparece só esta vez.
          </p>
          <p className="text-xs text-muted">
            Cole estas linhas no arquivo <b>config.ini</b> do agente (seção [radar]). O token{' '}
            <b>não é a senha da corretora</b>. Quem tiver o token consegue mandar dados para o seu
            Radar (não vê nada nem opera); se ele vazar, revogue e gere outro.
          </p>
          <pre className="overflow-x-auto rounded bg-panel-2 p-2 text-xs">{snippet}</pre>
          <div className="flex gap-3 text-xs">
            <button
              type="button"
              className="underline"
              onClick={() =>
                void navigator.clipboard?.writeText(snippet).then(
                  () => setCopied(true),
                  () => setCopied(false),
                )
              }
            >
              {copied ? 'copiado!' : 'copiar'}
            </button>
            <button type="button" className="underline" onClick={() => setCreated(null)}>
              já copiei, fechar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
