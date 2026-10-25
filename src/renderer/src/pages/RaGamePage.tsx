import { Link, useParams } from 'react-router-dom';
import { useGameProgress, useGames, useRaEnabled } from '@/hooks/queries';
import { AchievementPanel } from '@/components/achievements/AchievementPanel';
import { CoverImage } from '@/components/ui/CoverImage';
import { EmptyState } from '@/components/ui/States';

/** Conquistas de um jogo da conta que não está (necessariamente) na biblioteca. */
export function RaGamePage() {
  const raGameId = Number(useParams().raGameId);
  const raEnabled = useRaEnabled();
  const { data: progress } = useGameProgress(Number.isInteger(raGameId) && raGameId > 0 ? raGameId : null);
  const { data: games } = useGames();
  const libraryGame = games?.find((g) => g.raGameId === raGameId);

  if (!raEnabled || !Number.isInteger(raGameId) || raGameId <= 0) {
    return <EmptyState title="Jogo indisponível" description="Verifique sua conta do RetroAchievements em Configurações." />;
  }

  return (
    <div className="page">
      <header className="ra-game-header">
        <CoverImage cover={progress?.boxArtUrl ?? null} icon={progress?.iconUrl} title={progress?.title ?? '…'} variant="square" />
        <div>
          <p className="hero__platform">{progress?.consoleName}</p>
          <h1 className="hero__title">{progress?.title ?? 'Carregando…'}</h1>
          {libraryGame ? (
            <Link className="btn btn--primary btn--md" to={`/game/${libraryGame.id}`}>
              Abrir na biblioteca
            </Link>
          ) : (
            <p className="muted">Este jogo não está na sua biblioteca. Adicione a ROM para jogá-lo daqui.</p>
          )}
        </div>
      </header>
      <AchievementPanel raGameId={raGameId} />
    </div>
  );
}
