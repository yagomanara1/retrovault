import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Game } from '@shared/types';
import { makeTree, useTempDir } from '../testing/tempDir';
import { LauncherService, STEAM_START_TIMEOUT_MS } from './launcherService';
import type { ProcessInfo, ProcessSnapshot } from './processTree';

vi.mock('electron', () => ({ shell: {} }));

/** Jogo da Steam aberto pela URL; a sessão segue o processo que aparece na pasta do jogo. */
describe('LauncherService — jogos da Steam', () => {
  const tmp = useTempDir();
  let listener: ((s: ProcessSnapshot) => void) | null;
  let opened: string[];
  let repo: { startSession: ReturnType<typeof vi.fn>; endSession: ReturnType<typeof vi.fn>; discardSession: ReturnType<typeof vi.fn> };
  let ended: [string, number][];
  let gameDir: string;
  let exe: string;

  beforeEach(async () => {
    // Relógio parado: os instantes dos snapshots não dependem de quanto a abertura levou de verdade.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: new Date('2026-10-25T12:00:00Z') });
    gameDir = path.join(tmp(), 'Steam', 'steamapps', 'common', 'Jogo');
    exe = path.join(gameDir, 'bin', 'win64', 'jogo.exe');
    await makeTree(tmp(), { [path.relative(tmp(), exe)]: 'x' });
    listener = null;
    opened = [];
    ended = [];
    repo = { startSession: vi.fn(() => 7), endSession: vi.fn(), discardSession: vi.fn() };
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function launcher(available = true) {
    const game = { id: 1, title: 'Jogo', kind: 'executable', path: exe, steamAppId: 730, launchArgs: null } as Game;
    return new LauncherService(
      repo as never,
      { get: () => game } as never,
      {} as never,
      { launchSpec: async () => null },
      {} as never,
      {
        available,
        subscribe: (l) => {
          listener = l;
          return () => (listener = null);
        },
      },
      { onStarted: () => undefined, onEnded: (g, s) => ended.push([g.title, s]) },
      async (url) => {
        opened.push(url);
      },
    );
  }

  const proc = (pid: number, exePath: string, createdAt: number): ProcessInfo => ({ pid, ppid: 4, createdAt, exe: exePath });

  it('abre pela URL, espera o jogo aparecer e conta só o tempo com ele aberto', async () => {
    const l = launcher();
    const t0 = Date.now();
    await l.launch(1);
    expect(opened).toEqual(['steam://rungameid/730']);
    expect(l.runningGameIds()).toEqual([1]);

    // A Steam ainda está abrindo: nada na pasta do jogo.
    listener!({ at: t0 + 2_000, processes: [proc(50, 'C:\\Steam\\steam.exe', t0 - 99_999)] });
    expect(l.runningGameIds()).toEqual([1]);
    // Pedir de novo enquanto espera: a Steam recebe o pedido outra vez, sem outra sessão.
    await l.launch(1);
    expect(opened).toHaveLength(2);
    expect(repo.startSession).toHaveBeenCalledTimes(1);

    // O jogo (filho da Steam, não do RetroVault) aparece aos 30 s e fica aberto até os 90 s.
    listener!({ at: t0 + 30_000, processes: [proc(60, exe, t0 + 29_000)] });
    listener!({ at: t0 + 90_000, processes: [proc(60, exe, t0 + 29_000)] });
    await expect(l.launch(1)).rejects.toMatchObject({ code: 'ALREADY_RUNNING' });
    listener!({ at: t0 + 92_000, processes: [] });

    expect(l.runningGameIds()).toEqual([]);
    expect(repo.endSession).toHaveBeenCalledWith(7, 1, new Date(t0 + 90_000).toISOString(), 60);
    expect(repo.discardSession).not.toHaveBeenCalled();
    expect(ended).toEqual([['Jogo', 60]]);
  });

  it('processo de outra pasta não conta; se o jogo não aparecer na espera, a sessão é descartada', async () => {
    const l = launcher();
    const t0 = Date.now();
    await l.launch(1);
    listener!({ at: t0 + 10_000, processes: [proc(70, path.join(path.dirname(gameDir), 'Outro', 'outro.exe'), t0 + 9_000)] });
    expect(l.runningGameIds()).toEqual([1]);
    listener!({ at: t0 + STEAM_START_TIMEOUT_MS + 1, processes: [] });

    expect(l.runningGameIds()).toEqual([]);
    expect(repo.discardSession).toHaveBeenCalledWith(7);
    expect(repo.endSession).not.toHaveBeenCalled();
    expect(ended).toEqual([['Jogo', 0]]);
  });

  it('sem lista de processos: só abre pela Steam, sem sessão', async () => {
    const l = launcher(false);
    await l.launch(1);
    expect(opened).toEqual(['steam://rungameid/730']);
    expect(l.runningGameIds()).toEqual([]);
    expect(repo.startSession).not.toHaveBeenCalled();
  });

  it('Steam ausente (URL sem programa): erro claro, sem sessão', async () => {
    const game = { id: 1, title: 'Jogo', kind: 'executable', path: exe, steamAppId: 730 } as Game;
    const l = new LauncherService(repo as never, { get: () => game } as never, {} as never, { launchSpec: async () => null }, {} as never, { available: true, subscribe: () => () => undefined }, { onStarted: () => undefined, onEnded: () => undefined }, async () => {
      throw new Error('no handler');
    });
    await expect(l.launch(1)).rejects.toMatchObject({ code: 'LAUNCH_FAILED' });
    expect(repo.startSession).not.toHaveBeenCalled();
  });
});
