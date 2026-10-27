// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RetroArchStatus, Settings } from '@shared/types';
import { ToastProvider } from '@/components/ui/Toast';
import { SettingsPage } from './SettingsPage';

afterEach(cleanup);

const SETTINGS: Settings = {
  retroarchPath: null,
  raUsername: 'Ana',
  hasApiKey: true,
  hardcoreMode: false,
  notifyAchievements: true,
  hasTrophyKey: false,
  savesRoot: 'D:\\OneDrive\\RetroVault\\Saves',
  autoBackupSaves: true,
  githubLogin: null,
  hasSgdbKey: false,
  storeCatalogUrl: null,
  notifyPortUpdates: true,
  discordPresence: false,
};
const RETROARCH: RetroArchStatus = { found: true, exePath: 'C:\\RetroArch\\retroarch.exe', configPath: null, cheevosEnabled: true, loggedInAs: 'outra_conta', cores: [] };

let invoke: ReturnType<typeof vi.fn>;
/** Página no endereço `?secao=…`, com a API do main de mentira (o que ela não conhece vira erro). */
function setup(section: string | null, settings: Partial<Settings> = {}) {
  const current = { ...SETTINGS, ...settings };
  invoke = vi.fn(async (channel: string, input: unknown) => {
    if (channel === 'settings:get') return { ok: true, data: current };
    if (channel === 'settings:update') return { ok: true, data: { ...current, ...(input as object) } };
    if (channel === 'retroarch:status') return { ok: true, data: RETROARCH };
    if (channel === 'ra:profile') return { ok: true, data: { username: 'Ana', totalPoints: 1234 } };
    return { ok: false, error: { code: 'INTERNAL', message: channel } };
  });
  (window as unknown as { bridge: unknown }).bridge = { invoke, on: () => () => undefined };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[section ? `/?secao=${section}` : '/']}>
          <SettingsPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const updates = () => invoke.mock.calls.filter(([channel]) => channel === 'settings:update').map(([, input]) => input);

describe('SettingsPage', () => {
  beforeEach(() => {
    window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as never;
  });

  it('seção desconhecida no endereço abre a conta; a lista resume cada seção', async () => {
    setup('nao-existe');
    expect(await screen.findByRole('heading', { name: 'Conta do RetroAchievements' })).toBeTruthy();
    expect(screen.getByText('Conectado como Ana')).toBeTruthy();
    expect(screen.getByText('Sem trophy key')).toBeTruthy();
    expect(screen.getByText('Hardcore desligado · notificações ligadas')).toBeTruthy();
    expect(screen.getByText('Backup automático ligado')).toBeTruthy();
  });

  describe('conta do RetroAchievements', () => {
    it('sem usuário ou sem chave (nenhuma salva), avisa e não salva', async () => {
      setup('conta', { raUsername: null, hasApiKey: false });
      const save = await screen.findByRole('button', { name: 'Salvar e testar conexão' });
      await userEvent.click(save);
      expect(screen.getByRole('alert').textContent).toBe('Informe seu usuário do RetroAchievements.');
      await userEvent.type(screen.getByLabelText('Usuário'), 'Ana');
      await userEvent.click(save);
      expect(screen.getByRole('alert').textContent).toBe('Informe sua Web API Key.');
      expect(updates()).toEqual([]);
    });

    it('salva usuário e chave aparados, testa a conexão e mostra os pontos', async () => {
      setup('conta', { raUsername: null, hasApiKey: false });
      await userEvent.type(await screen.findByLabelText('Usuário'), '  Ana ');
      await userEvent.type(screen.getByLabelText(/Web API Key/), ' chave123 ');
      await userEvent.click(screen.getByRole('button', { name: 'Salvar e testar conexão' }));
      // Só o aviso de sucesso mostra os pontos do perfil.
      expect(await screen.findByText(/1\.234 pontos no RetroAchievements/)).toBeTruthy();
      expect(updates()).toEqual([{ raUsername: 'Ana', raApiKey: 'chave123' }]);
      expect(invoke).toHaveBeenCalledWith('ra:profile', { force: true });
    });

    it('com a chave já salva, mudar só o usuário não apaga a chave', async () => {
      setup('conta');
      const user = await screen.findByLabelText('Usuário');
      await userEvent.clear(user);
      await userEvent.type(user, 'Bia');
      await userEvent.click(screen.getByRole('button', { name: 'Salvar e testar conexão' }));
      await waitFor(() => expect(updates()).toEqual([{ raUsername: 'Bia' }]));
    });
  });

  describe('troféus de PS4', () => {
    it('chave que não tem 32 caracteres hexadecimais é recusada', async () => {
      setup('trofeus');
      await userEvent.type(await screen.findByLabelText('Trophy key'), 'xyz');
      await userEvent.click(screen.getByRole('button', { name: 'Salvar chave' }));
      expect(await screen.findByText('A trophy key tem 32 caracteres hexadecimais (0–9, A–F).')).toBeTruthy();
      expect(updates()).toEqual([]);
    });

    it('espaços colados junto são tirados e a chave é salva', async () => {
      setup('trofeus');
      await userEvent.type(await screen.findByLabelText('Trophy key'), '0123 4567 89ab cdef 0123 4567 89AB CDEF');
      await userEvent.click(screen.getByRole('button', { name: 'Salvar chave' }));
      await waitFor(() => expect(updates()).toEqual([{ trophyKey: '0123456789abcdef0123456789ABCDEF' }]));
      expect(await screen.findByText('Trophy key salva')).toBeTruthy();
    });
  });

  it('RetroArch logado com outra conta: avisa para onde vão os desbloqueios', async () => {
    setup('retroarch');
    expect(await screen.findByText(/A conta logada no RetroArch \(outra_conta\) é diferente da configurada aqui \(Ana\)/)).toBeTruthy();
    expect(screen.getByText('Nenhum core instalado. No RetroArch: Menu principal → Online Updater → Core Downloader.')).toBeTruthy();
  });

  it('preferências: cada chave grava só o próprio campo', async () => {
    setup('preferencias');
    await userEvent.click(await screen.findByRole('switch', { name: 'Modo Hardcore' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Mostrar no Discord o que estou jogando' }));
    await waitFor(() => expect(updates()).toEqual([{ hardcoreMode: true }, { discordPresence: true }]));
  });

  it('cofre de saves: mostra a pasta e desliga o backup automático', async () => {
    setup('saves');
    expect(await screen.findByText('D:\\OneDrive\\RetroVault\\Saves')).toBeTruthy();
    await userEvent.click(screen.getByRole('switch', { name: 'Backup automático dos saves' }));
    await waitFor(() => expect(updates()).toEqual([{ autoBackupSaves: false }]));
  });
});
