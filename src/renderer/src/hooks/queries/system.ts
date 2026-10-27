// Atalhos na Steam, emuladores próprios e atualização do RetroVault.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EmulatorChoice, EmulatorsOverview } from '@shared/emulators';
import { call } from '@/lib/api';
import { qk } from './keys';

// ---------- Atalhos na Steam ----------

export function useSteamShortcuts(accountId: string | null) {
  return useQuery({ queryKey: qk.steamShortcuts(accountId), queryFn: () => call('steam:shortcuts', { accountId }), staleTime: 10_000 });
}

// ---------- Emuladores próprios ----------

export function useEmulators() {
  return useQuery({ queryKey: qk.emulators, queryFn: () => call('emulators:overview'), staleTime: 60_000 });
}

export function useEmulatorActions() {
  const qc = useQueryClient();
  const done = (overview: EmulatorsOverview | null) => overview && qc.setQueryData(qk.emulators, overview);
  return {
    pickPath: useMutation({ mutationFn: (id: string) => call('emulators:set-path', { id, path: 'pick' }), onSuccess: done }),
    clearPath: useMutation({ mutationFn: (id: string) => call('emulators:set-path', { id, path: null }), onSuccess: done }),
    setConsole: useMutation({
      mutationFn: (input: { consoleId: number; choice: EmulatorChoice | null }) => call('emulators:set-console', input),
      onSuccess: done,
    }),
    setFullscreen: useMutation({ mutationFn: (fullscreen: boolean) => call('emulators:set-fullscreen', fullscreen), onSuccess: done }),
    refresh: useMutation({ mutationFn: () => call('emulators:refresh'), onSuccess: done }),
  };
}

// ---------- Atualização do RetroVault ----------

export function useAppUpdate() {
  return useQuery({ queryKey: qk.appUpdate, queryFn: () => call('app:update-status'), staleTime: Infinity });
}

export function useAppUpdateActions() {
  const qc = useQueryClient();
  const check = useMutation({
    mutationFn: () => call('app:update-check'),
    onSuccess: (state) => qc.setQueryData(qk.appUpdate, state),
  });
  const install = useMutation({ mutationFn: () => call('app:update-install') });
  return { check, install };
}
