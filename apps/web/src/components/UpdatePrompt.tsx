import { useEffect, useState } from 'react';

/** Avisa quando há versão nova do app (service worker) e deixa o usuário escolher a hora de atualizar. */
export function UpdatePrompt() {
  const [update, setUpdate] = useState<null | (() => void)>(null);

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    let cancelled = false;
    void import('virtual:pwa-register').then(({ registerSW }) => {
      if (cancelled) return;
      const updateSW = registerSW({
        onNeedRefresh: () => setUpdate(() => () => void updateSW(true)),
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!update) return null;
  return (
    <div className="fixed inset-x-2 bottom-16 z-50 mx-auto flex max-w-md items-center gap-3 rounded border border-accent bg-panel p-3 text-sm shadow-xl lg:bottom-4">
      <span className="flex-1">Há uma versão nova do Radar.</span>
      <button
        type="button"
        className="rounded bg-accent px-3 py-1 font-semibold text-black"
        onClick={update}
      >
        Atualizar
      </button>
    </div>
  );
}
