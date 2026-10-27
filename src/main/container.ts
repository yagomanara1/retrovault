import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { EventChannel, EventContract } from '@shared/ipc';
import type { DB } from './db/database';
import { CacheRepository } from './db/repositories/cacheRepository';
import { GameRepository } from './db/repositories/gameRepository';
import { SettingsRepository } from './db/repositories/settingsRepository';
import { TrophyRepository } from './db/repositories/trophyRepository';
import { TrophyLogWatcher } from './services/trophies/trophyLogWatcher';
import { TrophyService } from './services/trophies/trophyService';
import { TrpLocator } from './services/trophies/trpLocator';
import { DumpArtworkService } from './services/trophies/dumpArtwork';
import { AchievementWatcher } from './services/achievementWatcher';
import { ApiCache } from './services/apiCache';
import { ArtworkService } from './services/artworkService';
import { GameService } from './services/gameService';
import { LauncherService } from './services/launcherService';
import { ProcessSnapshotter } from './services/processTree';
import { RelocationService } from './services/relocationService';
import { BackupService } from './services/backupService';
import { ProgressService } from './services/progressService';
import { LibraryImportService } from './services/libraryImportService';
import { RetroAchievementsClient } from './services/retroachievements/client';
import { RetroArchService } from './services/retroarchService';
import { SettingsService } from './services/settingsService';
import { SavePathRepository } from './db/repositories/savePathRepository';
import { SaveLocator } from './services/saves/saveLocator';
import { SaveService } from './services/saves/saveService';
import { SaveVault } from './services/saves/saveVault';
import { CloudService } from './services/cloudService';
import { CategoryRepository } from './db/repositories/categoryRepository';
import { CategoryService } from './services/categoryService';
import { StoreCatalogService } from './services/store/catalogService';
import { GitHubClient } from './services/store/githubClient';
import { InstallService } from './services/store/installService';
import { RomService } from './services/store/romService';
import { StoreArtService } from './services/store/storeArt';
import { GameArtService } from './services/gameArtService';
import { CustomPortService } from './services/store/customPorts';
import type { StorePort } from '@shared/store';
import { CustomPortRepository } from './db/repositories/customPortRepository';
import { ModInstallRepository } from './db/repositories/modInstallRepository';
import { GAMEBANANA_IMAGE_HOST, GameBananaClient } from './services/store/gameBanana';
import { ModService } from './services/store/modService';
import { StoreArtRepository } from './db/repositories/storeArtRepository';
import { StoreInstallRepository } from './db/repositories/storeInstallRepository';
import { AppUpdateService, type AppUpdateDeps } from './services/appUpdateService';
import { EmulatorService } from './services/emulatorService';
import { DISCORD_CLIENT_ID, DISCORD_FALLBACK_IMAGE, isDiscordImage } from './services/discord/discordConfig';
import { DiscordPresenceService } from './services/discord/discordPresence';
import { findSteamRoot, type StoreLibraryDeps } from './services/storeLibraries';
import { applySteamGameData } from './services/steam/steamGameData';
import { MaintenanceService } from './services/maintenanceService';
import { PortLifecycleService } from './services/store/portLifecycleService';
import { fetchImage, isSteamRunning, SteamShortcutService } from './services/steam/steamShortcutService';
import { createIdBatcher } from './services/idBatcher';
import { SessionLifecycle } from './services/sessionLifecycle';
import { UnlockNotifier } from './services/unlockNotifier';
import type { Game } from '@shared/types';

export interface ContainerDeps {
  db: DB;
  dbFile: string;
  backupDir: string;
  userDataDir: string;
  /** %APPDATA%: onde launchers de ports guardam a pasta do dump (ex.: gow3-launcher\settings.json). */
  appDataDir: string;
  /** Pastas do Windows: cofre de saves padrão e locais comuns de save de jogos de PC. */
  documentsDir: string;
  homeDir: string;
  localAppDataDir: string;
  /** Onde programas costumam ser instalados (Arquivos de Programas, %LOCALAPPDATA%\Programs): procura de emuladores. */
  programDirs: readonly string[];
  /** %ProgramData%: manifestos da Epic (importação das lojas). */
  programDataDir: string;
  /** Pasta temporária do sistema. */
  tempDir: string;
  /** O RetroVault empacotado (para se adicionar à Steam); null em desenvolvimento. */
  launcherExe: string | null;
  /** Pasta da Steam fixada (RETROVAULT_STEAM_DIR, para testar numa cópia); null = procurar. */
  steamDirOverride: string | null;
  /** Abre uma URL de protocolo (steam://exit). */
  openExternal(url: string): Promise<void>;
  emit<E extends EventChannel>(event: E, payload: EventContract[E]): void;
  notify(title: string, body: string, iconPath?: string | null): void;
  /** Manda um arquivo/pasta para a Lixeira (shell.trashItem no app; injetado para testes). */
  trash(target: string): Promise<void>;
  /** Roda o instalador de um port e espera fechar (o usuário segue os passos dele). */
  runInstaller(file: string, signal: AbortSignal): Promise<void>;
  /** Seletor de .exe na janela do app; null se cancelado. */
  pickExecutable(title: string): Promise<string | null>;
  /** Atualização do próprio app: versão em uso, se este app se atualiza e o electron-updater (carregado só se sim). */
  appUpdate: Pick<AppUpdateDeps, 'currentVersion' | 'releasesUrl' | 'disabledReason' | 'createUpdater'>;
}

/** Composition root: único lugar que conhece as implementações concretas. */
export function createContainer(deps: ContainerDeps) {
  const { db, dbFile, backupDir, userDataDir, appDataDir, emit, notify } = deps;
  const gameRepo = new GameRepository(db);
  const trophyRepo = new TrophyRepository(db);
  const backups = new BackupService(db, dbFile, backupDir);
  const progress = new ProgressService(gameRepo, trophyRepo);
  // Um só repositório de configurações (chave/valor): serviços diferentes leem e gravam chaves próprias.
  const settingsRepo = new SettingsRepository(db);
  const settings = new SettingsService(settingsRepo, path.join(deps.documentsDir, 'RetroVault', 'Saves'));
  const cache = new ApiCache(new CacheRepository(db));
  const ra = new RetroAchievementsClient(() => settings.getRaCredentials(), cache);
  const retroarch = new RetroArchService(settings, userDataDir);
  const artwork = new ArtworkService(path.join(userDataDir, 'artwork'));
  // Um só localizador de dumps de PS4: troféus e arte oficial vêm do mesmo sce_sys/.
  const dumpLocator = new TrpLocator([appDataDir]);
  const games = new GameService(gameRepo, ra, retroarch, artwork, new DumpArtworkService(dumpLocator));

  const unlocks = new UnlockNotifier({
    enabled: () => settings.get().notifyAchievements,
    notify,
    resolveArtwork: (url) => artwork.resolve(url),
  });
  const watcher = new AchievementWatcher(ra, (achievements) => {
    emit('achievements:unlocked', { achievements });
    unlocks.achievements(achievements);
  });

  const emulators = new EmulatorService({
    repo: settingsRepo,
    installRoots: deps.programDirs,
    homeDir: deps.homeDir,
    retroArchCores: async () => (await retroarch.status()).cores.map((c) => c.name),
  });

  const snapshots = new ProcessSnapshotter();
  // trophies e discord são criados mais abaixo: lidos só quando um jogo abre ou fecha.
  const sessions = new SessionLifecycle({
    emit,
    achievements: watcher,
    trophies: {
      watchEmulatorProgress: (gameId) => trophies.watchEmulatorProgress(gameId),
      stopWatchingEmulatorProgress: (gameId) => trophies.stopWatchingEmulatorProgress(gameId),
      queueAutoImport: (gameId) => trophies.queueAutoImport(gameId),
    },
    discord: {
      gameStarted: (game) => discord.gameStarted(game),
      gameEnded: (game) => discord.gameEnded(game),
    },
    invalidateRaUserData: (raGameIds) => ra.invalidateUserData(raGameIds),
    autoBackupSaves: () => settings.get().autoBackupSaves,
    backupSave,
    exportProgress: exportProgressNextToVault,
  });
  const launcher = new LauncherService(gameRepo, games, retroarch, emulators, settings, snapshots, sessions);

  const saves = new SaveService({
    games,
    repo: new SavePathRepository(db),
    locator: new SaveLocator(
      {
        documents: deps.documentsDir,
        savedGames: path.join(deps.homeDir, 'Saved Games'),
        localAppData: deps.localAppDataDir,
      },
      () => retroarch.saveDirs(),
    ),
    vault: new SaveVault(() => settings.get().savesRoot),
    retroarchDir: async () => (await retroarch.saveDirs())?.exeDir ?? null,
    isRunning: (gameId) => launcher.isRunning(gameId),
  });
  const cloud = new CloudService({
    home: deps.homeDir,
    localAppData: deps.localAppDataDir,
    appData: appDataDir,
    programFiles: [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter((p): p is string => !!p),
    env: process.env,
  });

  /**
   * Troféus e tempo de jogo também saem do PC: o progresso exportado fica ao lado do cofre
   * (<cofre>\..\Progresso), então sobe junto quando o cofre está no OneDrive/Google Drive/Dropbox.
   */
  function exportProgressNextToVault(): void {
    const file = path.join(path.dirname(settings.get().savesRoot), 'Progresso', 'retrovault-progresso.json');
    void fs
      .mkdir(path.dirname(file), { recursive: true })
      .then(() => progress.export(file))
      .catch((err) => console.warn('[cloud] exportação do progresso falhou', err));
  }

  function backupSave(gameId: number, reason: 'session' | 'auto'): void {
    saves
      .backup(gameId, reason)
      .then((snapshot) => snapshot && emit('saves:changed', { gameId }))
      .catch((err) => console.warn('[saves] backup automático falhou', err));
  }

  const trophies = new TrophyService(trophyRepo, games, settings, artwork, dumpLocator, {
    onAutoImported(game, set) {
      emit('trophies:imported', { gameId: game.id, gameTitle: game.title, count: set.trophies.length });
    },
    onLogAttached(game) {
      emit('trophies:changed', { gameId: game.id });
    },
    onUnlocked(game, unlocked) {
      emit('trophies:unlocked', { gameId: game.id, gameTitle: game.title, trophies: unlocked });
      unlocks.trophies(game, unlocked);
    },
  }, appDataDir);
  const trophyWatcher = new TrophyLogWatcher(trophies);
  const relocation = new RelocationService(games, trophies, {
    onRelocated(game) {
      emit('games:relocated', { gameId: game.id, title: game.title, path: game.path });
    },
  });

  // Uma recarga da lista no renderer por rajada de mudanças, não uma por jogo.
  const changedGames = createIdBatcher((gameIds) => emit('games:changed', { gameIds }));
  const notifyGameChanged = (gameId: number) => changedGames.add(gameId);

  const storeDeps: StoreLibraryDeps = {
    programData: deps.programDataDir,
    localAppData: deps.localAppDataDir,
    appData: appDataDir,
    tempDir: deps.tempDir,
    steamFallbackDirs: deps.programDirs.map((dir) => path.join(dir, 'Steam')),
    steamDir: deps.steamDirOverride,
  };
  const libraryImport = new LibraryImportService(games, {
    onScanProgress: (progress) => emit('library:scan-progress', progress),
    onAddProgress: (progress) => emit('library:add-progress', progress),
    onGameAdded: (game) => maintenance.gameAdded(game.id),
  }, storeDeps);

  const steamRoot = () => findSteamRoot(storeDeps);

  const steamShortcuts = new SteamShortcutService({
    steamRoot,
    steamRunning: isSteamRunning,
    games,
    launchSpecFor: (game) => launcher.launchSpecFor(game),
    artworkFile: (url) => artwork.resolve(url),
    downloadImage: fetchImage,
    repo: settingsRepo,
    backupDir: path.join(userDataDir, 'steam-backups'),
    launcherExe: deps.launcherExe,
  });

  const categories = new CategoryService({
    repo: new CategoryRepository(db),
    games,
    hasPs4Trophies: (gameId) => trophyRepo.getSet(gameId)?.source === 'ps4',
  });
  // Uma categoria por console, antes da janela abrir (rápido: só consulta o que já foi oferecido).
  try {
    categories.ensureConsoleCategories();
  } catch (err) {
    console.warn('[categories] categorias de console falharam', err);
  }

  const github = new GitHubClient(cache, () => settings.getGitHubToken());
  const store = new StoreCatalogService({
    cache,
    github,
    // Configurações → Loja de ports; sem URL vale o catálogo embutido (seedCatalog.ts).
    remoteUrl: () => settings.get().storeCatalogUrl,
    // Função (e não a lista): customPorts é criado logo abaixo e lido a cada consulta.
    customPorts: (): StorePort[] => customPorts.list(),
  });
  const storeArt = new StoreArtService({ artwork, repo: new StoreArtRepository(db), cache, sgdbKey: () => settings.getSgdbKey() });
  const storeRepo = new StoreInstallRepository(db);
  const customPorts = new CustomPortService({
    repo: new CustomPortRepository(db),
    github,
    catalogPorts: async (): Promise<StorePort[]> => (await store.baseCatalog()).ports,
    // Instalado ou instalando agora: tirar da Loja no meio do download deixaria a instalação órfã.
    isInstalled: (portId) => !!storeRepo.get(portId) || installs.installing().includes(portId),
  });
  const roms = new RomService({ store, repo: storeRepo });
  const mods = new ModService({
    store,
    installs: storeRepo,
    repo: new ModInstallRepository(db),
    gb: new GameBananaClient(cache),
    importImage: (url) => storeArt.importRemote(url, { photo: true, remember: false, host: GAMEBANANA_IMAGE_HOST }),
    workDir: path.join(deps.localAppDataDir, 'RetroVault', 'Ports', '.mods'),
    isRunning: (gameId) => launcher.isRunning(gameId),
    onProgress: (progress) => emit('mods:progress', progress),
  });
  const gameArt = new GameArtService({
    games,
    sgdb: storeArt.sgdb,
    importRemote: (url, opts) => storeArt.importRemote(url, opts),
    sgdbKey: () => settings.getSgdbKey(),
  });

  const ports = new PortLifecycleService({
    installs: storeRepo,
    catalog: store,
    art: storeArt,
    games,
    categories,
    roms,
    // installs é criado logo abaixo (ele chama ports.afterInstall): lido só quando a verificação roda.
    updates: (): Promise<Record<string, { tag: string }>> => installs.updates(),
    notified: cache,
    notifyPortUpdates: () => settings.get().notifyPortUpdates,
    onGameChanged: notifyGameChanged,
    onUpdatesChanged: (count) => emit('store:updates-changed', { count }),
    notify,
  });

  const installs = new InstallService({
    store,
    repo: storeRepo,
    afterInstall: (portId): Promise<void> => ports.afterInstall(portId),
    root: path.join(deps.localAppDataDir, 'RetroVault', 'Ports'),
    games,
    isRunning: (gameId) => launcher.isRunning(gameId),
    async backupSave(gameId) {
      // "auto": só cria uma versão no cofre se o save mudou desde a última.
      const snapshot = await saves.backup(gameId, 'auto');
      if (snapshot) emit('saves:changed', { gameId });
    },
    trash: deps.trash,
    runInstaller: deps.runInstaller,
    pickExecutable: deps.pickExecutable,
    onProgress: (progress) => emit('store:install-progress', progress),
    onGameAdded: (gameId) => maintenance.gameAdded(gameId, 'store'),
  });

  const maintenance = new MaintenanceService({
    games,
    trophies,
    categories,
    artwork,
    otherArtwork: async () => [...(await backups.referencedArtwork()), ...storeArt.referencedArtwork()],
    steamData: (gameId) => applySteamGameData({ games, steamRoot }, gameId),
    autoFillArt: (gameId) => gameArt.autoFill(gameId),
    ports,
    cleanupLeftovers: async () => {
      await installs.cleanupLeftovers();
      await mods.cleanupLeftovers();
    },
    repairLibrary: () => relocation.repairLibrary(),
    backupSaves: (reason) => saves.backupLibrary(reason),
    autoBackupSaves: () => settings.get().autoBackupSaves,
    isRunning: (gameId) => launcher.isRunning(gameId),
    backupSave,
    onGameChanged: notifyGameChanged,
  });

  /** Imagem pública do jogo para o Discord: capa do RetroAchievements ou do catálogo da Loja. */
  async function publicImageOf(game: Game): Promise<string | null> {
    if (game.raGameId) {
      const progress = await ra.getGameProgress(game.raGameId).catch(() => null);
      if (isDiscordImage(progress?.boxArtUrl)) return progress.boxArtUrl;
    }
    const install = storeRepo.list().find((i) => i.gameId === game.id);
    if (install) {
      const art = (await store.port(install.portId).catch(() => null))?.art;
      for (const url of [art?.boxart, art?.logo]) if (isDiscordImage(url)) return url;
    }
    return null;
  }

  const discord = new DiscordPresenceService({
    clientId: DISCORD_CLIENT_ID,
    enabled: () => settings.get().discordPresence,
    fallbackImageUrl: DISCORD_FALLBACK_IMAGE,
    describe: async (game) => ({
      platform: (await categories.platformOf(game).catch(() => null)) ?? (game.kind === 'executable' ? 'PC' : null),
      imageUrl: await publicImageOf(game),
    }),
  });

  const appUpdate = new AppUpdateService({
    ...deps.appUpdate,
    emit: (state) => emit('app:update-changed', state),
    busyReason: () => {
      const ports = installs.installing().length;
      return ports ? `Espere ${ports === 1 ? 'o port terminar' : `os ${ports} ports terminarem`} de instalar (ou cancele) antes de reiniciar.` : null;
    },
  });

  settings.onChange((next, prev) => {
    if (next.raUsername !== prev.raUsername || next.hasApiKey !== prev.hasApiKey) {
      ra.invalidateAllUserData();
    }
    // Pacotes que falharam por falta de chave são importados assim que ela é cadastrada.
    if (next.hasTrophyKey && !prev.hasTrophyKey) void trophies.scanLibrary();
    if (next.storeCatalogUrl !== prev.storeCatalogUrl) store.invalidate();
    if (next.hasSgdbKey !== prev.hasSgdbKey) storeArt.invalidate();
    if (next.discordPresence !== prev.discordPresence) discord.settingsChanged();
  });

  return { settings, cache, ra, retroarch, artwork, games, launcher, snapshots, watcher, trophies, trophyWatcher, relocation, maintenance, backups, progress, libraryImport, saves, cloud, exportProgressNextToVault, categories, store, github, installs, roms, storeArt, ports, gameArt, customPorts, mods, appUpdate, discord, emulators, steamShortcuts, openExternal: deps.openExternal };
}

export type Container = ReturnType<typeof createContainer>;
