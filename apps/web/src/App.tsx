import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { UpdatePrompt } from './components/UpdatePrompt';
import { AboutPage } from './pages/AboutPage';
import { ChartPage } from './pages/ChartPage';
import { InstallPage } from './pages/InstallPage';
import { SourcesPage } from './pages/SourcesPage';

const NAV = [
  { to: '/grafico', label: 'Gráfico', icon: '📈' },
  { to: '/fontes', label: 'Fontes', icon: '🛰️' },
  { to: '/instalar', label: 'Instalar', icon: '📲' },
  { to: '/sobre', label: 'Sobre', icon: 'ℹ️' },
];

export function App() {
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
          <Route path="/fontes" element={<SourcesPage />} />
          <Route path="/instalar" element={<InstallPage />} />
          <Route path="/sobre" element={<AboutPage />} />
          <Route path="*" element={<Navigate to="/grafico" replace />} />
        </Routes>
      </main>
      <nav className="safe-bottom flex border-t border-line bg-panel md:hidden">
        {NAV.map((n) => (
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
