import type { EventChannel, EventContract } from '@shared/ipc';
import type { Game } from '@shared/types';
import type { LauncherHooks } from './launcherService';

export interface SessionLifecycleDeps {
  emit<E extends EventChannel>(event: E, payload: EventContract[E]): void;
  /** Conquistas do RetroAchievements conferidas enquanto o jogo roda. */
  achievements: { start(gameId: number): Promise<void>; stop(gameId: number): void };
  trophies: {
    watchEmulatorProgress(gameId: number): void;
    stopWatchingEmulatorProgress(gameId: number): Promise<void>;
    queueAutoImport(gameId: number): Promise<void>;
  };
  discord: { gameStarted(game: Game): void; gameEnded(game: Game): void };
  /** Perfil e progresso do RA mudaram com a sessão: o cache do usuário é renovado. */
  invalidateRaUserData(raGameIds: number[]): void;
  autoBackupSaves(): boolean;
  backupSave(gameId: number, reason: 'session'): void;
  /** Progresso exportado ao lado do cofre (sobe junto para a nuvem). */
  exportProgress(): void;
}

/** O que acontece quando um jogo abre e fecha: conquistas, troféus, Discord, save e progresso. */
export class SessionLifecycle implements LauncherHooks {
  constructor(private readonly deps: SessionLifecycleDeps) {}

  onStarted(game: Game): void {
    const { deps } = this;
    deps.emit('session:started', { gameId: game.id });
    if (game.kind === 'retroarch' || game.raGameId) void deps.achievements.start(game.id);
    // RPCS3/Vita3K: troféus do emulador avisados na hora (a lista pode surgir na primeira execução).
    deps.trophies.watchEmulatorProgress(game.id);
    deps.discord.gameStarted(game);
  }

  onEnded(game: Game, durationSeconds: number): void {
    const { deps } = this;
    deps.discord.gameEnded(game);
    // Última leitura do emulador e, depois dela, a importação (a lista pode ter surgido agora).
    void deps.trophies.stopWatchingEmulatorProgress(game.id).then(() => deps.trophies.queueAutoImport(game.id));
    deps.achievements.stop(game.id);
    deps.invalidateRaUserData(game.raGameId ? [game.raGameId] : []);
    deps.emit('session:ended', { gameId: game.id, durationSeconds });
    // Jogo fechado: guarda o save no cofre (só grava se mudou) e o progresso ao lado dele.
    if (deps.autoBackupSaves()) deps.backupSave(game.id, 'session');
    deps.exportProgress();
  }
}
