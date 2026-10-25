import { type ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';
import { shell } from 'electron';
import type { Game } from '@shared/types';
import type { GameRepository } from '../db/repositories/gameRepository';
import { AppError } from '../errors';
import { assertFile, parseArgs } from './fsUtils';
import type { EmulatorService } from './emulatorService';
import type { GameService } from './gameService';
import { createTreeState, type ProcessSnapshot, type ProcessSnapshotter, type TreeState, updateTree } from './processTree';
import type { LaunchSpec, RetroArchService } from './retroarchService';
import type { SettingsService } from './settingsService';
import { steamGameDir, steamRunUrl } from './steam/steamLibrary';

/** Sem snapshot depois que o processo raiz fechou: encerra mesmo assim (PowerShell travado). */
const ROOT_EXIT_GRACE_MS = 10_000;
/** Quanto esperar a Steam abrir o jogo: ela pode estar iniciando, atualizando o jogo ou sincronizando a nuvem. */
export const STEAM_START_TIMEOUT_MS = 3 * 60_000;

interface RunningSession {
  /** null = aberto pela Steam (o processo do jogo é filho dela, não do RetroVault). */
  child: ChildProcess | null;
  sessionId: number;
  /** Início do tempo de jogo (num jogo da Steam, quando o processo dele apareceu). */
  startedAt: number;
  game: Game;
  tree: TreeState;
  /** Último instante em que algum processo da sessão foi visto vivo. */
  lastAliveAt: number;
  rootExited: boolean;
  rootExitedAt: number;
  graceTimer: NodeJS.Timeout | null;
  /** Jogo da Steam ainda não apareceu: até quando esperar. null = apareceu (ou não é da Steam). */
  steamWaitUntil: number | null;
}

export interface LauncherHooks {
  onStarted(game: Game): void;
  onEnded(game: Game, durationSeconds: number): void;
}

function buildExecutableLaunch(game: Game): LaunchSpec {
  const ext = path.extname(game.path).toLowerCase();
  const extraArgs = parseArgs(game.launchArgs);

  if (ext === '.lnk' && process.platform === 'win32') {
    let link: Electron.ShortcutDetails;
    try {
      link = shell.readShortcutLink(game.path);
    } catch (err) {
      throw new AppError('LAUNCH_FAILED', 'Atalho inválido ou corrompido.', { cause: err });
    }
    if (!link.target) {
      throw new AppError('LAUNCH_FAILED', 'Este atalho não aponta para um executável (ex.: atalhos da Microsoft Store).');
    }
    return {
      command: link.target,
      args: [...parseArgs(link.args), ...extraArgs],
      cwd: link.cwd || path.dirname(link.target),
    };
  }

  if (ext === '.bat' || ext === '.cmd') {
    return {
      command: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/c', game.path, ...extraArgs],
      cwd: path.dirname(game.path),
    };
  }

  return { command: game.path, args: extraArgs, cwd: path.dirname(game.path) };
}

/**
 * Uma sessão dura enquanto a árvore de processos do jogo estiver viva, não só o processo aberto
 * pelo RetroVault: launchers de ports abrem o executável real e podem fechar em seguida.
 */
export class LauncherService {
  private readonly sessions = new Map<number, RunningSession>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly repo: GameRepository,
    private readonly games: GameService,
    private readonly retroarch: RetroArchService,
    /** Emulador próprio do console da ROM, se escolhido (senão, o RetroArch). */
    private readonly emulators: Pick<EmulatorService, 'launchSpec'>,
    private readonly settings: SettingsService,
    private readonly snapshots: Pick<ProcessSnapshotter, 'available' | 'subscribe'>,
    private readonly hooks: LauncherHooks,
    /** Abre steam://… (shell.openExternal no app; injetado nos testes). */
    private readonly openUrl: (url: string) => Promise<void> = (url) => shell.openExternal(url),
  ) {}

  /** Como o jogo abre (emulador próprio, RetroArch ou o executável): também usado nos atalhos da Steam. */
  async launchSpecFor(game: Game): Promise<LaunchSpec> {
    return game.kind === 'retroarch'
      ? ((await this.emulators.launchSpec(game)) ?? (await this.retroarch.buildLaunch(game, this.settings.get().hardcoreMode)))
      : buildExecutableLaunch(game);
  }

  runningGameIds(): number[] {
    return [...this.sessions.keys()];
  }

  async launch(gameId: number): Promise<void> {
    const running = this.sessions.get(gameId);
    if (running) {
      // A Steam ainda não abriu o jogo (ex.: o pedido foi cancelado nela): pede de novo, na mesma sessão.
      if (running.steamWaitUntil !== null && running.game.steamAppId) return this.openSteam(running.game.steamAppId);
      throw new AppError('ALREADY_RUNNING', 'Este jogo já está em execução.');
    }
    const game = this.games.get(gameId);
    await assertFile(game.path, `Arquivo do jogo não encontrado: ${game.path}`);
    if (game.steamAppId) return this.launchViaSteam(game, game.steamAppId);

    const spec = await this.launchSpecFor(game);

    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      stdio: 'ignore',
      windowsHide: false,
      shell: false,
    });

    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', (err) =>
        reject(new AppError('LAUNCH_FAILED', `Não foi possível iniciar o jogo: ${err.message}`, { cause: err })),
      );
    });
    child.on('error', (err) => console.error(`[launcher] erro no processo de "${game.title}"`, err));

    const startedAt = Date.now();
    const sessionId = this.repo.startSession(game.id, new Date(startedAt).toISOString());
    // Heurística de pasta só para executáveis: o RetroArch fica fora da pasta das ROMs.
    const gameDir = game.kind === 'executable' ? path.dirname(game.path) : null;
    this.sessions.set(game.id, {
      child,
      sessionId,
      startedAt,
      game,
      tree: createTreeState(child.pid!, startedAt, gameDir),
      lastAliveAt: startedAt,
      rootExited: false,
      rootExitedAt: 0,
      graceTimer: null,
      steamWaitUntil: null,
    });
    this.unsubscribe ??= this.snapshots.subscribe((snapshot) => this.onSnapshot(snapshot));
    child.once('exit', () => this.onRootExit(game.id));
    this.hooks.onStarted(game);
  }

  private async openSteam(appId: number): Promise<void> {
    try {
      await this.openUrl(steamRunUrl(appId));
    } catch (err) {
      throw new AppError('LAUNCH_FAILED', 'Não foi possível abrir a Steam. Ela está instalada neste PC?', { cause: err });
    }
  }

  /**
   * Jogo da Steam: quem abre é a própria Steam (DRM, overlay e nuvem dela continuam valendo). A sessão
   * espera um processo da pasta do jogo aparecer e dura enquanto ele (ou um filho) estiver aberto.
   * Sem lista de processos não há como saber quando ele fecha: só abre, sem contar tempo.
   */
  private async launchViaSteam(game: Game, appId: number): Promise<void> {
    await this.openSteam(appId);
    if (!this.snapshots.available) return;

    const now = Date.now();
    const waitUntil = now + STEAM_START_TIMEOUT_MS;
    const tree = createTreeState(-1, now, steamGameDir(game.path));
    // Processos da pasta do jogo valem enquanto a espera durar (não há processo raiz do RetroVault).
    tree.rootExitedAt = waitUntil;
    const session: RunningSession = {
      child: null,
      sessionId: this.repo.startSession(game.id, new Date(now).toISOString()),
      startedAt: now,
      game,
      tree,
      lastAliveAt: now,
      rootExited: true,
      rootExitedAt: waitUntil,
      graceTimer: null,
      steamWaitUntil: waitUntil,
    };
    // Se os snapshots pararem durante a espera, a sessão não fica presa.
    session.graceTimer = setTimeout(() => this.finish(game.id, session.lastAliveAt), STEAM_START_TIMEOUT_MS + ROOT_EXIT_GRACE_MS);
    this.sessions.set(game.id, session);
    this.unsubscribe ??= this.snapshots.subscribe((snapshot) => this.onSnapshot(snapshot));
    this.hooks.onStarted(game);
  }

  private onSteamSnapshot(gameId: number, session: RunningSession, at: number, alive: Set<number>): void {
    if (alive.size > 0) {
      if (session.steamWaitUntil !== null) {
        session.steamWaitUntil = null;
        session.startedAt = at; // o tempo de jogo conta de quando o jogo abriu, não da espera pela Steam
      }
      session.lastAliveAt = Math.max(session.lastAliveAt, at);
      this.armGrace(gameId, session);
    } else if (session.steamWaitUntil === null) {
      this.finish(gameId, session.lastAliveAt); // fechou: termina no último instante visto aberto
    } else if (at >= session.steamWaitUntil) {
      this.finish(gameId, at); // a Steam não abriu o jogo: a sessão é descartada
    }
  }

  /** Fecha as sessões abertas (ex.: ao sair do app) sem matar os jogos. */
  closeAllSessions(): void {
    for (const gameId of [...this.sessions.keys()]) this.finish(gameId, Date.now());
  }

  private onRootExit(gameId: number): void {
    const session = this.sessions.get(gameId);
    if (!session) return;
    session.rootExited = true;
    session.rootExitedAt = session.lastAliveAt = session.tree.rootExitedAt = Date.now();
    if (!this.snapshots.available) {
      this.finish(gameId, session.lastAliveAt);
      return;
    }
    // Espera o próximo snapshot dizer se sobrou algum processo do jogo.
    this.armGrace(gameId, session);
  }

  /** Se os snapshots pararem de chegar, a sessão termina no último instante visto vivo. */
  private armGrace(gameId: number, session: RunningSession): void {
    if (session.graceTimer) clearTimeout(session.graceTimer);
    session.graceTimer = setTimeout(() => this.finish(gameId, session.lastAliveAt), ROOT_EXIT_GRACE_MS);
  }

  private onSnapshot({ at, processes }: ProcessSnapshot): void {
    for (const [gameId, session] of [...this.sessions]) {
      const alive = updateTree(session.tree, processes);
      if (!session.child) {
        this.onSteamSnapshot(gameId, session, at, alive);
        continue;
      }
      if (!session.rootExited) {
        session.lastAliveAt = Math.max(session.lastAliveAt, at);
        continue;
      }
      if (alive.size > 0 && this.snapshots.available) {
        session.lastAliveAt = Math.max(session.lastAliveAt, at);
        this.armGrace(gameId, session);
      } else if (at >= session.rootExitedAt || !this.snapshots.available) {
        // Só um snapshot iniciado depois do fechamento do launcher prova que o jogo não abriu outro processo.
        // Se algo sobreviveu ao launcher, o fim é este snapshot (≤ 2 s de atraso); senão, o fechamento do launcher.
        const outlivedRoot = session.lastAliveAt > session.rootExitedAt;
        this.finish(gameId, outlivedRoot && this.snapshots.available ? at : session.rootExitedAt);
      }
    }
  }

  private finish(gameId: number, endedAt: number): void {
    const session = this.sessions.get(gameId);
    if (!session) return;
    this.sessions.delete(gameId);
    if (session.graceTimer) clearTimeout(session.graceTimer);
    if (this.sessions.size === 0) {
      this.unsubscribe?.();
      this.unsubscribe = null;
    }
    // Jogo da Steam que nunca apareceu: não foi jogado (nem conta como "jogado por último").
    const neverStarted = session.steamWaitUntil !== null;
    const durationSeconds = neverStarted ? 0 : Math.max(0, Math.round((endedAt - session.startedAt) / 1000));
    try {
      if (neverStarted) this.repo.discardSession(session.sessionId);
      else this.repo.endSession(session.sessionId, gameId, new Date(endedAt).toISOString(), durationSeconds);
    } catch (err) {
      console.error('[launcher] falha ao registrar sessão', err);
    }
    this.hooks.onEnded(session.game, durationSeconds);
  }
}
