import type { Achievement, AwardKind } from '@shared/types';

export type AchievementFilter = 'all' | 'unlocked' | 'locked';
export type AchievementSort = 'unlocked-first' | 'order' | 'rarity' | 'points';

export const isUnlocked = (a: Achievement) => Boolean(a.unlockedAt || a.unlockedHardcoreAt);
export const unlockDate = (a: Achievement) => a.unlockedHardcoreAt ?? a.unlockedAt;

export function filterAchievements(list: readonly Achievement[], filter: AchievementFilter): Achievement[] {
  if (filter === 'unlocked') return list.filter(isUnlocked);
  if (filter === 'locked') return list.filter((a) => !isUnlocked(a));
  return [...list];
}

export function sortAchievements(list: Achievement[], sort: AchievementSort): Achievement[] {
  const byOrder = (a: Achievement, b: Achievement) => a.displayOrder - b.displayOrder || a.id - b.id;
  switch (sort) {
    case 'order':
      return list.sort(byOrder);
    case 'rarity':
      return list.sort((a, b) => a.rarity - b.rarity || byOrder(a, b));
    case 'points':
      return list.sort((a, b) => b.points - a.points || byOrder(a, b));
    case 'unlocked-first':
    default:
      // Igual à Steam: desbloqueadas (mais recentes primeiro) e depois bloqueadas na ordem oficial.
      return list.sort((a, b) => {
        const ua = unlockDate(a);
        const ub = unlockDate(b);
        if (ua && ub) return ub.localeCompare(ua);
        if (ua) return -1;
        if (ub) return 1;
        return byOrder(a, b);
      });
  }
}

export type RarityTier = 'ultra-rare' | 'rare' | 'uncommon' | 'common';

export function rarityTier(percent: number): RarityTier {
  if (percent < 5) return 'ultra-rare';
  if (percent < 15) return 'rare';
  if (percent < 40) return 'uncommon';
  return 'common';
}

export const RARITY_LABEL: Record<RarityTier, string> = {
  'ultra-rare': 'Ultra rara',
  rare: 'Rara',
  uncommon: 'Incomum',
  common: 'Comum',
};

export const TYPE_LABEL: Record<NonNullable<Achievement['type']>, string> = {
  progression: 'Progressão',
  win_condition: 'Zerar o jogo',
  missable: 'Perdível',
};

export const AWARD_LABEL: Record<NonNullable<AwardKind>, string> = {
  mastered: 'Masterizado',
  completed: 'Completo',
  'beaten-hardcore': 'Zerado (Hardcore)',
  'beaten-softcore': 'Zerado',
};
