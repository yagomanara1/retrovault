import { useLocation, useMatch, useNavigate } from 'react-router-dom';
import { useGame } from '@/hooks/queries';
import { Button } from '../ui/Button';
import { ChevronLeftIcon, ChevronRightIcon } from '../ui/icons';

const TITLES: Record<string, string> = {
  '/': 'Biblioteca',
  '/profile': 'Conquistas',
  '/settings': 'Configurações',
};

/** O HashRouter guarda a posição na pilha do histórico em history.state.idx. */
function historyIndex(): number {
  const state = window.history.state as { idx?: number } | null;
  return state?.idx ?? 0;
}

/**
 * Barra de título integrada (como no macOS): arrasta a janela, tem voltar/avançar e o título da
 * tela. Os botões ─ □ ✕ do Windows são desenhados pelo sistema por cima, à direita.
 */
export function Titlebar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const gameMatch = useMatch('/game/:id');
  const { data: game } = useGame(Number(gameMatch?.params.id ?? 0));

  const index = historyIndex();
  const canGoBack = index > 0;
  const canGoForward = index < window.history.length - 1;
  const title = gameMatch ? (game?.title ?? '') : pathname.startsWith('/ra-game') ? 'RetroAchievements' : (TITLES[pathname] ?? '');

  return (
    <header className="titlebar">
      <div className="titlebar__nav">
        <Button variant="ghost" size="sm" icon={<ChevronLeftIcon size={18} />} aria-label="Voltar" disabled={!canGoBack} onClick={() => navigate(-1)} />
        <Button variant="ghost" size="sm" icon={<ChevronRightIcon size={18} />} aria-label="Avançar" disabled={!canGoForward} onClick={() => navigate(1)} />
      </div>
      {/* Não é heading: cada tela já tem o seu <h1> (evita título duplicado para leitores de tela). */}
      <div className="titlebar__title" aria-hidden="true">
        {title}
      </div>
    </header>
  );
}
