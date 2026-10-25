import { useMemo } from 'react';
import { useMatch } from 'react-router-dom';
import { useGames } from '@/hooks/queries';

/**
 * Fundo das telas de sistema (como no PS5): a arte do jogo em foco, ou do último jogado,
 * bem desfocada e escurecida. Uma imagem estática: o desfoque é calculado uma vez, não a cada quadro.
 */
export function AmbientBackdrop() {
  const { data: games = [] } = useGames();
  const gameMatch = useMatch('/game/:id');
  const art = useMemo(() => {
    const inFocus = gameMatch ? games.find((g) => g.id === Number(gameMatch.params.id)) : null;
    const lastPlayed = [...games].filter((g) => g.lastPlayedAt).sort((a, b) => b.lastPlayedAt!.localeCompare(a.lastPlayedAt!))[0];
    const game = inFocus ?? lastPlayed ?? games[0];
    return game?.backgroundUrl ?? game?.coverUrl ?? null;
  }, [games, gameMatch]);

  return (
    <div className="ambient" aria-hidden="true">
      {art && <div key={art} className="ambient__art" style={{ backgroundImage: `url("${art}")` }} />}
      <div className="ambient__scrim" />
    </div>
  );
}
