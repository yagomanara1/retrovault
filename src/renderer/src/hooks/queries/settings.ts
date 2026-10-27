// Configurações e status do RetroArch.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SettingsUpdate } from '@shared/types';
import { call } from '@/lib/api';
import { qk } from './keys';

// ---------- Configurações ----------

export function useSettings() {
  return useQuery({ queryKey: qk.settings, queryFn: () => call('settings:get'), staleTime: Infinity });
}

export function useRaEnabled(): boolean {
  const { data } = useSettings();
  return Boolean(data?.raUsername && data.hasApiKey);
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsUpdate) => call('settings:update', patch),
    onSuccess: (settings, patch) => {
      qc.setQueryData(qk.settings, settings);
      if (patch.retroarchPath !== undefined) void qc.invalidateQueries({ queryKey: qk.retroarch });
      if (patch.raUsername !== undefined || patch.raApiKey !== undefined) {
        qc.removeQueries({ queryKey: qk.ra });
      }
    },
  });
}

export function useRetroArchStatus() {
  return useQuery({ queryKey: qk.retroarch, queryFn: () => call('retroarch:status'), staleTime: 30_000 });
}
