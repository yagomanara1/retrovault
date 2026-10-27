// Troféus locais.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TrophyInput, TrophySet } from '@shared/types';
import { call } from '@/lib/api';
import { qk } from './keys';

// ---------- Troféus locais ----------

/** Página geral de troféus: resumo de todos os jogos + recentes. */
export function useTrophyOverview() {
  return useQuery({ queryKey: qk.trophyOverview, queryFn: () => call('trophies:overview'), staleTime: 30_000 });
}

export function useTrophySet(gameId: number) {
  return useQuery({ queryKey: qk.trophies(gameId), queryFn: () => call('trophies:get', gameId), staleTime: 30_000 });
}

/** Mutação que devolve a lista atualizada (ou null = cancelado/sem mudança) e grava no cache. */
function useTrophyMutation<I>(gameId: number, mutationFn: (input: I) => Promise<TrophySet | null>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (set) => {
      if (set) qc.setQueryData(qk.trophies(gameId), set);
      void qc.invalidateQueries({ queryKey: qk.trophyOverview });
    },
  });
}

export const useImportTrophies = (gameId: number) =>
  useTrophyMutation<void>(gameId, () => call('trophies:import-trp', gameId));

export const useAutoImportTrophies = (gameId: number) =>
  useTrophyMutation<void>(gameId, () => call('trophies:auto-import', gameId));

export const useCreateManualTrophies = (gameId: number) =>
  useTrophyMutation<void>(gameId, () => call('trophies:create-manual', gameId));

export const useUpsertTrophy = (gameId: number) =>
  useTrophyMutation<Omit<TrophyInput, 'gameId'>>(gameId, (input) => call('trophies:upsert', { ...input, gameId }));

export const useDeleteTrophy = (gameId: number) =>
  useTrophyMutation<number>(gameId, (trophyId) => call('trophies:delete', { gameId, trophyId }));

export const useSetTrophyUnlocked = (gameId: number) =>
  useTrophyMutation<{ trophyId: number; unlocked: boolean }>(gameId, (input) =>
    call('trophies:set-unlocked', { ...input, gameId }),
  );

export const useConfigureTrophyLog = (gameId: number) =>
  useTrophyMutation<'pick' | 'auto' | 'clear'>(gameId, (action) => call('trophies:configure-log', { gameId, action }));

export function useDeleteTrophySet(gameId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => call('trophies:delete-set', gameId),
    onSuccess: () => {
      qc.setQueryData(qk.trophies(gameId), null);
      void qc.invalidateQueries({ queryKey: qk.trophyOverview });
    },
  });
}
