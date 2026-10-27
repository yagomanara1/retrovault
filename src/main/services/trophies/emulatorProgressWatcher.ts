import { promises as fs } from 'node:fs';

/** Intervalo da conferência do TROPUSR.DAT enquanto um jogo de emulador roda. */
const PROGRESS_POLL_MS = 3000;

export interface EmulatorProgressWatcherDeps {
  /** TROPUSR.DAT do jogo; null = o jogo não tem lista de emulador (RPCS3/Vita3K). */
  progressPath(gameId: number): string | null;
  /** Relê o progresso e avisa o que foi desbloqueado. */
  sync(gameId: number): Promise<unknown>;
  /** Data de modificação do arquivo (0 = não existe). */
  mtime?: (file: string) => Promise<number>;
  intervalMs?: number;
}

const fileMtime = async (file: string) => (await fs.stat(file).catch(() => null))?.mtimeMs ?? 0;

/**
 * Jogos de emulador abertos: o TROPUSR.DAT é conferido a cada poucos segundos e relido só quando a data
 * de modificação muda; ao fechar o jogo, uma última leitura (o emulador grava ao sair).
 */
export class EmulatorProgressWatcher {
  private readonly watches = new Map<number, { timer: NodeJS.Timeout; mtimeMs: number }>();

  constructor(private readonly deps: EmulatorProgressWatcherDeps) {}

  watch(gameId: number): void {
    if (this.watches.has(gameId) || !this.deps.progressPath(gameId)) return;
    const watch = { mtimeMs: 0, timer: setInterval(() => void this.poll(gameId), this.deps.intervalMs ?? PROGRESS_POLL_MS) };
    watch.timer.unref?.();
    this.watches.set(gameId, watch);
  }

  async stop(gameId: number): Promise<void> {
    const watch = this.watches.get(gameId);
    if (watch) clearInterval(watch.timer);
    this.watches.delete(gameId);
    await this.deps.sync(gameId).catch(() => []);
  }

  private async poll(gameId: number): Promise<void> {
    const watch = this.watches.get(gameId);
    const file = this.deps.progressPath(gameId);
    if (!watch || !file) return;
    const mtimeMs = await (this.deps.mtime ?? fileMtime)(file);
    if (mtimeMs === watch.mtimeMs) return;
    watch.mtimeMs = mtimeMs;
    await this.deps.sync(gameId).catch(() => []);
  }
}
