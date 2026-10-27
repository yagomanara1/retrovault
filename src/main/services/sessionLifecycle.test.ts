import { describe, expect, it } from 'vitest';
import type { Game } from '@shared/types';
import { SessionLifecycle, type SessionLifecycleDeps } from './sessionLifecycle';

const rom = { id: 1, title: 'Mario', kind: 'retroarch', raGameId: null } as Game;
const linkedExe = { id: 2, title: 'Port', kind: 'executable', raGameId: 77 } as Game;
const plainExe = { id: 3, title: 'Bloodborne', kind: 'executable', raGameId: null } as Game;

/** Anota cada efeito, na ordem, como "serviço:ação:id". */
function setup(autoBackup = true) {
  const log: string[] = [];
  const events: unknown[] = [];
  const deps: SessionLifecycleDeps = {
    emit: (event, payload) => events.push([event, payload]),
    achievements: {
      start: async (id) => void log.push(`ra:start:${id}`),
      stop: (id) => void log.push(`ra:stop:${id}`),
    },
    trophies: {
      watchEmulatorProgress: (id) => void log.push(`troféus:observar:${id}`),
      stopWatchingEmulatorProgress: async (id) => void log.push(`troféus:parar:${id}`),
      queueAutoImport: async (id) => void log.push(`troféus:importar:${id}`),
    },
    discord: {
      gameStarted: (g) => void log.push(`discord:abriu:${g.id}`),
      gameEnded: (g) => void log.push(`discord:fechou:${g.id}`),
    },
    invalidateRaUserData: (ids) => void log.push(`ra:cache:${ids.join(',')}`),
    autoBackupSaves: () => autoBackup,
    backupSave: (id, reason) => void log.push(`save:${reason}:${id}`),
    exportProgress: () => void log.push('progresso:exportar'),
  };
  return { lifecycle: new SessionLifecycle(deps), log, events };
}

describe('SessionLifecycle', () => {
  it('ao abrir: avisa a tela, observa troféus do emulador e mostra no Discord', () => {
    const { lifecycle, log, events } = setup();
    lifecycle.onStarted(plainExe);
    expect(events).toEqual([['session:started', { gameId: 3 }]]);
    expect(log).toEqual(['troféus:observar:3', 'discord:abriu:3']);
  });

  it('conquistas do RA só para ROM do RetroArch ou jogo vinculado', () => {
    const { lifecycle, log } = setup();
    lifecycle.onStarted(rom);
    lifecycle.onStarted(linkedExe);
    expect(log.filter((l) => l.startsWith('ra:start'))).toEqual(['ra:start:1', 'ra:start:2']);
  });

  it('ao fechar: para tudo, renova o cache do RA, guarda o save e exporta o progresso', async () => {
    const { lifecycle, log, events } = setup();
    lifecycle.onEnded(linkedExe, 600);
    await new Promise((r) => setTimeout(r, 0));
    expect(events).toEqual([['session:ended', { gameId: 2, durationSeconds: 600 }]]);
    expect(log).toEqual([
      'discord:fechou:2',
      'troféus:parar:2',
      'ra:stop:2',
      'ra:cache:77',
      'save:session:2',
      'progresso:exportar',
      // A lista de troféus pode ter surgido nesta primeira execução: importa depois da última leitura.
      'troféus:importar:2',
    ]);
  });

  it('sem backup automático, o save não é guardado; jogo sem RA renova o cache sem ids', async () => {
    const { lifecycle, log } = setup(false);
    lifecycle.onEnded(plainExe, 5);
    await new Promise((r) => setTimeout(r, 0));
    expect(log).not.toContain('save:session:3');
    expect(log).toContain('ra:cache:');
    expect(log).toContain('progresso:exportar');
  });
});
