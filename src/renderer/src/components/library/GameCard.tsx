import { memo } from 'react';
import { Link } from 'react-router-dom';
import type { CompletionEntry, Game } from '@shared/types';
import { formatPlaytime } from '@/lib/format';
import { CoverImage } from '../ui/CoverImage';
import { ProgressBar } from '../ui/ProgressBar';
import { TrophyIcon } from '../ui/icons';

interface GameCardProps {
  game: Game;
  progress?: CompletionEntry;
  running?: boolean;
  /** Arquivo do jogo não encontrado (movido ou apagado). */
  missing?: boolean;
}

export const GameCard = memo(function GameCard({ game, progress, running, missing }: GameCardProps) {
  const hasAchievements = progress && progress.maxPossible > 0;
  return (
    <Link to={`/game/${game.id}`} className="game-card">
      <CoverImage cover={game.coverUrl} icon={game.iconUrl} title={game.title} className="game-card__cover" />
      {running && <span className="game-card__badge">Em execução</span>}
      {missing && !running && <span className="game-card__badge game-card__badge--missing">Não encontrado</span>}
      <div className="game-card__body">
        <span className="game-card__title">{game.title}</span>
        <span className="game-card__meta">{formatPlaytime(game.playtimeSeconds)}</span>
        {hasAchievements && (
          <div className="game-card__progress">
            <TrophyIcon size={12} />
            <ProgressBar
              value={progress.numAwarded}
              max={progress.maxPossible}
              size="xs"
              tone="gold"
              label={`Conquistas de ${game.title}`}
              valueText={`${progress.numAwarded} de ${progress.maxPossible}`}
            />
            <span>
              {progress.numAwarded}/{progress.maxPossible}
            </span>
          </div>
        )}
      </div>
    </Link>
  );
});
