import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/** Tela guiada de instalação do PWA (SPEC §18). */
export function InstallPage() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const installed = isStandalone();

  useEffect(() => {
    const fn = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', fn);
    return () => window.removeEventListener('beforeinstallprompt', fn);
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 text-sm leading-relaxed">
      <h1 className="text-xl font-semibold">Instalar o Radar</h1>
      {installed ? (
        <p className="rounded border border-up/50 bg-up/10 p-3">
          ✅ O Radar já está aberto como aplicativo instalado.
        </p>
      ) : (
        <p className="text-muted">
          Instalado, o Radar abre em tela cheia, como um app, e pode receber notificações de
          alertas.
        </p>
      )}

      <section className={`rounded border p-3 ${isIos() ? 'border-accent' : 'border-line'}`}>
        <h2 className="mb-2 font-semibold">iPhone (Safari)</h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            Abra o endereço do seu Radar no <b>Safari</b> (no iPhone, outros navegadores podem não
            oferecer a opção).
          </li>
          <li>
            Toque no botão <b>Compartilhar</b> (quadrado com seta para cima, na barra de baixo).
          </li>
          <li>
            Role e toque em <b>Adicionar à Tela de Início</b>.
          </li>
          <li>
            Toque em <b>Adicionar</b>. O ícone do Radar aparece na tela inicial.
          </li>
          <li>
            Abra o Radar <b>pelo ícone</b>. As notificações só funcionam assim (iOS 16.4 ou mais
            recente), e a permissão é pedida quando você tocar em "Ativar notificações" na tela de
            alertas.
          </li>
        </ol>
      </section>

      <section className="rounded border border-line p-3">
        <h2 className="mb-2 font-semibold">Computador (Chrome ou Edge)</h2>
        {deferred ? (
          <button
            type="button"
            className="rounded bg-accent px-3 py-2 font-semibold text-black"
            onClick={async () => {
              await deferred.prompt();
              setDeferred(null);
            }}
          >
            Instalar agora
          </button>
        ) : (
          <ol className="list-decimal space-y-1 pl-5">
            <li>Abra o Radar no Chrome ou no Edge.</li>
            <li>
              Clique no ícone de <b>instalar</b> na barra de endereço (um monitor com seta) ou no
              menu ⋮ → <b>Instalar Radar</b>.
            </li>
          </ol>
        )}
      </section>

      <p className="text-xs text-muted">
        Requisito: o Radar precisa estar publicado com <b>HTTPS</b> (ver docs/GUIA_DEPLOY.md). Em
        http://localhost a instalação funciona só no próprio computador.
      </p>
    </div>
  );
}
