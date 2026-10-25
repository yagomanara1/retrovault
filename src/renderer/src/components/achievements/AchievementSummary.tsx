import type { GameProgress } from '@shared/types';
import { formatNumber } from '@/lib/format';
import { ProgressBar } from '../ui/ProgressBar';
import { TrophyIcon } from '../ui/icons';
import { isUnlocked, unlockDate } from './achievementUtils';

const RECENT_BADGES = 8;

export function AchievementSummary({ progress }: { progress: GameProgress }) {
  const percent = Math.round(progress.completion);
  const mastered = progress.numAchievements > 0 && progress.earnedHardcore === progress.numAchievements;
  const completed = progress.numAchievements > 0 && progress.earned === progress.numAchievements;
  const recent = progress.achievements
    .filter(isUnlocked)
    .sort((a, b) => (unlockDate(b) ?? '').localeCompare(unlockDate(a) ?? ''))
    .slice(0, RECENT_BADGES);

  return (
    <div className="ach-summary">
      <div className="ach-summary__top">
        <p className="ach-summary__headline">
          Você desbloqueou <strong>{progress.earned}</strong> de <strong>{progress.numAchievements}</strong> ({percent}%)
        </p>
        {(mastered || completed) && (
          <span className={mastered ? 'award award--mastered' : 'award award--completed'}>
            <TrophyIcon size={14} /> {mastered ? 'Masterizado' : 'Completo'}
          </span>
        )}
      </div>
      <ProgressBar
        value={progress.earned}
        max={progress.numAchievements}
        tone="gold"
        label="Progresso de conquistas"
        valueText={`${progress.earned} de ${progress.numAchievements}`}
      />
      <dl className="ach-summary__stats">
        <div>
          <dt>Pontos</dt>
          <dd>
            {formatNumber(progress.earnedPoints)} / {formatNumber(progress.totalPoints)}
          </dd>
        </div>
        <div>
          <dt>Hardcore</dt>
          <dd>
            {progress.earnedHardcore} / {progress.numAchievements}
          </dd>
        </div>
        <div>
          <dt>Jogadores</dt>
          <dd>{formatNumber(progress.numDistinctPlayers)}</dd>
        </div>
      </dl>
      {recent.length > 0 && (
        <ul className="ach-summary__badges" aria-label="Conquistas desbloqueadas recentemente">
          {recent.map((a) => (
            <li key={a.id}>
              <img src={a.badgeUrl} alt={a.title} title={a.title} width={40} height={40} loading="lazy" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
