// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoreInstall, StorePort, StoreRelease } from '@shared/store';
import { ToastProvider } from '@/components/ui/Toast';
import { StorePage } from './StorePage';

afterEach(cleanup);

const port = (id: string, name: string, title: string, over: Partial<StorePort> = {}): StorePort => ({
  id,
  name,
  original: { title, platform: 'n64' },
  developer: 'HarbourMasters',
  summary: `Resumo de ${name}`,
  description: '',
  tags: [],
  source: { type: 'github', repo: `harbour/${id}` },
  assets: { windows: 'Win.*\\.zip$' },
  executable: `${id}.exe`,
  requires: { kind: 'rom', label: 'ROM do jogo' },
  ...over,
});
const PORTS = [
  port('soh', 'Ship of Harkinian', 'The Legend of Zelda: Ocarina of Time', { tags: ['Zelda'] }),
  port('mm', '2 Ship 2 Harkinian', "The Legend of Zelda: Majora's Mask"),
  port('kart', 'Spaghettify Kart', 'Mario Kart 64', { developer: 'Você', custom: true }),
];
const version = (tag: string) => ({ kind: 'archive' as const, tag, assetName: `soh-${tag}.zip`, sha256: `sha-${tag}`, verified: true, installDir: `C:\\Ports\\soh\\${tag}`, exePath: `C:\\Ports\\soh\\${tag}\\soh.exe`, sizeBytes: 1, installedAt: '2026-10-01T00:00:00Z' });
const INSTALLED: StoreInstall = { ...version('v2'), portId: 'soh', gameId: 7, previous: version('v1') };
const release = (tag: string, over: Partial<StoreRelease> = {}): StoreRelease => ({
  tag,
  name: tag,
  publishedAt: '2026-09-01T00:00:00Z',
  prerelease: false,
  notes: '',
  htmlUrl: '',
  windowsAsset: { name: `soh-${tag}.zip`, size: 2048, downloadUrl: `https://github.com/harbour/soh/releases/download/${tag}/soh.zip`, sha256: `sha-${tag}` },
  ...over,
});
const RELEASES = [release('v4-beta', { prerelease: true }), release('v3'), release('v2'), release('v1'), release('v0', { windowsAsset: null })];

type Reply = { ok: true; data: unknown } | { ok: false; error: { code: string; message: string } };
let invoke: ReturnType<typeof vi.fn>;
function setup(url: string, overrides: Record<string, Reply> = {}) {
  const replies: Record<string, Reply> = {
    'store:catalog': { ok: true, data: { ports: PORTS, source: 'embedded' } },
    'store:installs': { ok: true, data: { installs: [INSTALLED], installing: [] } },
    'store:updates': { ok: true, data: { mm: { tag: 'v9', name: 'v9', sizeBytes: 1 } } },
    'store:releases': { ok: true, data: RELEASES },
    'games:running': { ok: true, data: [] },
    'settings:get': { ok: true, data: { githubLogin: null } },
    ...overrides,
  };
  invoke = vi.fn(async (channel: string) => replies[channel] ?? { ok: false, error: { code: 'INTERNAL', message: channel } });
  (window as unknown as { bridge: unknown }).bridge = { invoke, on: () => () => undefined };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[url]}>
          <StorePage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const list = () => screen.getByRole('tablist', { name: 'Ports disponíveis' });
const listed = () => within(list()).getAllByRole('tab').map((t) => t.textContent);

describe('StorePage', () => {
  it('lista os ports com as etiquetas: atualização, instalado e "Seu"', async () => {
    setup('/');
    await screen.findByRole('tablist', { name: 'Ports disponíveis' });
    const [soh, mm, kart] = within(list()).getAllByRole('tab');
    expect(soh!.textContent).toContain('Instalado');
    expect(mm!.textContent).toContain('Atualização');
    expect(kart!.textContent).toContain('Seu');
    expect(screen.getByText(/Catálogo embutido no app · 3 ports/)).toBeTruthy();
  });

  it('busca sem acento nem pontuação, por jogo, port, equipe ou etiqueta', async () => {
    setup('/');
    const search = await screen.findByLabelText('Buscar port');
    await userEvent.type(search, 'majoras');
    await waitFor(() => expect(listed()).toEqual([expect.stringContaining('2 Ship 2 Harkinian')]));
    await userEvent.clear(search);
    await userEvent.type(search, 'zelda ocarina');
    await waitFor(() => expect(listed()).toEqual([expect.stringContaining('Ship of Harkinian')]));
    await userEvent.clear(search);
    // Palavras grudadas também acham: "2ship2" → "2 Ship 2 Harkinian".
    await userEvent.type(search, '2ship2');
    await waitFor(() => expect(listed()).toEqual([expect.stringContaining('2 Ship 2 Harkinian')]));
    await userEvent.clear(search);
    await userEvent.type(search, 'VOCÊ');
    await waitFor(() => expect(listed()).toEqual([expect.stringContaining('Spaghettify Kart')]));
    await userEvent.clear(search);
    await userEvent.type(search, 'sonic');
    expect(await screen.findByText('Nada corresponde a “sonic”.')).toBeTruthy();
  });

  it('versões: a mais recente é a estável; cada uma diz o que dá para fazer', async () => {
    setup('/?port=soh');
    // As versões só são buscadas quando a seleção para (400 ms): procura de novo até aparecerem.
    const region = await screen.findByRole('region', { name: 'Versões' });
    const row = (tag: string) =>
      within(region)
        .getAllByRole('listitem')
        .find((li) => li.querySelector('.store-release__name')?.textContent === tag)!;
    await waitFor(() => expect(row('v3')).toBeTruthy(), { timeout: 3000 });
    expect(row('v3').textContent).toContain('Mais recente');
    expect(row('v4-beta').textContent).toContain('Prévia');
    expect(within(row('v3')).getByRole('button', { name: 'Instalar esta versão' })).toBeTruthy();
    expect(row('v2').textContent).toContain('Instalada');
    expect(within(row('v1')).getByRole('button', { name: 'Usar esta (já baixada)' })).toBeTruthy();
    expect(row('v0').textContent).toContain('Sem arquivo para Windows nesta versão');
  });

  it('mesma tag republicada com outro arquivo não conta como instalada', async () => {
    const republished = release('v2', { windowsAsset: { ...release('v2').windowsAsset!, sha256: 'sha-nova-compilacao' } });
    setup('/?port=soh', { 'store:releases': { ok: true, data: [republished] } });
    const region = await screen.findByRole('region', { name: 'Versões' });
    expect(await within(region).findByRole('button', { name: 'Instalar esta versão' }, { timeout: 3000 })).toBeTruthy();
    expect(region.textContent).not.toContain('Instalada');
  });

  it('limite do GitHub sem conta: oferece conectar a conta', async () => {
    setup('/?port=soh', { 'store:releases': { ok: false, error: { code: 'RATE_LIMITED', message: 'O GitHub limita consultas sem conta a 60 por hora.' } } });
    expect(await screen.findByRole('button', { name: 'Conectar conta do GitHub' }, { timeout: 3000 })).toBeTruthy();
  });

  it('atualizar tudo: resume o que foi atualizado e o que ficou de fora', async () => {
    setup('/', {
      'store:update-all': { ok: true, data: { updated: ['mm'], skipped: [{ portId: 'soh', reason: 'running' }], failed: [] } },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Atualizar tudo (1)' }));
    expect(await screen.findByText('1 port atualizado')).toBeTruthy();
    expect(screen.getByText('Abertos agora (feche e tente de novo): Ship of Harkinian.')).toBeTruthy();
  });
});
