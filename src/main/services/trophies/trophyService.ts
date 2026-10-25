import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Game, Trophy, TrophyInput, TrophyOverview, TrophySet } from '@shared/types';
import type { TrophyRecord, TrophyRepository, WatchedSet } from '../../db/repositories/trophyRepository';
import { AppError } from '../../errors';
import type { ArtworkService } from '../artworkService';
import type { GameService } from '../gameService';
import type { SettingsService } from '../settingsService';
import { locateEmulatorTrophies, readProgressFile, readTrophyFolder, type EmulatorTrophyLocation } from './emulatorTrophies';
import { findNpCommId, readTrophyPackage } from './trp';
import type { TrpLocator } from './trpLocator';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/** Linha que o runtime do port escreve: `Runtime: trophy 12 unlocked`. */
export const DEFAULT_LOG_PATTERN = String.raw`trophy\s+(\d+)\s+unlocked`;
/** Idiomas por prioridade: 17 = Português (Brasil); TROP = idioma padrão do pacote. */
const LANGUAGES = ['TROP_17', 'TROP_07', 'TROP'] as const;
const MAX_TRP_BYTES = 64 * 1024 * 1024;
/** Troféus recentes na página geral. */
const RECENT_LIMIT = 30;

export interface TrophyHooks {
  onUnlocked(game: Game, trophies: Trophy[]): void;
  /** Lista importada sozinha (jogo adicionado, inicialização ou trophy key cadastrada). */
  onAutoImported(game: Game, set: TrophySet): void;
  /** O log do jogo apareceu (primeira execução do port) e a detecção foi ligada sozinha. */
  onLogAttached(game: Game, logPath: string): void;
}

/** Intervalo da conferência do TROPUSR.DAT enquanto um jogo de emulador roda. */
const PROGRESS_POLL_MS = 3000;

export class TrophyService {
  /** Serializa as importações automáticas: nunca duas ao mesmo tempo. */
  private autoQueue: Promise<void> = Promise.resolve();
  /** Jogos de emulador abertos: TROPUSR.DAT conferido periodicamente (pela data de modificação). */
  private readonly progressWatches = new Map<number, { timer: NodeJS.Timeout; mtimeMs: number }>();

  constructor(
    private readonly repo: TrophyRepository,
    private readonly games: GameService,
    private readonly settings: SettingsService,
    private readonly artwork: ArtworkService,
    private readonly locator: TrpLocator,
    private readonly hooks: TrophyHooks,
    /** %APPDATA%: onde o Vita3K guarda os dados quando não é portátil. */
    private readonly appDataDir: string,
  ) {}

  overview(): TrophyOverview {
    return this.repo.overview(RECENT_LIMIT);
  }

  get(gameId: number): TrophySet | null {
    this.games.get(gameId);
    return this.repo.getSet(gameId);
  }

  async importTrp(gameId: number, trpPath: string): Promise<TrophySet> {
    const game = this.games.get(gameId);
    const stat = await fs.stat(trpPath).catch(() => null);
    if (!stat?.isFile()) throw new AppError('FILE_MISSING', 'Arquivo .trp não encontrado.');
    if (stat.size > MAX_TRP_BYTES) throw new AppError('VALIDATION', 'Arquivo .trp grande demais.');

    const data = await fs.readFile(trpPath);
    const npCommId = await findNpCommId(trpPath);
    const pkg = readTrophyPackage(data, this.settings.getTrophyKey(), npCommId, LANGUAGES);
    if (pkg.trophies.length === 0) throw new AppError('VALIDATION', 'Nenhum troféu encontrado no pacote.');

    const icon = async (name: string) => {
      const png = pkg.images.get(name);
      return png ? this.artwork.saveImage(png, 'png') : null;
    };
    const trophies: TrophyRecord[] = [];
    for (const t of pkg.trophies) {
      trophies.push({
        trophyId: t.id,
        name: t.name,
        detail: t.detail,
        grade: t.grade,
        hidden: t.hidden,
        iconUrl: await icon(`TROP${String(t.id).padStart(3, '0')}.PNG`),
      });
    }

    const existing = this.repo.getSet(gameId);
    this.repo.replaceSet(
      {
        gameId,
        source: 'ps4',
        npCommId,
        title: pkg.title,
        iconUrl: await icon('ICON0.PNG'),
        logPath: existing?.logPath ?? (await this.detectLogPath(game)),
      },
      trophies,
    );
    return this.repo.getSet(gameId)!;
  }

  /** Procura os troféus do jogo: no emulador (RPCS3/Vita3K) ou o trophy00.trp do dump, e importa. */
  async autoImport(gameId: number): Promise<TrophySet> {
    const game = this.games.get(gameId);
    const emulated = await locateEmulatorTrophies(game, this.appDataDir);
    if (emulated) return this.importEmulatorSet(gameId, emulated);
    const location = await this.locator.locate(game);
    if (!location) {
      const exe = path.basename(game.path, path.extname(game.path)).toLowerCase();
      throw new AppError(
        'NOT_FOUND',
        exe === 'rpcs3' || exe === 'vita3k'
          ? `O ${exe === 'rpcs3' ? 'RPCS3' : 'Vita3K'} ainda não tem a lista de troféus deste jogo. Ela aparece depois que o jogo roda uma vez nele.`
          : 'Não encontramos o sce_sys/trophy/trophy00.trp deste jogo. Use "Escolher .trp…" para indicar o arquivo.',
      );
    }
    console.info(`[trophies] ${game.title}: ${location.trpPath} (${location.source})`);
    return this.importTrp(gameId, location.trpPath);
  }

  /**
   * Lista que o emulador já guarda (RPCS3 ou Vita3K): nomes no idioma preferido, ícones e os desbloqueios
   * do TROPUSR.DAT, com as datas do emulador.
   */
  async importEmulatorSet(gameId: number, location: EmulatorTrophyLocation): Promise<TrophySet> {
    const folder = await readTrophyFolder(location.folder, LANGUAGES);
    if (folder.trophies.length === 0) throw new AppError('VALIDATION', 'A lista de troféus do emulador está vazia.');
    const icon = async (name: string) => {
      const png = await fs.readFile(path.join(location.folder, name)).catch(() => null);
      return png && png.subarray(0, 4).equals(PNG_SIGNATURE) ? this.artwork.saveImage(png, 'png') : null;
    };
    const trophies: TrophyRecord[] = [];
    for (const t of folder.trophies) {
      trophies.push({ trophyId: t.id, name: t.name, detail: t.detail, grade: t.grade, hidden: t.hidden, iconUrl: await icon(`TROP${String(t.id).padStart(3, '0')}.PNG`) });
    }
    this.repo.replaceSet(
      {
        gameId,
        source: location.emulator,
        npCommId: location.npCommId,
        title: folder.title,
        iconUrl: await icon('ICON0.PNG'),
        logPath: null,
        progressPath: location.progressPath,
      },
      trophies,
    );
    await this.syncEmulatorProgress(gameId, false);
    return this.repo.getSet(gameId)!;
  }

  /**
   * Relê o TROPUSR.DAT e desbloqueia o que o emulador desbloqueou (com a data dele). `notify` = avisar
   * (jogo aberto agora); ao abrir o app ou importar, os antigos entram sem notificação. Nunca rebloqueia:
   * o emulador só acrescenta.
   */
  async syncEmulatorProgress(gameId: number, notify: boolean): Promise<number[]> {
    const set = this.repo.emulatorSets().find((s) => s.gameId === gameId);
    if (!set) return [];
    let progress;
    try {
      progress = await readProgressFile(set.emulator, set.progressPath);
    } catch (err) {
      console.warn(`[trophies] TROPUSR.DAT ilegível (${set.progressPath})`, err);
      return [];
    }
    if (!progress) return []; // o emulador ainda não criou (nenhum troféu nem abertura)
    const current = this.repo.getSet(gameId);
    if (!current) return [];
    const locked = new Set(current.trophies.filter((t) => !t.unlockedAt).map((t) => t.id));
    const changed: number[] = [];
    for (const [id, state] of progress) {
      if (!state.unlocked || !locked.has(id)) continue;
      changed.push(...this.repo.unlock(gameId, [id], 'auto', (state.at ?? new Date()).toISOString()));
    }
    if (changed.length && notify) {
      const game = this.games.list().find((g) => g.id === gameId);
      const after = this.repo.getSet(gameId);
      if (game && after) this.hooks.onUnlocked(game, after.trophies.filter((t) => changed.includes(t.id)));
    }
    return changed;
  }

  /** Ao abrir o app: desbloqueios feitos no emulador com o RetroVault fechado entram (sem notificação). */
  async syncAllEmulatorSets(): Promise<void> {
    for (const { gameId } of this.repo.emulatorSets()) await this.syncEmulatorProgress(gameId, false).catch(() => []);
  }

  /** Jogo de emulador aberto: confere o TROPUSR.DAT a cada poucos segundos e avisa na hora. */
  watchEmulatorProgress(gameId: number): void {
    if (this.progressWatches.has(gameId) || !this.repo.emulatorSets().some((s) => s.gameId === gameId)) return;
    const watch = { mtimeMs: 0, timer: setInterval(() => void this.pollProgress(gameId), PROGRESS_POLL_MS) };
    watch.timer.unref?.();
    this.progressWatches.set(gameId, watch);
  }

  /** Jogo fechado: para de conferir e faz a última leitura (o emulador grava ao sair). */
  async stopWatchingEmulatorProgress(gameId: number): Promise<void> {
    const watch = this.progressWatches.get(gameId);
    if (watch) clearInterval(watch.timer);
    this.progressWatches.delete(gameId);
    await this.syncEmulatorProgress(gameId, true).catch(() => []);
  }

  private async pollProgress(gameId: number): Promise<void> {
    const watch = this.progressWatches.get(gameId);
    const set = this.repo.emulatorSets().find((s) => s.gameId === gameId);
    if (!watch || !set) return;
    const mtimeMs = (await fs.stat(set.progressPath).catch(() => null))?.mtimeMs ?? 0;
    if (mtimeMs === watch.mtimeMs) return;
    watch.mtimeMs = mtimeMs;
    await this.syncEmulatorProgress(gameId, true).catch(() => []);
  }

  /** Importação automática em segundo plano para um jogo recém-adicionado ou alterado. */
  queueAutoImport(gameId: number): Promise<void> {
    return this.enqueue(() => this.tryAutoImport(gameId));
  }

  /** Varre a biblioteca: jogos sem lista (e sem opt-out) ganham os troféus do dump. */
  scanLibrary(): Promise<void> {
    return this.enqueue(async () => {
      for (const gameId of this.repo.gamesPendingAutoImport()) await this.tryAutoImport(gameId);
    });
  }

  async createManual(gameId: number): Promise<TrophySet> {
    const game = this.games.get(gameId);
    this.repo.createManualSet(gameId, await this.detectLogPath(game));
    return this.repo.getSet(gameId)!;
  }

  deleteSet(gameId: number): void {
    this.games.get(gameId);
    this.repo.deleteSet(gameId);
  }

  upsert(input: TrophyInput): TrophySet {
    this.requireSet(input.gameId);
    this.repo.upsertTrophy(input.gameId, {
      trophyId: input.trophyId,
      name: input.name.trim(),
      detail: input.detail.trim(),
      grade: input.grade,
      hidden: input.hidden,
    });
    return this.repo.getSet(input.gameId)!;
  }

  delete(gameId: number, trophyId: number): TrophySet {
    this.requireSet(gameId);
    this.repo.deleteTrophy(gameId, trophyId);
    return this.repo.getSet(gameId)!;
  }

  setUnlocked(gameId: number, trophyId: number, unlocked: boolean): TrophySet {
    this.requireSet(gameId);
    const source = this.repo.getSet(gameId)!.source;
    if (source === 'rpcs3' || source === 'vita3k') {
      throw new AppError('VALIDATION', `Os troféus deste jogo vêm do ${source === 'rpcs3' ? 'RPCS3' : 'Vita3K'}: eles se desbloqueiam jogando.`);
    }
    if (unlocked) {
      this.unlockWithPlatinum(gameId, [trophyId], 'manual');
    } else {
      this.repo.lock(gameId, trophyId);
    }
    return this.repo.getSet(gameId)!;
  }

  async configureLog(gameId: number, logPath: string | null | 'auto'): Promise<TrophySet> {
    const game = this.games.get(gameId);
    this.requireSet(gameId);
    const resolved = logPath === 'auto' ? await this.detectLogPath(game) : logPath;
    if (logPath === 'auto' && !resolved) {
      throw new AppError('NOT_FOUND', 'Nenhum log conhecido encontrado. Escolha o arquivo manualmente.');
    }
    this.repo.setLogPath(gameId, resolved);
    return this.repo.getSet(gameId)!;
  }

  // ---------- Integração com o watcher ----------

  watchedSets(): WatchedSet[] {
    return this.repo.watchedSets();
  }

  /**
   * Liga a detecção nas listas importadas antes de o port rodar pela primeira vez:
   * a pasta user\ (com o last_run.log) só existe depois disso. Detecção desligada pelo usuário fica como está.
   */
  async attachMissingLogs(): Promise<void> {
    const pending = this.repo.setsMissingLog();
    if (pending.length === 0) return;
    const games = new Map(this.games.list().map((g) => [g.id, g]));
    for (const gameId of pending) {
      const game = games.get(gameId);
      const logPath = game ? await this.detectLogPath(game) : null;
      if (!game || !logPath) continue;
      this.repo.attachLog(gameId, logPath);
      console.info(`[trophies] ${game.title}: detecção ligada em ${logPath}`);
      this.hooks.onLogAttached(game, logPath);
    }
  }

  /** Persiste o cursor do log e desbloqueia os ids encontrados (idempotente). */
  applyLogProgress(gameId: number, cursor: number, tailHash: string | null, trophyIds: readonly number[]): void {
    this.repo.saveCursor(gameId, cursor, tailHash);
    if (trophyIds.length === 0) return;
    const changed = this.unlockWithPlatinum(gameId, trophyIds, 'auto');
    if (changed.length === 0) return;
    const set = this.repo.getSet(gameId);
    const game = this.games.list().find((g) => g.id === gameId);
    if (!set || !game) return;
    const unlocked = set.trophies.filter((t) => changed.includes(t.id));
    this.hooks.onUnlocked(game, unlocked);
  }

  /** Jogo movido: o log vigiado que ficava na pasta antiga passa a apontar para a nova. */
  onGameMoved(gameId: number, previousPath: string, newPath: string): void {
    const set = this.repo.getSet(gameId);
    if (!set?.logPath) return;
    const relative = path.relative(path.dirname(previousPath), set.logPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return; // log fora da pasta do jogo
    this.repo.setLogPath(gameId, path.join(path.dirname(newPath), relative));
  }

  referencedArtwork(): string[] {
    return this.repo.artworkUrls();
  }

  // ---------- Internos ----------

  /**
   * No PS4 a platina é concedida pelo sistema, não pelo jogo:
   * desbloqueia automaticamente quando todos os outros troféus forem obtidos.
   */
  private unlockWithPlatinum(gameId: number, ids: readonly number[], source: 'auto' | 'manual'): number[] {
    const set = this.repo.getSet(gameId);
    if (!set) return [];
    const known = new Set(set.trophies.map((t) => t.id));
    const changed = this.repo.unlock(gameId, ids.filter((id) => known.has(id)), source);

    const after = this.repo.getSet(gameId)!;
    const platinum = after.trophies.find((t) => t.grade === 'P' && !t.unlockedAt);
    const others = after.trophies.filter((t) => t.grade !== 'P');
    if (platinum && others.length > 0 && others.every((t) => t.unlockedAt)) {
      changed.push(...this.repo.unlock(gameId, [platinum.id], source));
    }
    return changed;
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.autoQueue.then(task, task);
    this.autoQueue = next.catch(() => undefined);
    return next;
  }

  /** Não lança: falhas em segundo plano só vão para o log (o usuário ainda pode importar à mão). */
  private async tryAutoImport(gameId: number): Promise<void> {
    if (this.repo.getSet(gameId)) return;
    const game = this.games.list().find((g) => g.id === gameId);
    if (!game) return;
    try {
      const stillPending = () => !this.repo.getSet(gameId) && this.repo.gamesPendingAutoImport().includes(gameId);
      // Emulador que já guarda os troféus (RPCS3, Vita3K): a lista dele, com os desbloqueios.
      const emulated = await locateEmulatorTrophies(game, this.appDataDir);
      if (emulated) {
        if (!stillPending()) return;
        const set = await this.importEmulatorSet(gameId, emulated);
        console.info(`[trophies] ${game.title}: ${set.trophies.length} troféus do ${emulated.emulator} (${emulated.folder})`);
        this.hooks.onAutoImported(game, set);
        return;
      }
      const location = await this.locator.locate(game);
      if (!location) return;
      // Revalida após o await: o usuário pode ter criado/removido a lista nesse meio-tempo.
      if (!stillPending()) return;
      const set = await this.importTrp(gameId, location.trpPath);
      console.info(`[trophies] ${game.title}: ${set.trophies.length} troféus importados de ${location.trpPath} (${location.source})`);
      this.hooks.onAutoImported(game, set);
    } catch (err) {
      // Sem trophy key: tenta de novo quando ela for cadastrada (ver container).
      const code = err instanceof AppError ? err.code : null;
      if (code === 'TROPHY_KEY_MISSING') console.info(`[trophies] ${game.title}: aguardando trophy key`);
      else console.warn(`[trophies] importação automática falhou para ${game.title}`, err);
    }
  }

  private requireSet(gameId: number): void {
    if (!this.repo.getSet(gameId)) throw new AppError('NOT_FOUND', 'Este jogo ainda não tem lista de troféus.');
  }

  /** Ports no padrão bloodborne_pc/gow3_pc gravam o log em <pasta do exe>/user/last_run.log. */
  private async detectLogPath(game: Game): Promise<string | null> {
    if (game.kind !== 'executable') return null;
    const userDir = path.join(path.dirname(game.path), 'user');
    const isDir = await fs.stat(userDir).then((s) => s.isDirectory()).catch(() => false);
    return isDir ? path.join(userDir, 'last_run.log') : null;
  }
}
