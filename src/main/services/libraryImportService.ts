import type { BatchAddItem, BatchAddProgress, BatchAddResult, Game, ScanProgress, ScanResult } from '@shared/types';
import { AppError, toIpcError } from '../errors';
import type { GameService } from './gameService';
import { scanLibraryFolder } from './libraryScanner';
import { scanStoreLibraries, type StoreLibraryDeps } from './storeLibraries';

export interface LibraryImportHooks {
  onScanProgress(progress: ScanProgress): void;
  onAddProgress(progress: BatchAddProgress): void;
  /** Jogo adicionado: troféus e arte do dump em segundo plano (mesma rotina do "Adicionar jogo"). */
  onGameAdded(game: Game): void;
}

/** "Adicionar pasta": varre uma pasta e adiciona os jogos escolhidos em lote. */
export class LibraryImportService {
  private scanController: AbortController | null = null;
  private adding = false;

  constructor(
    private readonly games: GameService,
    private readonly hooks: LibraryImportHooks,
    private readonly stores: StoreLibraryDeps,
  ) {}

  /** "Importar das lojas instaladas": a mesma revisão da varredura, com os jogos da Steam, Epic, GOG… */
  async scanStores(): Promise<ScanResult> {
    const started = Date.now();
    const libraryPaths = new Set(this.games.list().map((g) => g.path.toLowerCase()));
    const candidates = await scanStoreLibraries(this.stores, libraryPaths);
    return { source: 'stores', root: 'Lojas instaladas', candidates, dirsVisited: 0, truncated: false, elapsedMs: Date.now() - started };
  }

  /** Uma varredura por vez: uma nova cancela a anterior. */
  async scan(root: string): Promise<ScanResult> {
    this.scanController?.abort();
    const controller = new AbortController();
    this.scanController = controller;
    try {
      const libraryPaths = new Set(this.games.list().map((g) => g.path.toLowerCase()));
      return await scanLibraryFolder(root, {
        libraryPaths,
        signal: controller.signal,
        onProgress: (p) => this.hooks.onScanProgress(p),
      });
    } finally {
      if (this.scanController === controller) this.scanController = null;
    }
  }

  cancelScan(): void {
    this.scanController?.abort();
  }

  /**
   * Adiciona em sequência (o RetroAchievements tem limite de requisições e a identificação de ROMs
   * lê o arquivo). Falhas de um item não interrompem os outros.
   */
  async addMany(items: readonly BatchAddItem[]): Promise<BatchAddResult> {
    if (this.adding) throw new AppError('VALIDATION', 'Já existe uma importação em andamento.');
    this.adding = true;
    const result: BatchAddResult = { added: 0, failed: [] };
    try {
      for (const [i, item] of items.entries()) {
        this.hooks.onAddProgress({ done: i, total: items.length, current: item.title });
        try {
          const { game } = await this.games.add({
            kind: item.kind,
            path: item.path,
            title: item.title,
            consoleId: item.kind === 'retroarch' ? item.consoleId : null,
            steamAppId: item.steamAppId ?? null,
          });
          result.added++;
          this.hooks.onGameAdded(game);
        } catch (err) {
          result.failed.push({ title: item.title, message: toIpcError(err).message });
        }
      }
      this.hooks.onAddProgress({ done: items.length, total: items.length, current: null });
      return result;
    } finally {
      this.adding = false;
    }
  }
}
