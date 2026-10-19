import { lazy, Suspense, useEffect } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AlertForm } from './components/AlertForm';
import { ModeSwitch, TrainBanner } from './components/ModeSwitch';
import { OrderTicket } from './components/OrderTicket';
import { UpdatePrompt } from './components/UpdatePrompt';
import { setUnauthorizedHandler } from './lib/api';
import { useAuth } from './lib/auth';
import { usePrefs } from './lib/prefs';
import { useAssistant } from './lib/assistant-store';
import { AssistantButton, AssistantPanel } from './components/AssistantPanel';
import { AboutPage } from './pages/AboutPage';
import { AccountPage } from './pages/AccountPage';
import { AlertsPage } from './pages/AlertsPage';
import { BrasilPage } from './pages/BrasilPage';
import { LoginScreen, RegisterScreen } from './pages/AuthScreens';
import { ChartPage } from './pages/ChartPage';
import { ExperimentsPage } from './pages/ExperimentsPage';
import { InstallPage } from './pages/InstallPage';
import { LabPage } from './pages/LabPage';
import { MorePage } from './pages/MorePage';
import { WatchlistsPage } from './pages/WatchlistsPage';
import { ScannerPage } from './pages/ScannerPage';
import { SetupParamsPage } from './pages/SetupParamsPage';
import { RealJournalPage } from './pages/RealJournalPage';
import { CalculatorPage } from './pages/CalculatorPage';
import { ReplayPage } from './pages/ReplayPage';
import { ExercisesPage } from './pages/ExercisesPage';
import { SourcesPage } from './pages/SourcesPage';
import { TrainingPage } from './pages/TrainingPage';

// Biblioteca em pedaço separado: o texto das páginas só é baixado quando ela é aberta.
const LibraryPage = lazy(() => import('./pages/LibraryPage'));
// a trilha lê os títulos das páginas da Biblioteca: vai no mesmo pedaço carregado sob demanda
const TrailPage = lazy(() => import('./pages/TrailPage'));

/** Navegação do computador (topo). */
const NAV = [
  { to: '/grafico', label: 'Gráfico', icon: '📈' },
  { to: '/treino', label: 'Treino', icon: '🎯' },
  { to: '/diario', label: 'Diário', icon: '📓' },
  { to: '/listas', label: 'Listas', icon: '☆' },
  { to: '/alertas', label: 'Alertas', icon: '🔔' },
  { to: '/laboratorio', label: 'Laboratório', icon: '🧪' },
  { to: '/scanner', label: 'Scanner', icon: '📡' },
  { to: '/biblioteca', label: 'Biblioteca', icon: '📚' },
  { to: '/brasil', label: 'Brasil', icon: '🇧🇷' },
  { to: '/fontes', label: 'Fontes', icon: '🛰️' },
  { to: '/instalar', label: 'Instalar', icon: '📲' },
  { to: '/sobre', label: 'Sobre', icon: 'ℹ️' },
  { to: '/conta', label: 'Conta', icon: '👤' },
];

/** Barra de baixo do celular: só as telas principais + "Mais". */
interface NavItem {
  to: string;
  label: string;
  icon: string;
  real?: Omit<NavItem, 'real'>;
}
const MOBILE_NAV: NavItem[] = [
  { to: '/grafico', label: 'Gráfico', icon: '📈' },
  // no modo Real o lugar do Treino é do diário real (o treino continua em "Mais")
  {
    to: '/treino',
    label: 'Treino',
    icon: '🎯',
    real: { to: '/diario', label: 'Diário', icon: '📓' },
  },
  { to: '/listas', label: 'Listas', icon: '☆' },
  { to: '/alertas', label: 'Alertas', icon: '🔔' },
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
  const mode = usePrefs((s) => s.mode);
  // logado: carrega preferências e presets do servidor (fonte da verdade)
  useEffect(() => {
    void usePrefs.getState().loadFromServer();
    void useAssistant.getState().load();
  }, []);
  return (
    <div className="safe-top flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-panel px-3 py-1.5">
        <span className="text-base font-bold tracking-wide">
          <span className="text-up">●</span> Radar
        </span>
        <nav className="ml-4 hidden min-w-0 gap-1 overflow-x-auto lg:flex">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `rounded px-2 py-1 text-sm whitespace-nowrap ${isActive ? 'bg-panel-2 text-text' : 'text-muted hover:text-text'}`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <AssistantButton />
        <ModeSwitch />
      </header>
      <AssistantPanel />
      <TrainBanner />
      <main className="min-h-0 flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<Navigate to="/grafico" replace />} />
          <Route path="/grafico" element={<ChartPage />} />
          <Route path="/listas" element={<WatchlistsPage />} />
          <Route path="/mais" element={<MorePage />} />
          <Route path="/alertas" element={<AlertsPage />} />
          <Route path="/treino" element={<TrainingPage />} />
          <Route path="/brasil" element={<BrasilPage />} />
          <Route path="/laboratorio" element={<LabPage />} />
          <Route path="/scanner" element={<ScannerPage />} />
          <Route path="/setups/parametros" element={<SetupParamsPage />} />
          <Route path="/diario" element={<RealJournalPage />} />
          <Route path="/calculadora" element={<CalculatorPage />} />
          <Route path="/replay" element={<ReplayPage />} />
          <Route path="/exercicios" element={<ExercisesPage />} />
          <Route
            path="/trilha"
            element={
              <Suspense fallback={<p className="p-3 text-sm text-muted">Carregando…</p>}>
                <TrailPage />
              </Suspense>
            }
          />
          <Route path="/laboratorio/experimentos" element={<ExperimentsPage />} />
          <Route path="/fontes" element={<SourcesPage />} />
          <Route
            path="/biblioteca/:slug?"
            element={
              <Suspense fallback={<p className="p-3 text-sm text-muted">Carregando…</p>}>
                <LibraryPage />
              </Suspense>
            }
          />
          <Route path="/instalar" element={<InstallPage />} />
          <Route path="/sobre" element={<AboutPage />} />
          <Route path="/conta" element={<AccountPage />} />
          <Route path="*" element={<Navigate to="/grafico" replace />} />
        </Routes>
      </main>
      <nav className="safe-bottom flex border-t border-line bg-panel lg:hidden">
        {MOBILE_NAV.map((x) => (mode === 'real' && x.real ? x.real : x)).map((n) => (
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
      <AlertForm />
      <OrderTicket />
      <UpdatePrompt />
    </div>
  );
}
