import type { Trophy, TrophyGrade } from '@shared/types';
import { describe, expect, it } from 'vitest';
import { filterTrophies, sortTrophies, statsFromGrades, sumGrades, trophyLevel, trophyStats } from './trophyUtils';

const trophy = (id: number, grade: TrophyGrade, unlockedAt: string | null = null): Trophy => ({
  id,
  name: `T${id}`,
  detail: '',
  grade,
  hidden: false,
  iconUrl: null,
  unlockedAt,
  unlockSource: unlockedAt ? 'auto' : null,
});

describe('trophyLevel (tabela da PSN)', () => {
  it.each([
    [0, 1, 0],
    [59, 1, 98],
    [60, 2, 0],
    [5_939, 99, 98],
    [5_940, 100, 0], // 99 níveis × 60
    [14_940, 200, 0], // + 100 × 90
    [59_940, 300, 0], // + 100 × 450
  ])('%i pontos → nível %i (%i%%)', (points, level, progress) => {
    expect(trophyLevel(points)).toMatchObject({ level, progress });
  });

  it('para no nível 999', () => {
    expect(trophyLevel(1e12)).toEqual({ level: 999, progress: 100, pointsToNext: 0 });
  });
});

describe('estatísticas', () => {
  // Caso real do GoW3: 1 P, 5 G, 11 S, 18 B; 2 bronzes obtidos.
  const gow = [
    trophy(0, 'P'),
    ...Array.from({ length: 5 }, (_, i) => trophy(1 + i, 'G')),
    ...Array.from({ length: 11 }, (_, i) => trophy(6 + i, 'S')),
    ...Array.from({ length: 18 }, (_, i) => trophy(17 + i, 'B', i < 2 ? `2026-10-2${i}T00:00:00Z` : null)),
  ];

  it('percentual ponderado por pontos, como no PS4', () => {
    expect(trophyStats(gow)).toMatchObject({ total: 35, unlocked: 2, points: 30, maxPoints: 1350, percent: 2 });
  });

  it('statsFromGrades dá o mesmo resultado que a lista inteira', () => {
    const s = trophyStats(gow);
    expect(statsFromGrades(s.byGrade)).toEqual(s);
  });

  it('sumGrades soma vários jogos', () => {
    const a = trophyStats([trophy(0, 'G', 'x')]).byGrade;
    const b = trophyStats([trophy(0, 'G'), trophy(1, 'B', 'x')]).byGrade;
    expect(sumGrades([a, b])).toMatchObject({ G: { total: 2, unlocked: 1 }, B: { total: 1, unlocked: 1 } });
  });

  it('lista vazia não divide por zero', () => {
    expect(trophyStats([]).percent).toBe(0);
  });
});

describe('filtrar e ordenar', () => {
  const list = [trophy(2, 'B', '2026-01-01T00:00:00Z'), trophy(0, 'P'), trophy(1, 'G', '2026-02-01T00:00:00Z')];

  it('filtra por obtidos / não obtidos', () => {
    expect(filterTrophies(list, 'unlocked').map((t) => t.id)).toEqual([2, 1]);
    expect(filterTrophies(list, 'locked').map((t) => t.id)).toEqual([0]);
  });

  it('ordena por grau, por recentes e pela ordem do jogo', () => {
    expect(sortTrophies([...list], 'grade').map((t) => t.grade)).toEqual(['P', 'G', 'B']);
    expect(sortTrophies([...list], 'recent').map((t) => t.id)).toEqual([1, 2, 0]);
    expect(sortTrophies([...list], 'default').map((t) => t.id)).toEqual([0, 1, 2]);
  });
});
