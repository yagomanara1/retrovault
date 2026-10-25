import type { RecentAchievement } from '@shared/types';
import type { RetroAchievementsClient } from './retroachievements/client';

const POLL_INTERVAL_MS = 30_000;
const POLL_WINDOW_MINUTES = 10;
const PRIME_WINDOW_MINUTES = 60;

const unlockKey = (a: RecentAchievement) => `${a.achievementId}:${a.hardcore ? 'h' : 's'}`;

/**
 * Enquanto houver um jogo em execução, consulta periodicamente os desbloqueios recentes
 * da conta e emite os novos — o RetroArch envia os desbloqueios ao servidor, e nós os
 * refletimos no launcher (toast + notificação do sistema) quase em tempo real.
 */
export class AchievementWatcher {
  private readonly activeGames = new Set<number>();
  private readonly seen = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(
    private readonly ra: RetroAchievementsClient,
    private readonly onUnlock: (achievements: RecentAchievement[]) => void,
  ) {}

  async start(gameId: number): Promise<void> {
    if (!this.ra.hasCredentials()) return;
    this.activeGames.add(gameId);
    if (this.timer) return;
    // Timer criado antes do await: evita intervalos duplicados se dois jogos iniciarem juntos.
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
    await this.prime();
  }

  stop(gameId: number): void {
    this.activeGames.delete(gameId);
    if (this.activeGames.size > 0 || !this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    // Última checagem: pega conquistas obtidas nos segundos finais da sessão.
    void this.tick();
  }

  stopAll(): void {
    this.activeGames.clear();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Marca desbloqueios já existentes como vistos para não notificar o passado. */
  private async prime(): Promise<void> {
    try {
      const recent = await this.ra.fetchLatestUnlocks(PRIME_WINDOW_MINUTES);
      recent.forEach((a) => this.seen.add(unlockKey(a)));
    } catch (err) {
      console.warn('[watcher] falha ao inicializar', err);
    }
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const recent = await this.ra.fetchLatestUnlocks(POLL_WINDOW_MINUTES);
      const fresh = recent.filter((a) => !this.seen.has(unlockKey(a)));
      if (fresh.length === 0) return;
      fresh.forEach((a) => this.seen.add(unlockKey(a)));
      this.ra.invalidateUserData([...new Set(fresh.map((a) => a.gameId))]);
      this.onUnlock(fresh.reverse()); // ordem cronológica
    } catch (err) {
      console.warn('[watcher] falha ao consultar desbloqueios', err);
    } finally {
      this.busy = false;
    }
  }
}
