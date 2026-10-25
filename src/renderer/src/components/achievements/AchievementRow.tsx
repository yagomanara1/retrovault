import { memo } from 'react';
import type { Achievement } from '@shared/types';
import { cx } from '@/lib/cx';
import { formatDateTime, formatPercent } from '@/lib/format';
import { ProgressBar } from '../ui/ProgressBar';
import { LockIcon } from '../ui/icons';
import { RARITY_LABEL, TYPE_LABEL, isUnlocked, rarityTier, unlockDate } from './achievementUtils';

export const AchievementRow = memo(function AchievementRow({ achievement: a }: { achievement: Achievement }) {
  const unlocked = isUnlocked(a);
  const date = unlockDate(a);
  const tier = rarityTier(a.rarity);

  return (
    <li className={cx('achievement', unlocked ? 'achievement--unlocked' : 'achievement--locked')}>
      <img
        className="achievement__badge"
        src={unlocked ? a.badgeUrl : a.badgeLockedUrl}
        alt=""
        width={64}
        height={64}
        loading="lazy"
        decoding="async"
      />
      <div className="achievement__info">
        <h3 className="achievement__title">
          {a.title}
          <span className="sr-only">{unlocked ? ' — desbloqueada' : ' — bloqueada'}</span>
        </h3>
        <p className="achievement__desc">{a.description}</p>
        <div className="achievement__tags">
          {a.type && <span className={cx('tag', `tag--${a.type}`)}>{TYPE_LABEL[a.type]}</span>}
          {(tier === 'ultra-rare' || tier === 'rare') && (
            <span className={cx('tag', `tag--${tier}`)}>{RARITY_LABEL[tier]}</span>
          )}
          {a.unlockedHardcoreAt && <span className="tag tag--hardcore">Hardcore</span>}
        </div>
        <div className="achievement__rarity">
          <ProgressBar
            value={a.rarity}
            size="xs"
            tone="muted"
            label={`Porcentagem de jogadores com ${a.title}`}
            valueText={formatPercent(a.rarity)}
          />
          <span>{formatPercent(a.rarity)} dos jogadores têm esta conquista</span>
        </div>
      </div>
      <div className="achievement__side">
        <span className="achievement__points" title={`${a.trueRatio} pontos reais (RetroPoints)`}>
          {a.points} pts
        </span>
        {unlocked ? (
          <span className="achievement__date">
            Desbloqueada em <time dateTime={date ?? undefined}>{formatDateTime(date)}</time>
          </span>
        ) : (
          <span className="achievement__locked">
            <LockIcon size={14} /> Bloqueada
          </span>
        )}
      </div>
    </li>
  );
});
