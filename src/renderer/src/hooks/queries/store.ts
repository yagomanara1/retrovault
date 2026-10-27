// Loja de ports: catálogo, artes, ROMs, instalação, mods, ports do usuário e conta do GitHub.
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ModProgress, ModSort } from '@shared/mods';
import type { Settings } from '@shared/types';
import type { CustomPortInput, GitHubStatus, InstallProgress, StoreInstall } from '@shared/store';
import { call } from '@/lib/api';
import { MIN, qk } from './keys';

// ---------- Artes e configurações da Loja ----------

/** Artes do port (o main baixa uma vez e guarda; aqui é só o endereço local). */
export function useStoreArt(portId: string) {
  return useQuery({ queryKey: qk.storeArt(portId), queryFn: () => call('store:art', portId), staleTime: 60 * MIN });
}

/** Catálogo online e chave do SteamGridDB: cada mudança recarrega o que depende dela. */
export function useStoreSettings() {
  const qc = useQueryClient();
  const settingsChanged = (settings: Settings) => qc.setQueryData(qk.settings, settings);
  const setCatalogUrl = useMutation({
    mutationFn: (url: string | null) => call('store:set-catalog-url', url),
    onSuccess: (result) => {
      settingsChanged(result.settings);
      void qc.invalidateQueries({ queryKey: ['store'] });
    },
  });
  const exportCatalog = useMutation({ mutationFn: () => call('store:export-catalog') });
  const refreshArt = (settings: Settings) => {
    settingsChanged(settings);
    void qc.invalidateQueries({ queryKey: ['store', 'art'] });
    void qc.invalidateQueries({ queryKey: qk.games });
  };
  const connectSgdb = useMutation({ mutationFn: (key: string) => call('sgdb:connect', key), onSuccess: refreshArt });
  const disconnectSgdb = useMutation({ mutationFn: () => call('sgdb:disconnect'), onSuccess: refreshArt });
  return { setCatalogUrl, exportCatalog, connectSgdb, disconnectSgdb };
}

// ---------- ROM dos ports ----------

/** Estado da ROM do port instalado (só consulta o disco local; sem custo de rede). */
export function useRomStatus(portId: string, enabled: boolean) {
  return useQuery({ queryKey: qk.romStatus(portId), queryFn: () => call('store:rom-status', portId), enabled });
}

export function useRomSetup(portId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => call('store:rom-setup', portId),
    onSuccess: (result) => result && qc.setQueryData(qk.romStatus(portId), result.status),
  });
}

// ---------- Instalação de ports ----------

export type InstallProgressMap = Record<string, InstallProgress>;

export function useStoreInstalls() {
  return useQuery({ queryKey: qk.storeInstalls, queryFn: () => call('store:installs'), staleTime: Infinity });
}

/** Atualizações dos ports instalados (o main usa as versões em cache; poucos ports, poucas consultas). */
export function useStoreUpdates() {
  return useQuery({ queryKey: qk.storeUpdates, queryFn: () => call('store:updates'), staleTime: 10 * MIN });
}

/** Progresso vindo do main; o "preparing" inicial é posto aqui mesmo para o botão reagir na hora. */
export function useInstallProgress(): InstallProgressMap {
  return useQuery<InstallProgressMap>({ queryKey: qk.storeProgress, queryFn: () => ({}), staleTime: Infinity, initialData: {} }).data;
}

/**
 * Instalar / cancelar / desinstalar. Os callbacks ficam no useMutation (não no mutate) para
 * rodarem mesmo se o usuário sair da Loja no meio do download.
 */
export function useStoreActions(
  handlers: { onInstalled?: (install: StoreInstall, kind: 'install' | 'rollback') => void; onError?: (err: unknown, portId: string) => void } = {},
) {
  const qc = useQueryClient();
  const clearProgress = (portId: string) =>
    qc.setQueryData<InstallProgressMap>(qk.storeProgress, (map = {}) => {
      const { [portId]: _done, ...rest } = map;
      return rest;
    });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.storeInstalls });
    void qc.invalidateQueries({ queryKey: qk.games });
    // Instalar/desinstalar muda o estado da ROM (ela é recolocada ou some com a pasta).
    void qc.invalidateQueries({ queryKey: ['store', 'rom'] });
    void qc.invalidateQueries({ queryKey: qk.storeUpdates });
  };

  const install = useMutation({
    mutationFn: (input: { portId: string; tag?: string }) => call('store:install', input),
    onMutate: ({ portId }) =>
      qc.setQueryData<InstallProgressMap>(qk.storeProgress, (map = {}) => ({ ...map, [portId]: { portId, phase: 'preparing', done: 0, total: 0 } })),
    // Pedir a versão anterior pela lista também é uma troca instantânea (o main chama rollback).
    onSuccess: (result) => handlers.onInstalled?.(result, 'install'),
    onError: (err, { portId }) => handlers.onError?.(err, portId),
    onSettled: (_data, _err, { portId }) => {
      clearProgress(portId);
      refresh();
    },
  });
  const cancel = useMutation({ mutationFn: (portId: string) => call('store:cancel', portId) });
  const uninstall = useMutation({ mutationFn: (portId: string) => call('store:uninstall', portId), onSettled: refresh });
  const rollback = useMutation({
    mutationFn: (portId: string) => call('store:rollback', portId),
    onSuccess: (result) => handlers.onInstalled?.(result, 'rollback'),
    onError: (err, portId) => handlers.onError?.(err, portId),
    onSettled: refresh,
  });
  return { install, cancel, uninstall, rollback };
}

// ---------- Mods (GameBanana) ----------

export type ModProgressMap = Record<string, ModProgress>;
export const modKey = (portId: string, modId: number) => `${portId}:${modId}`;

/** Lista de mods com "Carregar mais" (páginas acumuladas). */
export function useModList(portId: string, sort: ModSort, query: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['mods', 'list', portId, sort, query],
    queryFn: ({ pageParam }) => call('mods:list', { portId, page: pageParam, sort, query: query || undefined }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    staleTime: 10 * MIN,
    enabled,
  });
}

export function useModDetails(portId: string, modId: number | null) {
  return useQuery({
    queryKey: ['mods', 'details', portId, modId],
    queryFn: () => call('mods:details', { portId, modId: modId! }),
    enabled: modId !== null,
    staleTime: 10 * MIN,
  });
}

export function useInstalledMods(portId: string, enabled = true) {
  return useQuery({ queryKey: ['mods', 'installed', portId], queryFn: () => call('mods:installed', portId), enabled });
}

/** Progresso dos downloads de mods (alimentado pelo evento mods:progress). */
export function useModProgress(): ModProgressMap {
  return useQuery<ModProgressMap>({ queryKey: ['mods', 'progress'], queryFn: () => ({}), staleTime: Infinity, initialData: {} }).data;
}

export function useModActions(portId: string) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['mods', 'installed', portId] });
  const clearProgress = (modId: number) =>
    qc.setQueryData<ModProgressMap>(['mods', 'progress'], (map = {}) => {
      const { [modKey(portId, modId)]: _done, ...rest } = map;
      return rest;
    });
  const install = useMutation({
    mutationFn: (input: { modId: number; fileId: number }) => call('mods:install', { portId, ...input }),
    onSettled: (_d, _e, { modId }) => {
      clearProgress(modId);
      refresh();
    },
  });
  const uninstall = useMutation({ mutationFn: (modId: number) => call('mods:uninstall', { portId, modId }), onSettled: refresh });
  return { install, uninstall };
}

// ---------- Ports adicionados pelo usuário ----------

export function useInspectRepo() {
  return useMutation({ mutationFn: (input: string) => call('store:custom-inspect', input) });
}

/** Adicionar/remover mexe no catálogo da Loja (os adicionados entram junto com ele). */
export function useCustomPorts() {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: qk.storeCatalog });
  const add = useMutation({ mutationFn: (input: CustomPortInput) => call('store:custom-add', input), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (portId: string) => call('store:custom-remove', portId), onSuccess: refresh });
  return { add, remove };
}

/**
 * "Atualizar tudo": o main instala um port de cada vez (o progresso de cada um chega pelo mesmo
 * evento da instalação avulsa). No fim, limpa o progresso que sobrou e recarrega o estado da Loja.
 */
export function useUpdateAllPorts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => call('store:update-all'),
    onSettled: () => {
      qc.setQueryData<InstallProgressMap>(qk.storeProgress, {});
      void qc.invalidateQueries({ queryKey: qk.storeInstalls });
      void qc.invalidateQueries({ queryKey: qk.storeUpdates });
      void qc.invalidateQueries({ queryKey: qk.games });
      void qc.invalidateQueries({ queryKey: ['store', 'rom'] });
    },
  });
}

// ---------- Conta do GitHub ----------

export function useGitHubStatus() {
  return useQuery({ queryKey: qk.github, queryFn: () => call('github:status'), staleTime: MIN });
}

/** Conectar/desconectar: atualiza o status e as configurações (o login aparece na cascata). */
export function useGitHubAccount() {
  const qc = useQueryClient();
  const onSuccess = (status: GitHubStatus) => {
    qc.setQueryData(qk.github, status);
    void qc.invalidateQueries({ queryKey: qk.settings });
  };
  const connect = useMutation({ mutationFn: (token: string) => call('github:connect', token), onSuccess });
  const disconnect = useMutation({ mutationFn: () => call('github:disconnect'), onSuccess });
  return { connect, disconnect };
}

// ---------- Loja de ports ----------

export function useStoreCatalog() {
  return useQuery({ queryKey: qk.storeCatalog, queryFn: () => call('store:catalog', {}), staleTime: 30 * MIN });
}

/**
 * Versões do port: só busca quando o port é aberto (o GitHub limita 60 consultas por hora sem conta).
 * Com `fetch: false` não busca, mas devolve o que já estiver em cache.
 */
export function useStoreReleases(portId: string, fetch = true) {
  return useQuery({
    queryKey: qk.storeReleases(portId),
    queryFn: () => call('store:releases', { portId }),
    enabled: fetch,
    staleTime: 30 * MIN,
  });
}
