import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { AppUpdateState } from '@shared/appUpdate';
import { AppUpdateService, friendlyError, type Updater } from './appUpdateService';

/** electron-updater falso: `check` decide o que o "GitHub" responde. */
class FakeUpdater extends EventEmitter implements Updater {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  installed: [boolean | undefined, boolean | undefined] | null = null;
  constructor(private readonly check: (u: FakeUpdater) => Promise<void>) {
    super();
  }
  async checkForUpdates(): Promise<unknown> {
    this.emit('checking-for-update');
    await this.check(this);
    return null;
  }
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    this.installed = [isSilent, isForceRunAfter];
  }
}

function setup(check: (u: FakeUpdater) => Promise<void>, opts: { disabled?: string; busy?: string | null } = {}) {
  const events: AppUpdateState[] = [];
  let updater: FakeUpdater | null = null;
  const createUpdater = vi.fn(() => (updater = new FakeUpdater(check)));
  const service = new AppUpdateService({
    currentVersion: '0.1.0',
    releasesUrl: 'https://github.com/eu/retrovault/releases',
    disabledReason: opts.disabled ?? null,
    createUpdater,
    emit: (s) => events.push(s),
    busyReason: () => opts.busy ?? null,
    now: () => 1000,
  });
  return { service, events, createUpdater, updater: () => updater! };
}

describe('AppUpdateService', () => {
  it('versão nova: baixa sozinho, mostra o progresso e fica pronta; instalar reinicia sem perguntas', async () => {
    const { service, events, updater } = setup(async (u) => {
      u.emit('update-available', { version: '0.2.0' });
      u.emit('download-progress', { percent: 41.7 });
      u.emit('download-progress', { percent: 41.9 }); // mesmo ponto: não repassa
      u.emit('update-downloaded', { version: '0.2.0' });
    });
    const state = await service.check();
    expect(state).toMatchObject({ current: '0.1.0', phase: 'ready', version: '0.2.0', percent: 100 });
    expect(events.map((e) => `${e.phase}:${e.percent ?? ''}`)).toEqual(['checking:', 'downloading:0', 'downloading:41', 'ready:100']);
    expect(updater().autoDownload).toBe(true);
    expect(updater().autoInstallOnAppQuit).toBe(true);
    service.install();
    expect(updater().installed).toEqual([true, true]);
  });

  it('sem versão nova: em dia, com a hora da conferência; buscar de novo funciona', async () => {
    const { service, createUpdater } = setup(async (u) => void u.emit('update-not-available', { version: '0.1.0' }));
    expect(await service.check()).toMatchObject({ phase: 'up-to-date', checkedAt: 1000 });
    expect(await service.check()).toMatchObject({ phase: 'up-to-date' });
    expect(createUpdater).toHaveBeenCalledTimes(1); // o electron-updater é criado uma vez só
  });

  it('desligado (pasta win-unpacked / modo dev): nunca carrega o electron-updater', async () => {
    const { service, createUpdater } = setup(async () => {}, { disabled: 'Esta cópia não veio do instalador.' });
    expect(await service.check()).toMatchObject({ phase: 'disabled', message: 'Esta cópia não veio do instalador.' });
    expect(createUpdater).not.toHaveBeenCalled();
    expect(() => service.install()).toThrow(/Nenhuma atualização pronta/);
  });

  it('erro de rede vira mensagem curta e não derruba nada', async () => {
    const { service } = setup(async () => {
      throw new Error('net::ERR_INTERNET_DISCONNECTED at https://github.com/... (resposta enorme)');
    });
    expect(await service.check()).toMatchObject({ phase: 'error', message: expect.stringMatching(/Sem conexão com o GitHub/) });
  });

  it('não reinicia no meio da instalação de um port', async () => {
    const { service, updater } = setup(async (u) => void u.emit('update-downloaded', { version: '0.2.0' }), { busy: 'Espere o port terminar de instalar.' });
    await service.check();
    expect(() => service.install()).toThrow(/Espere o port/);
    expect(updater().installed).toBeNull();
  });

  it('buscas ao mesmo tempo usam a mesma consulta; com a versão já baixada, não procura de novo', async () => {
    let calls = 0;
    const { service } = setup(async (u) => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      u.emit('update-downloaded', { version: '0.2.0' });
    });
    await Promise.all([service.check(), service.check(), service.check()]);
    await service.check();
    expect(calls).toBe(1);
  });

  it('mensagens amigáveis para os erros comuns', () => {
    expect(friendlyError(new Error('Cannot find latest.yml in the latest release artifacts'))).toMatch(/latest\.yml/);
    expect(friendlyError(new Error('sha512 checksum mismatch'))).toMatch(/não bate/);
    expect(friendlyError(new Error('algo\nsegunda linha'))).toBe('algo');
  });
});
