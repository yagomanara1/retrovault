import { describe, expect, it, vi } from 'vitest';
import { INVOKE_CHANNELS } from '@shared/ipc';

const registered: string[] = [];
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string) => void registered.push(channel) },
  app: {},
  BrowserWindow: {},
  dialog: {},
  shell: {},
}));

describe('registerIpc', () => {
  it('todo canal da lista permitida tem exatamente um handler, e não há handler fora da lista', async () => {
    const { registerIpc } = await import('./ipc');
    registerIpc({} as never);
    const allowed = [...INVOKE_CHANNELS].sort();
    expect([...registered].sort()).toEqual(allowed);
    expect(new Set(registered).size).toBe(registered.length);
  });
});
