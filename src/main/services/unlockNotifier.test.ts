import { describe, expect, it } from 'vitest';
import type { Game, RecentAchievement, Trophy } from '@shared/types';
import { UnlockNotifier } from './unlockNotifier';

const GAME = { id: 1, title: 'Bloodborne' } as Game;
const trophy = (over: Partial<Trophy>) => ({ id: 1, name: 'Caçador', detail: '', grade: 'B', hidden: false, iconUrl: null, unlockedAt: null, ...over }) as Trophy;
const achievement = (over: Partial<RecentAchievement>) => ({ title: 'Primeira estrela', gameTitle: 'Super Mario 64', points: 10, ...over }) as RecentAchievement;

function setup(enabled = true) {
  const shown: { title: string; body: string; icon: string | null | undefined }[] = [];
  const notifier = new UnlockNotifier({
    enabled: () => enabled,
    notify: (title, body, icon) => shown.push({ title, body, icon }),
    resolveArtwork: (url) => `C:\\artwork\\${url.split('/').pop()}`,
  });
  return { notifier, shown };
}

describe('UnlockNotifier', () => {
  it('conquista: título e pontos, uma notificação por conquista', () => {
    const { notifier, shown } = setup();
    notifier.achievements([achievement({}), achievement({ title: 'Cem moedas', points: 25 })]);
    expect(shown.map(({ title, body }) => [title, body])).toEqual([
      ['🏆 Conquista desbloqueada: Primeira estrela', 'Super Mario 64 · 10 pontos'],
      ['🏆 Conquista desbloqueada: Cem moedas', 'Super Mario 64 · 25 pontos'],
    ]);
  });

  it('troféu: grau em português, descrição quando houver e o ícone do cofre', () => {
    const { notifier, shown } = setup();
    notifier.trophies(GAME, [
      trophy({ name: 'Fim do pesadelo', grade: 'P', iconUrl: 'rv-media://artwork/p.png' }),
      trophy({ name: 'Caçador', grade: 'B', detail: 'Derrote o primeiro chefe' }),
    ]);
    expect(shown).toEqual([
      { title: '🏆 Troféu de Platina: Fim do pesadelo', body: 'Bloodborne', icon: 'C:\\artwork\\p.png' },
      { title: '🏆 Troféu de Bronze: Caçador', body: 'Bloodborne · Derrote o primeiro chefe', icon: null },
    ]);
  });

  it('notificações desligadas nas configurações: nada aparece', () => {
    const { notifier, shown } = setup(false);
    notifier.achievements([achievement({})]);
    notifier.trophies(GAME, [trophy({ grade: 'G' })]);
    expect(shown).toEqual([]);
  });
});
