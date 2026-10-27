// Cofre de saves, nuvem, backups da biblioteca e progresso.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CloudProviderId, GameSaves } from '@shared/types';
import { call } from '@/lib/api';
import { qk } from './keys';

// ---------- Cofre de saves ----------

export function useGameSaves(gameId: number) {
  return useQuery({ queryKey: qk.saves(gameId), queryFn: () => call('saves:get', gameId), staleTime: 30_000 });
}

/** Mutações que devolvem o estado atualizado dos saves (ou null = cancelado) e gravam no cache. */
function useSavesMutation<I>(gameId: number, mutationFn: (input: I) => Promise<GameSaves | null>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (saves) => {
      if (saves) qc.setQueryData(qk.saves(gameId), saves);
    },
  });
}

export function useBackupSave(gameId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => call('saves:backup', gameId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.saves(gameId) }),
  });
}

export const useRestoreSave = (gameId: number) =>
  useSavesMutation<string>(gameId, (snapshotId) => call('saves:restore', { gameId, snapshotId }));

export const useAddSavePath = (gameId: number) =>
  useSavesMutation<'file' | 'folder'>(gameId, (kind) => call('saves:add-path', { gameId, kind }));

export const useRemoveSavePath = (gameId: number) =>
  useSavesMutation<string>(gameId, (path) => call('saves:remove-path', { gameId, path }));

// ---------- Nuvem ----------

/** Provedores detectados; revalida ao voltar para a janela (o usuário pode ter aberto o OneDrive). */
export function useCloudProviders() {
  return useQuery({ queryKey: qk.cloud, queryFn: () => call('cloud:providers'), staleTime: 10_000 });
}

/** Conectar/desconectar muda a pasta do cofre: atualiza configurações, provedores e saves. */
function useCloudMutation<I, O>(mutationFn: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.settings });
      void qc.invalidateQueries({ queryKey: qk.cloud });
      void qc.invalidateQueries({ queryKey: ['saves'] });
    },
  });
}

export const useConnectCloud = () => useCloudMutation((id: CloudProviderId) => call('cloud:connect', id));
export const useDisconnectCloud = () => useCloudMutation((_: void) => call('cloud:disconnect'));

export function useStartCloudClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: CloudProviderId) => call('cloud:start-client', id),
    // O app leva alguns segundos para aparecer na lista de processos.
    onSuccess: () => setTimeout(() => void qc.invalidateQueries({ queryKey: qk.cloud }), 4000),
  });
}

// ---------- Backup e progresso ----------

export function useBackups() {
  return useQuery({ queryKey: qk.backups, queryFn: () => call('backup:list'), staleTime: 30_000 });
}

export function useCreateBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => call('backup:create'),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.backups }),
  });
}

/** O app reinicia logo após o sucesso; não há cache a atualizar. */
export function useRestoreBackup() {
  return useMutation({ mutationFn: (name: string) => call('backup:restore', name) });
}

export function useExportProgress() {
  return useMutation({ mutationFn: () => call('progress:export') });
}

export function useImportProgress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => call('progress:import'),
    // Tempo de jogo e troféus podem ter mudado em qualquer jogo.
    onSuccess: (result) => {
      if (!result) return;
      void qc.invalidateQueries({ queryKey: qk.games });
      void qc.invalidateQueries({ queryKey: ['trophies'] });
      void qc.invalidateQueries({ queryKey: qk.trophyOverview });
    },
  });
}
