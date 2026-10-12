import { useEffect } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { UpdatePrompt } from './components/UpdatePrompt';
import { setUnauthorizedHandler } from './lib/api';
import { useAuth } from './lib/auth';
import { usePrefs } from './lib/prefs';
import { AboutPage } from './pages/AboutPage';
import { AccountPage } from './pages/AccountPage';
import { LoginScreen, RegisterScreen } from './pages/AuthScreens';
import { ChartPage } from './pages/ChartPage';
import { InstallPage } from './pages/InstallPage';
import { MorePage } from './pages/MorePage';
import { WatchlistsPage } from './pages/WatchlistsPage';
import { SourcesPage } from './pages/SourcesPage';

/** Navegação do computador (topo). */
const NAV = [
  { to: '/grafico', label: 'Gráfico', icon: '📈' },
  { to: '/listas', label: 'Listas', icon: '☆' },
  { to: '/fontes', label: 'Fontes', icon: '🛰️' },
  { to: '/instalar', label: 'Instalar', icon: '📲' },
  { to: '/sobre', label: 'Sobre', icon: 'ℹ️' },
  { to: '/conta', label: 'Conta', icon: '👤' },
];

/** Barra de baixo do celular: só as telas principais + "Mais". */
const MOBILE_NAV = [
  { to: '/grafico', label: 'Gráfico', icon: '📈' },
  { to: '/listas', label: 'Listas', icon: '☆' },
  { to: '/mais', label: 'Mais', icon: '☰' },
];

/** Decide entre primeiro acesso, login, convite ou o app. */
export function App() {
  const auth = useAuth();
  const loc = useLocation();
  useEffect(() => {
    setUnauthorizedHandler(() => void useAuth.getState().refresh());
    void auth.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!auth.loaded) {
    return <div className="flex h-full items-center justify-center text-muted">Carregando…</div>;
  }
  if (!auth.user && !auth.devNoAuth) {
    const invite =
      loc.pathname === '/convite' ? new URLSearchParams(loc.search).get('token') : null;
    if (invite) return <RegisterScreen invite={invite} />;
    if (auth.needsSetup) return <RegisterScreen />;
    return <LoginScreen />;
  }
  return <Shell />;
}

function Shell() {
  // logado: carrega preferências e presets do servidor (fonte da verdade)
  useEffect(() => {
    void usePrefs.getState().loadFromServer();
  }, []);
  return (
    <div className="safe-top flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-panel px-3 py-1.5">
        <span className="text-base font-bold tracking-wide">
          <span className="text-up">●</span> Radar
        </span>
        <nav className="ml-4 hidden gap-1 md:flex">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `rounded px-2 py-1 text-sm ${isActive ? 'bg-panel-2 text-text' : 'text-muted hover:text-text'}`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="min-h-0 flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<Navigate to="/grafico" replace />} />
          <Route path="/grafico" element={<ChartPage />} />
          <Route path="/listas" element={<WatchlistsPage />} />
          <Route path="/mais" element={<MorePage />} />
          <Route path="/fontes" element={<SourcesPage />} />
          <Route path="/instalar" element={<InstallPage />} />
          <Route path="/sobre" element={<AboutPage />} />
          <Route path="/conta" element={<AccountPage />} />
          <Route path="*" element={<Navigate to="/grafico" replace />} />
        </Routes>
      </main>
      <nav className="safe-bottom flex border-t border-line bg-panel md:hidden">
        {MOBILE_NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center py-1.5 text-[11px] ${isActive ? 'text-accent' : 'text-muted'}`
            }
          >
            <span aria-hidden className="text-base">
              {n.icon}
            </span>
            {n.label}
          </NavLink>
        ))}
      </nav>
      <UpdatePrompt />
    </div>
  );
}
