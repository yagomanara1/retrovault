// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { useInstallFor } from './store';

function wrapper({ children }: { children: ReactNode }) {
  const installs = [{ portId: 'soh', tag: 'v2' }];
  (window as unknown as { bridge: unknown }).bridge = {
    invoke: async (channel: string) => (channel === 'store:installs' ? { ok: true, data: { installs, installing: [] } } : { ok: false, error: { code: 'INTERNAL', message: channel } }),
    on: () => () => undefined,
  };
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
}

describe('useInstallFor', () => {
  it('a instalação do port, ou null se ele não está instalado', async () => {
    const soh = renderHook(() => useInstallFor('soh'), { wrapper });
    await waitFor(() => expect(soh.result.current).toMatchObject({ portId: 'soh', tag: 'v2' }));
    const mm = renderHook(() => useInstallFor('mm'), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(mm.result.current).toBeNull();
  });
});
