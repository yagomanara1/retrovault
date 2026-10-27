// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SteamShortcutsOverview } from '@shared/types';
import { ToastProvider } from '../ui/Toast';
import { SteamSection } from './SteamSection';

afterEach(cleanup);

function overview(over: Partial<SteamShortcutsOverview> = {}): SteamShortcutsOverview {
  return {
    steamFound: true,
    steamRunning: false,
    accounts: [{ id: '111', name: 'Jogador', mostRecent: true }],
    accountId: '111',
    games: [
      { gameId: 1, title: 'Hollow Knight', inSteam: true, blocked: null },
      { gameId: 2, title: 'Celeste', inSteam: false, blocked: null },
      { gameId: 3, title: 'Counter-Strike 2', inSteam: false, blocked: 'Já é um jogo da Steam' },
    ],
    launcherInSteam: false,
    launcherAvailable: true,
    otherShortcuts: 1,
    ...over,
  };
}

let invoke: ReturnType<typeof vi.fn>;
function setup(data: SteamShortcutsOverview) {
  invoke = vi.fn(async (channel: string) => {
    if (channel === 'steam:shortcuts') return { ok: true, data };
    if (channel === 'steam:shortcuts-apply') return { ok: true, data: { added: 1, updated: 1, removed: 0, skipped: [], backupPath: null } };
    return { ok: false, error: { code: 'INTERNAL', message: channel } };
  });
  (window as unknown as { bridge: unknown }).bridge = { invoke, on: () => () => undefined };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <SteamSection />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('SteamSection', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('marca o que já está na Steam, pede confirmação com o resumo e envia exatamente a lista marcada', async () => {
    setup(overview());
    const celeste = await screen.findByRole('checkbox', { name: 'Celeste' });
    expect((screen.getByRole('checkbox', { name: 'Hollow Knight' }) as HTMLInputElement).checked).toBe(true);
    expect((celeste as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('checkbox', { name: 'Counter-Strike 2' }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('Já é um jogo da Steam')).toBeTruthy();

    await userEvent.click(celeste);
    await userEvent.click(screen.getByRole('button', { name: 'Salvar na Steam' }));
    // Primeiro clique só mostra o resumo; nada é gravado ainda.
    expect(screen.getByText(/Adicionar 1, manter\/atualizar 1, remover 0/)).toBeTruthy();
    expect(invoke.mock.calls.some(([ch]) => ch === 'steam:shortcuts-apply')).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('steam:shortcuts-apply', { accountId: '111', gameIds: [1, 2], includeLauncher: false }));
  });

  it('mudar a seleção depois do primeiro clique cancela a confirmação', async () => {
    setup(overview());
    await userEvent.click(await screen.findByRole('button', { name: 'Salvar na Steam' }));
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeTruthy();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Celeste' }));
    expect(screen.queryByRole('button', { name: 'Confirmar' })).toBeNull();
  });

  it('Steam aberta: salvar fica bloqueado e aparece o botão para fechá-la', async () => {
    setup(overview({ steamRunning: true }));
    expect(((await screen.findByRole('button', { name: 'Salvar na Steam' })) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Fechar a Steam' })).toBeTruthy();
  });

  it('sem Steam no PC: avisa e não mostra a lista', async () => {
    setup(overview({ steamFound: false, accounts: [], accountId: null, games: [] }));
    expect(await screen.findByText('A Steam não foi encontrada neste PC.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Salvar na Steam' })).toBeNull();
  });
});
