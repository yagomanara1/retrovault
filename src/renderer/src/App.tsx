import { Navigate, Route, Routes, useLocation, useMatch } from 'react-router-dom';
import { AmbientBackdrop } from './components/layout/AmbientBackdrop';
import { AppUpdateBanner } from './components/layout/AppUpdateBanner';
import { Titlebar } from './components/layout/Titlebar';
import { TopMenu } from './components/layout/TopMenu';
import { useBridgeEvents } from './hooks/useBridgeEvents';
import { useGames } from './hooks/queries';
import { showsConsoleHome, useLibraryView } from './hooks/useLibraryView';
import { GameDetailPage } from './pages/GameDetailPage';
import { LibraryHome } from './pages/LibraryHome';
import { ProfilePage } from './pages/ProfilePage';
import { RaGamePage } from './pages/RaGamePage';
import { SettingsPage } from './pages/SettingsPage';
import { StorePage } from './pages/StorePage';

const TITLES: Record<string, string> = {
  '/': 'Biblioteca',
  '/profile': 'Troféus e conquistas',
  '/settings': 'Configurações',
  '/loja': 'Loja de ports',
};

/**
 * Casca no estilo PS5: sem barra lateral. A tela inicial é imersiva e tem o próprio topo; as demais
 * ganham o fundo de ambiente (arte desfocada) e a barra superior com título e o menu de ícones.
 */
export function App() {
  useBridgeEvents();
  const { pathname } = useLocation();
  const [view] = useLibraryView();
  const { data: games } = useGames();
  const isGame = !!useMatch('/game/:id');
  const consoleHome = pathname === '/' && showsConsoleHome(view, games?.length);
  const title = isGame ? '' : pathname.startsWith('/ra-game') ? 'RetroAchievements' : (TITLES[pathname] ?? '');

  return (
    <div className="app">
      {/* Botão (não <a href="#">): com HashRouter um âncora mudaria a rota. */}
      <button type="button" className="skip-link" onClick={() => document.getElementById('main')?.focus()}>
        Pular para o conteúdo
      </button>
      <div className="app__main">
        <Titlebar />
        {!consoleHome && (
          <>
            <AmbientBackdrop />
            <header className="console-bar">
              <span className="console-bar__title" aria-hidden="true">
                {title}
              </span>
              <TopMenu />
            </header>
          </>
        )}
        <main id="main" className={consoleHome ? 'app__content app__content--home' : 'app__content'} tabIndex={-1}>
          <Routes>
            <Route index element={<LibraryHome />} />
            <Route path="game/:id" element={<GameDetailPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="ra-game/:raGameId" element={<RaGamePage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="loja" element={<StorePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <AppUpdateBanner />
      </div>
    </div>
  );
}
