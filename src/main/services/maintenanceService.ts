import type { Game } from '@shared/types';

/** Arte mais nova que isso nunca é apagada pela limpeza (pode estar sendo gravada agora). */
export const RECENT_ARTWORK_MS = 10 * 60_000;

export interface MaintenanceDeps {
  games: {
    applyDumpArtwork(id: number): Promise<Game | null>;
    applyDumpArtworkToLibrary(): Promise<Game[]>;
    upgradeLegacyIcons(): Promise<number>;
    referencedArtwork(): (string | null)[];
    list(): Game[];
  };
  trophies: {
    queueAutoImport(gameId: number): Promise<unknown>;
    referencedArtwork(): (string | null)[];
    scanLibrary(): Promise<unknown>;
    syncAllEmulatorSets(): Promise<unknown>;
  };
  categories: { assignNewGame(gameId: number): Promise<boolean> };
  artwork: { collectGarbage(referenced: Iterable<string | null>, options?: { minAgeMs?: number }): Promise<void> };
  /** Arte guardada fora dos jogos e troféus (backups da biblioteca, Loja): a limpeza não pode apagá-la. */
  otherArtwork(): Promise<(string | null)[]>;
  /** Jogo da Steam: capa, fundo e tempo de jogo dela (null se não é da Steam ou nada mudou). */
  steamData(gameId: number): Promise<Game | null>;
  /** SteamGridDB completa a arte que faltar (null se nada mudou). */
  autoFillArt(gameId: number): Promise<Game | null>;
  ports: { categorizeLibrary(): Promise<void> };
  /** Sobras de instalações e de mods interrompidas. */
  cleanupLeftovers(): Promise<void>;
  repairLibrary(): Promise<void>;
  backupSaves(reason: 'initial'): Promise<unknown>;
  autoBackupSaves(): boolean;
  isRunning(gameId: number): boolean;
  backupSave(gameId: number, reason: 'auto'): void;
  onGameChanged(gameId: number): void;
}

/** Tarefas de fundo da biblioteca, num só lugar para a ordem ficar explícita. */
export class MaintenanceService {
  constructor(private readonly deps: MaintenanceDeps) {}

  /** Jogo com argumentos alterados: troféus e arte do dump em segundo plano. */
  gameChanged(gameId: number): void {
    void this.deps.trophies.queueAutoImport(gameId);
    void this.applyDumpArtwork(gameId);
  }

  /**
   * Jogo novo: além de troféus e arte, entra na categoria da sua plataforma (se ela existir).
   * A categoria espera a importação de troféus: é ela que revela um port de PS4.
   */
  gameAdded(gameId: number, origin: 'library' | 'store' = 'library'): void {
    const { deps } = this;
    // Arte do dump primeiro (é a oficial); depois o SteamGridDB completa o que faltar. Ports da
    // Loja já recebem a arte deles em afterInstall: não disputam a mesma capa.
    void this.applyDumpArtwork(gameId)
      .then(() => deps.steamData(gameId).catch((err) => (console.warn('[steam] arte/tempo da Steam falharam', err), null)))
      .then((game) => game && deps.onGameChanged(gameId))
      .then(() => (origin === 'store' ? null : deps.autoFillArt(gameId)))
      .then((game) => game && deps.onGameChanged(gameId))
      .catch((err) => console.warn('[art] arte automática falhou', err));
    void deps.trophies
      .queueAutoImport(gameId)
      .then(() => deps.categories.assignNewGame(gameId))
      .then((assigned) => assigned && deps.onGameChanged(gameId))
      .catch((err) => console.warn('[categories] categoria automática falhou', err));
  }

  /**
   * Na inicialização, com a janela já aberta: manutenção de arte primeiro (antes de qualquer tarefa
   * que grave arte nova), depois caminhos (o resto depende deles), arte e troféus.
   */
  async startup(): Promise<void> {
    const { deps } = this;
    await this.artworkMaintenance();
    await deps.ports.categorizeLibrary();
    await deps.cleanupLeftovers();
    await deps.repairLibrary().catch((err) => console.warn('[relocation] reparo inicial falhou', err));
    for (const game of await deps.games.applyDumpArtworkToLibrary()) deps.onGameChanged(game.id);
    await deps.trophies.scanLibrary();
    // Troféus ganhos no RPCS3/Vita3K com o RetroVault fechado.
    await deps.trophies.syncAllEmulatorSets();
    // Primeira proteção (e saves alterados com o app fechado): só grava o que mudou.
    if (deps.autoBackupSaves()) await deps.backupSaves('initial');
  }

  /** A cada 15 min: pega saves de jogos abertos fora do RetroVault (ex.: "Play God of War III.exe"). */
  periodicSaveBackup(): void {
    if (!this.deps.autoBackupSaves()) return;
    for (const game of this.deps.games.list()) {
      if (this.deps.isRunning(game.id)) continue; // jogo aberto: espera fechar
      this.deps.backupSave(game.id, 'auto');
    }
  }

  private applyDumpArtwork(gameId: number): Promise<void> {
    return this.deps.games
      .applyDumpArtwork(gameId)
      .then((game) => void (game && this.deps.onGameChanged(gameId)))
      .catch((err) => console.warn('[artwork] arte do dump falhou', err));
  }

  /**
   * Ícones antigos em alta resolução e limpeza da arte sem uso. Roda com a janela já aberta: a limpeza
   * poupa arquivos recentes, que podem ter acabado de ser gravados e ainda não estar no banco.
   */
  private async artworkMaintenance(): Promise<void> {
    const { deps } = this;
    const started = Date.now();
    try {
      const upgraded = await deps.games.upgradeLegacyIcons();
      if (upgraded) console.info(`[artwork] ${upgraded} ícone(s) atualizados para alta resolução`);
      // Inclui ícones de troféu e a arte dos backups: restaurar um backup não pode trazer imagens quebradas.
      await deps.artwork.collectGarbage(
        [...deps.games.referencedArtwork(), ...deps.trophies.referencedArtwork(), ...(await deps.otherArtwork())],
        { minAgeMs: RECENT_ARTWORK_MS },
      );
      console.info(`[artwork] manutenção inicial em ${Date.now() - started} ms`);
    } catch (err) {
      console.warn('[artwork] manutenção inicial falhou', err);
    }
  }
}
