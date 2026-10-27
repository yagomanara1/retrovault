// RetroAchievements: perfil, progresso, catálogo e busca.
import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CompletionEntry } from '@shared/types';
import { call } from '@/lib/api';
import { MIN, qk } from './keys';
import { useRaEnabled } from './settings';

// ---------- RetroAchievements ----------

export function useProfile() {
  const enabled = useRaEnabled();
  return useQuery({ queryKey: qk.profile, queryFn: () => call('ra:profile', {}), enabled, staleTime: 5 * MIN });
}

export function useRecentAchievements() {
  const enabled = useRaEnabled();
  return useQuery({ queryKey: qk.recent, queryFn: () => call('ra:recent', {}), enabled, staleTime: MIN });
}

export function useCompletion() {
  const enabled = useRaEnabled();
  return useQuery({ queryKey: qk.completion, queryFn: () => call('ra:completion', {}), enabled, staleTime: 5 * MIN });
}

/** Mapa raGameId → progresso, usado nos cards da biblioteca (1 requisição para todos). */
export function useCompletionMap(): Map<number, CompletionEntry> {
  const { data } = useCompletion();
  return useMemo(() => new Map((data ?? []).map((entry) => [entry.gameId, entry])), [data]);
}

export function useGameProgress(raGameId: number | null) {
  const enabled = useRaEnabled() && raGameId != null;
  return useQuery({
    queryKey: qk.progress(raGameId ?? 0),
    queryFn: () => call('ra:game-progress', { raGameId: raGameId! }),
    enabled,
    staleTime: 2 * MIN,
  });
}

export function useForceRefreshProgress(raGameId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => call('ra:game-progress', { raGameId, force: true }),
    onSuccess: (progress) => {
      qc.setQueryData(qk.progress(raGameId), progress);
      void qc.invalidateQueries({ queryKey: qk.completion });
    },
  });
}

export function useRaConsoles(enabled = true) {
  const raEnabled = useRaEnabled();
  return useQuery({
    queryKey: qk.consoles,
    queryFn: () => call('ra:consoles'),
    enabled: enabled && raEnabled,
    staleTime: Infinity,
  });
}

export function useRaSearch(consoleId: number | null, query: string) {
  const raEnabled = useRaEnabled();
  const trimmed = query.trim();
  return useQuery({
    queryKey: qk.search(consoleId, trimmed),
    queryFn: () => call('ra:search', { consoleId: consoleId!, query: trimmed }),
    enabled: raEnabled && consoleId != null && trimmed.length >= 2,
    staleTime: 10 * MIN,
    placeholderData: (previous) => previous,
  });
}
