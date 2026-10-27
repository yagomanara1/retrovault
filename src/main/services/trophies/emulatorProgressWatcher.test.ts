import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmulatorProgressWatcher } from './emulatorProgressWatcher';

const INTERVAL = 3000;

/** Observador com um TROPUSR.DAT de mentira: `mtimes` diz a data de modificação a cada conferência. */
function setup(opts: { emulator?: boolean; mtimes?: number[] } = {}) {
  const synced: number[] = [];
  const mtimes = [...(opts.mtimes ?? [])];
  const watcher = new EmulatorProgressWatcher({
    progressPath: (gameId) => (opts.emulator === false ? null : `C:\\rpcs3\\${gameId}\\TROPUSR.DAT`),
    sync: async (gameId) => {
      synced.push(gameId);
    },
    mtime: async () => mtimes.shift() ?? 0,
    intervalMs: INTERVAL,
  });
  return { watcher, synced };
}

describe('EmulatorProgressWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('relê o progresso só quando o arquivo muda', async () => {
    const { watcher, synced } = setup({ mtimes: [10, 10, 20] });
    watcher.watch(1);
    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(synced).toEqual([1, 1]);
  });

  it('arquivo que ainda não existe não dispara leitura', async () => {
    const { watcher, synced } = setup({ mtimes: [0, 0] });
    watcher.watch(1);
    await vi.advanceTimersByTimeAsync(INTERVAL * 2);
    expect(synced).toEqual([]);
  });

  it('o mesmo jogo não ganha dois observadores', async () => {
    const { watcher, synced } = setup({ mtimes: [10] });
    watcher.watch(1);
    watcher.watch(1);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(synced).toEqual([1]);
  });

  it('jogo sem lista de emulador não é observado', async () => {
    const { watcher, synced } = setup({ emulator: false, mtimes: [10] });
    watcher.watch(1);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(synced).toEqual([]);
  });

  it('ao fechar o jogo: para de conferir e faz a última leitura', async () => {
    const { watcher, synced } = setup({ mtimes: [10, 20, 30] });
    watcher.watch(1);
    await watcher.stop(1);
    expect(synced).toEqual([1]);
    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(synced).toEqual([1]);
  });

  it('falha na leitura não derruba o observador', async () => {
    let calls = 0;
    const watcher = new EmulatorProgressWatcher({
      progressPath: () => 'x',
      sync: async () => {
        calls++;
        throw new Error('TROPUSR.DAT travado');
      },
      mtime: async () => calls + 1,
      intervalMs: INTERVAL,
    });
    watcher.watch(1);
    await vi.advanceTimersByTimeAsync(INTERVAL * 2);
    expect(calls).toBe(2);
    await expect(watcher.stop(1)).resolves.toBeUndefined();
  });
});
