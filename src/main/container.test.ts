import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Game } from '@shared/types';
import { createContainer } from './container';
import { openDatabase } from './db/database';
import { useTempDir } from './testing/tempDir';

vi.mock('electron', () => ({ app: { getPath: () => '' }, nativeImage: {}, shell: {}, net: {} }));

describe('createContainer', () => {
  const tmp = useTempDir();

  /** Monta o app inteiro com banco em memória e pastas temporárias (nada do PC de verdade). */
  function build() {
    const dir = (name: string) => path.join(tmp(), name);
    const events: string[] = [];
    const container = createContainer({
      db: openDatabase(':memory:'),
      dbFile: dir('retrovault.db'),
      backupDir: dir('backups'),
      userDataDir: dir('userData'),
      appDataDir: dir('AppData'),
      documentsDir: dir('Documentos'),
      homeDir: dir('home'),
      localAppDataDir: dir('LocalAppData'),
      programDirs: [dir('Programas')],
      programDataDir: dir('ProgramData'),
      tempDir: dir('temp'),
      launcherExe: null,
      steamDirOverride: dir('Steam'),
      openExternal: async () => undefined,
      emit: (event) => void events.push(event),
      notify: () => undefined,
      trash: async () => undefined,
      runInstaller: async () => undefined,
      pickExecutable: async () => null,
      appUpdate: {
        currentVersion: '0.0.0-teste',
        releasesUrl: 'https://example.test',
        disabledReason: 'teste',
        createUpdater: () => {
          throw new Error('sem atualização do app nos testes');
        },
      },
    });
    return { container, events };
  }

  it('monta todos os serviços sem tocar em nada que ainda não foi criado', () => {
    const { container } = build();
    expect(container.games.list()).toEqual([]);
    expect(container.launcher.isRunning(1)).toBe(false);
  });

  it('a sessão de jogo chega aos serviços criados depois do launcher (troféus, Discord)', async () => {
    const { container, events } = build();
    const game = { id: 1, title: 'Jogo', kind: 'executable', path: 'C:\\nao-existe.exe', raGameId: null, launchArgs: null } as Game;
    const hooks = (container.launcher as unknown as { hooks: { onStarted(g: Game): void; onEnded(g: Game, s: number): void } }).hooks;
    hooks.onStarted(game);
    hooks.onEnded(game, 1);
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toEqual(expect.arrayContaining(['session:started', 'session:ended']));
  });
});
