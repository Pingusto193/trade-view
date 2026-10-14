import { useState } from 'react';
import { api } from '../lib/api';

/** Exportar/importar tudo em JSON (SPEC §17: nada importante preso num lugar só). */
export function DataExport() {
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onFile = async (f: File) => {
    setMsg(null);
    setErr(null);
    let data: unknown;
    try {
      data = JSON.parse(await f.text());
    } catch {
      setErr('O arquivo não é um JSON válido.');
      return;
    }
    if (
      !window.confirm(
        'Importar SUBSTITUI todos os seus dados atuais (listas, desenhos, treino, diário, replays…) pelos do arquivo. Baixe uma cópia antes, se quiser guardar. Continuar?',
      )
    )
      return;
    setBusy(true);
    try {
      const r = await api<{ rows: number }>('/api/import', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      setMsg(`Importado: ${r.rows} registros. Recarregue as telas abertas em outros aparelhos.`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-2 rounded border border-line p-3" aria-label="Seus dados">
      <h2 className="font-semibold">Seus dados</h2>
      <p className="text-xs text-muted">
        Um arquivo JSON com tudo o que é seu: preferências, listas, desenhos, alertas, treino,
        diário real, replays, laboratório e exercícios. Fica de fora: senha, sessões, aparelhos com
        notificação e tokens (Telegram etc.), que são presos a este servidor.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <a
          href="/api/export"
          download
          className="rounded border border-line px-3 py-2 text-sm hover:bg-panel-2"
        >
          Baixar todos os meus dados
        </a>
        <label className="cursor-pointer rounded border border-line px-3 py-2 text-sm hover:bg-panel-2">
          Importar arquivo…
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void onFile(f);
            }}
          />
        </label>
      </div>
      {msg && (
        <p className="rounded border border-up/50 bg-up/10 p-2 text-xs" role="status">
          {msg}
        </p>
      )}
      {err && (
        <p className="rounded border border-down/50 bg-down/10 p-2 text-xs text-down" role="alert">
          {err}
        </p>
      )}
    </section>
  );
}
