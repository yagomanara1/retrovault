import { describe, expect, it, vi } from 'vitest';
import type { Game } from '@shared/types';
import type { StorePort } from '@shared/store';
import { MaintenanceService, RECENT_ARTWORK_MS, type MaintenanceDeps } from './maintenanceService';
import { PortLifecycleService, type PortLifecycleDeps } from './store/portLifecycleService';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('MaintenanceService', () => {
  function setup() {
    const calls: string[] = [];
    const log = <T = void,>(name: string, value?: T) => async (): Promise<T> => (calls.push(name), value as T);
    const changed: number[] = [];
    const deps: MaintenanceDeps = {
      games: {
        applyDumpArtwork: vi.fn(async () => (calls.push('dump'), null)),
        applyDumpArtworkToLibrary: vi.fn(async () => (calls.push('dumpLibrary'), [{ id: 7 } as Game])),
        upgradeLegacyIcons: vi.fn(log('icons', 0)),
        referencedArtwork: () => ['rv-media://artwork/a.png'],
        list: () => [{ id: 1 } as Game, { id: 2 } as Game],
      },
      trophies: {
        queueAutoImport: vi.fn(log('trophies')),
        referencedArtwork: () => ['rv-media://artwork/t.png'],
        scanLibrary: vi.fn(log('scanTrophies')),
        syncAllEmulatorSets: vi.fn(log('emulatorTrophies')),
      },
      categories: { assignNewGame: vi.fn(async () => true) },
      artwork: { collectGarbage: vi.fn(async (refs: Iterable<string | null>, opts?: { minAgeMs?: number }) => void calls.push(`gc:${[...refs].length}:${opts?.minAgeMs}`)) },
      otherArtwork: async () => ['rv-media://artwork/backup.png', null],
      steamData: vi.fn(async () => ({ id: 1 }) as Game),
      autoFillArt: vi.fn(async () => null),
      ports: { categorizeLibrary: vi.fn(log('ports')) },
      cleanupLeftovers: vi.fn(log('leftovers')),
      repairLibrary: vi.fn(log('repair')),
      backupSaves: vi.fn(log('saves')),
      autoBackupSaves: () => true,
      isRunning: (id) => id === 2,
      backupSave: vi.fn(),
      onGameChanged: (id) => changed.push(id),
    };
    return { service: new MaintenanceService(deps), deps, calls, changed };
  }

  it('inicialização na ordem certa: arte primeiro (limpeza poupa o recente), caminhos, troféus, saves', async () => {
    const { service, calls, changed } = setup();
    await service.startup();
    expect(calls).toEqual(['icons', `gc:4:${RECENT_ARTWORK_MS}`, 'ports', 'leftovers', 'repair', 'dumpLibrary', 'scanTrophies', 'emulatorTrophies', 'saves']);
    expect(changed).toEqual([7]);
  });

  it('jogo da Loja não busca capa no SteamGridDB; jogo da biblioteca busca', async () => {
    const store = setup();
    store.service.gameAdded(5, 'store');
    await flush();
    await flush();
    expect(store.deps.autoFillArt).not.toHaveBeenCalled();
    expect(store.deps.steamData).toHaveBeenCalledWith(5);
    expect(store.deps.categories.assignNewGame).toHaveBeenCalledWith(5);

    const library = setup();
    library.service.gameAdded(6);
    await flush();
    await flush();
    expect(library.deps.autoFillArt).toHaveBeenCalledWith(6);
  });

  it('falha da Steam não impede o resto da arte', async () => {
    const { service, deps } = setup();
    vi.mocked(deps.steamData).mockRejectedValueOnce(new Error('sem steam'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    service.gameAdded(3);
    await flush();
    await flush();
    expect(deps.autoFillArt).toHaveBeenCalledWith(3);
    warn.mockRestore();
  });

  it('backup periódico pula o jogo aberto', () => {
    const { service, deps } = setup();
    service.periodicSaveBackup();
    expect(vi.mocked(deps.backupSave).mock.calls).toEqual([[1, 'auto']]);
  });
});

describe('PortLifecycleService', () => {
  function setup(updates: Record<string, { tag: string }>) {
    const store = new Map<string, unknown>();
    const notifications: string[] = [];
    const counts: number[] = [];
    const port = (id: string) => ({ id, name: `Port ${id}`, original: { title: 'x', platform: 'n64' } }) as StorePort;
    const deps: PortLifecycleDeps = {
      installs: { gameFor: (id) => (id === 'a' ? 10 : null), list: () => Object.keys(updates).map((portId) => ({ portId })).concat([{ portId: 'z' }]) },
      catalog: { port: async (id) => port(id) },
      art: { art: async () => ({ cover: 'rv-media://artwork/c.png', hero: null, logo: null, source: 'project' }) as never },
      games: { applyArtworkIfMissing: vi.fn(() => true) },
      categories: { assignPortGame: vi.fn(() => true) },
      roms: { reapply: vi.fn(async () => true) },
      updates: async () => updates,
      notified: { peek: <T,>(k: string) => (store.get(k) as T) ?? null, set: (k, v) => void store.set(k, v) },
      notifyPortUpdates: () => true,
      onGameChanged: vi.fn(),
      onUpdatesChanged: (n) => counts.push(n),
      notify: (title) => notifications.push(title),
    };
    return { service: new PortLifecycleService(deps), deps, notifications, counts };
  }

  it('avisa uma vez por versão nova; a tela recebe a contagem sempre', async () => {
    const { service, notifications, counts } = setup({ a: { tag: 'v2' }, b: { tag: 'v5' } });
    await service.checkUpdates();
    await service.checkUpdates();
    expect(notifications).toEqual(['2 ports com atualização']);
    expect(counts).toEqual([2, 2]);
  });

  it('port instalado: ROM, arte e categoria do jogo dele', async () => {
    const { service, deps } = setup({});
    await service.afterInstall('a');
    expect(deps.roms.reapply).toHaveBeenCalledWith('a');
    expect(deps.games.applyArtworkIfMissing).toHaveBeenCalledWith(10, { cover: 'rv-media://artwork/c.png', background: null });
    expect(deps.categories.assignPortGame).toHaveBeenCalledWith(10, { title: 'x', platform: 'n64' });
    expect(deps.onGameChanged).toHaveBeenCalledWith(10);
  });
});
