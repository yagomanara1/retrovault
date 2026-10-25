import type { GradeCount, Trophy, TrophyGrade, TrophySource } from '@shared/types';

/** Plataforma de cada origem da lista de troféus (rótulo quando o jogo não tem categoria). */
export const TROPHY_SOURCE_LABEL: Record<TrophySource, string> = {
  ps4: 'PlayStation 4',
  rpcs3: 'PlayStation 3',
  vita3k: 'PS Vita',
  manual: 'PC',
};

export const GRADE_ORDER: readonly TrophyGrade[] = ['P', 'G', 'S', 'B'];

export const GRADE_LABEL: Record<TrophyGrade, string> = {
  P: 'Platina',
  G: 'Ouro',
  S: 'Prata',
  B: 'Bronze',
};

/** Pontuação da PSN por grau, usada para calcular o progresso como no PS4. */
export const GRADE_POINTS: Record<TrophyGrade, number> = { P: 300, G: 90, S: 30, B: 15 };

export type TrophyFilter = 'all' | 'unlocked' | 'locked';
export type TrophySort = 'default' | 'grade' | 'recent';

export interface TrophyStats {
  total: number;
  unlocked: number;
  points: number;
  maxPoints: number;
  /** 0–100, ponderado por pontos (igual ao PS4). */
  percent: number;
  byGrade: Record<TrophyGrade, GradeCount>;
}

export const emptyGrades = (): Record<TrophyGrade, GradeCount> => ({
  P: { total: 0, unlocked: 0 },
  G: { total: 0, unlocked: 0 },
  S: { total: 0, unlocked: 0 },
  B: { total: 0, unlocked: 0 },
});

/** Estatísticas a partir das contagens por grau: base comum da página do jogo e da página geral. */
export function statsFromGrades(byGrade: Record<TrophyGrade, GradeCount>): TrophyStats {
  let total = 0;
  let unlocked = 0;
  let points = 0;
  let maxPoints = 0;
  for (const grade of GRADE_ORDER) {
    const c = byGrade[grade];
    total += c.total;
    unlocked += c.unlocked;
    points += c.unlocked * GRADE_POINTS[grade];
    maxPoints += c.total * GRADE_POINTS[grade];
  }
  return { total, unlocked, points, maxPoints, percent: maxPoints ? Math.floor((points / maxPoints) * 100) : 0, byGrade };
}

export function trophyStats(trophies: readonly Trophy[]): TrophyStats {
  const byGrade = emptyGrades();
  for (const t of trophies) {
    byGrade[t.grade].total++;
    if (t.unlockedAt) byGrade[t.grade].unlocked++;
  }
  return statsFromGrades(byGrade);
}

/** Soma as contagens de vários jogos (perfil geral). */
export function sumGrades(list: readonly Record<TrophyGrade, GradeCount>[]): Record<TrophyGrade, GradeCount> {
  const sum = emptyGrades();
  for (const byGrade of list) {
    for (const g of GRADE_ORDER) {
      sum[g].total += byGrade[g].total;
      sum[g].unlocked += byGrade[g].unlocked;
    }
  }
  return sum;
}

/**
 * Tabela de níveis da PSN (desde 2020): pontos por nível em cada faixa de 100 níveis.
 * 1–99: 60 · 100–199: 90 · 200–299: 450 · depois +450 a cada centena (300–399: 900 …), até o 999.
 */
const POINTS_PER_LEVEL = [60, 90, 450, 900, 1350, 1800, 2250, 2700, 3150, 3600];
export const MAX_LEVEL = 999;

export interface TrophyLevel {
  level: number;
  /** 0–100 até o próximo nível. */
  progress: number;
  pointsToNext: number;
}

export function trophyLevel(points: number): TrophyLevel {
  let level = 1;
  let remaining = Math.max(0, points);
  while (level < MAX_LEVEL) {
    const cost = POINTS_PER_LEVEL[Math.min(Math.floor(level / 100), POINTS_PER_LEVEL.length - 1)]!;
    if (remaining < cost) return { level, progress: Math.floor((remaining / cost) * 100), pointsToNext: cost - remaining };
    remaining -= cost;
    level++;
  }
  return { level: MAX_LEVEL, progress: 100, pointsToNext: 0 };
}

export function filterTrophies(trophies: readonly Trophy[], filter: TrophyFilter): Trophy[] {
  if (filter === 'unlocked') return trophies.filter((t) => t.unlockedAt);
  if (filter === 'locked') return trophies.filter((t) => !t.unlockedAt);
  return [...trophies];
}

export function sortTrophies(trophies: Trophy[], sort: TrophySort): Trophy[] {
  const byId = (a: Trophy, b: Trophy) => a.id - b.id;
  switch (sort) {
    case 'grade':
      return trophies.sort((a, b) => GRADE_ORDER.indexOf(a.grade) - GRADE_ORDER.indexOf(b.grade) || byId(a, b));
    case 'recent':
      return trophies.sort((a, b) => {
        if (a.unlockedAt && b.unlockedAt) return b.unlockedAt.localeCompare(a.unlockedAt);
        if (a.unlockedAt) return -1;
        if (b.unlockedAt) return 1;
        return byId(a, b);
      });
    case 'default':
    default:
      return trophies.sort(byId);
  }
}
