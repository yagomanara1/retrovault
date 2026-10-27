import type { Game, RecentAchievement, Trophy } from '@shared/types';

const GRADE_LABEL = { P: 'Platina', G: 'Ouro', S: 'Prata', B: 'Bronze' } as const;

export interface UnlockNotifierDeps {
  /** Configurações → "Notificar conquistas e troféus". */
  enabled(): boolean;
  notify(title: string, body: string, iconPath?: string | null): void;
  /** rv-media://… → arquivo no disco (o Windows mostra o ícone pelo caminho). */
  resolveArtwork(url: string): string | null;
}

/** Notificações do Windows para conquistas do RetroAchievements e troféus, uma por desbloqueio. */
export class UnlockNotifier {
  constructor(private readonly deps: UnlockNotifierDeps) {}

  achievements(list: readonly RecentAchievement[]): void {
    if (!this.deps.enabled()) return;
    for (const a of list) this.deps.notify(`🏆 Conquista desbloqueada: ${a.title}`, `${a.gameTitle} · ${a.points} pontos`);
  }

  trophies(game: Game, list: readonly Trophy[]): void {
    if (!this.deps.enabled()) return;
    for (const t of list) {
      this.deps.notify(
        `🏆 Troféu de ${GRADE_LABEL[t.grade]}: ${t.name}`,
        `${game.title}${t.detail ? ` · ${t.detail}` : ''}`,
        t.iconUrl ? this.deps.resolveArtwork(t.iconUrl) : null,
      );
    }
  }
}
