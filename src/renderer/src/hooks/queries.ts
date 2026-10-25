import { useMemo } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EmulatorChoice, EmulatorsOverview } from '@shared/emulators';
import type { ModProgress, ModSort } from '@shared/mods';
import type {
  ArtworkSlot,
  CloudProviderId,
  CompletionEntry,
  Game,
  GameSaves,
  NewGameInput,
  SetArtworkInput,
  Settings,
  SettingsUpdate,
  TrophyInput,
  TrophySet,
  UpdateGameInput,
} from '@shared/types';
import type { CustomPortInput, GitHubStatus, InstallProgress, StoreInstall } from '@shared/store';
import { call } from '@/lib/api';

const MIN = 60_000;

export const qk = {
  games: ['games'] as const,
  running: ['running'] as const,
  missing: ['games', 'missing'] as const,
  settings: ['settings'] as const,
  retroarch: ['retroarch'] as const,
  ra: ['ra'] as const,
  profile: ['ra', 'profile'] as const,
  recent: ['ra', 'recent'] as const,
  completion: ['ra', 'completion'] as const,
  progress: (raGameId: number) => ['ra', 'progress', raGameId] as const,
  consoles: ['ra-catalog', 'consoles'] as const,
  search: (consoleId: number | null, query: string) => ['ra-catalog', 'search', consoleId, query] as const,
  trophies: (gameId: number) => ['trophies', gameId] as const,
  backups: ['backups'] as const,
  trophyOverview: ['trophy-overview'] as const,
  saves: (gameId: number) => ['saves', gameId] as const,
  cloud: ['cloud'] as const,
  categories: ['categories'] as const,
  storeCatalog: ['store', 'catalog'] as const,
  storeReleases: (portId: string) => ['store', 'releases', portId] as const,
  github: ['github'] as const,
  storeInstalls: ['store', 'installs'] as const,
  storeUpdates: ['store', 'updates'] as const,
  /** Progresso das instalações em andamento, por port (alimentado pelo evento store:install-progress). */
  storeProgress: ['store', 'progress'] as const,
  romStatus: (portId: string) => ['store', 'rom', portId] as const,
  storeArt: (portId: string) => ['store', 'art', portId] as const,
  /** Atualização do próprio RetroVault (alimentado também pelo evento app:update-changed). */
  appUpdate: ['app', 'update'] as const,
  emulators: ['emulators'] as const,
  steamShortcuts: (accountId: string | null) => ['steam', 'shortcuts', accountId] as const,
};

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

// ---------- Biblioteca ----------

export function useGames() {
  return useQuery({ queryKey: qk.games, queryFn: () => call('games:list') });
}

/** Deriva um jogo da lista (fonte única de verdade, sem requisição extra). */
export function useGame(id: number) {
  return useQuery({
    queryKey: qk.games,
    queryFn: () => call('games:list'),
    select: (games: Game[]) => games.find((g) => g.id === id) ?? null,
  });
}

export function useRunningGames() {
  return useQuery({ queryKey: qk.running, queryFn: () => call('games:running'), staleTime: Infinity });
}

function replaceGame(list: Game[] | undefined, game: Game): Game[] | undefined {
  return list?.map((g) => (g.id === game.id ? game : g));
}

export function useAddGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewGameInput) => call('games:add', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.games }),
  });
}

export function useUpdateGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateGameInput) => call('games:update', input),
    // Atualização otimista para ações instantâneas (ex.: favoritar).
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: qk.games });
      const previous = qc.getQueryData<Game[]>(qk.games);
      if (input.favorite !== undefined) {
        qc.setQueryData<Game[]>(qk.games, (list) =>
          list?.map((g) => (g.id === input.id ? { ...g, favorite: input.favorite! } : g)),
        );
      }
      return { previous };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(qk.games, ctx.previous);
    },
    onSuccess: (game) => qc.setQueryData<Game[]>(qk.games, (list) => replaceGame(list, game)),
  });
}

export function useRemoveGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => call('games:remove', id),
    onSuccess: (_void, id) => qc.setQueryData<Game[]>(qk.games, (list) => list?.filter((g) => g.id !== id)),
  });
}

export function useRematchGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => call('games:rematch', id),
    onSuccess: ({ game }) => qc.setQueryData<Game[]>(qk.games, (list) => replaceGame(list, game)),
  });
}

export function useSetArtwork() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SetArtworkInput) => call('games:set-artwork', input),
    onSuccess: (game) => {
      if (game) qc.setQueryData<Game[]>(qk.games, (list) => replaceGame(list, game));
    },
  });
}

/** Busca de arte online (SteamGridDB): disparada pelo usuário, não em segundo plano. */
export function useArtSearch() {
  return useMutation({
    mutationFn: (input: { id: number; query?: string; sgdbGameId?: number }) => call('games:art-search', input),
  });
}

export function useApplyArt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: number; slot: ArtworkSlot; url: string }) => call('games:art-apply', input),
    onSuccess: (game) => qc.setQueryData<Game[]>(qk.games, (list) => replaceGame(list, game)),
  });
}

/** Imagem do editor de enquadramento (base64 de PNG/JPEG). */
export function useSetArtworkData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: number; slot: ArtworkSlot; data: string }) => call('games:set-artwork-data', input),
    onSuccess: (game) => qc.setQueryData<Game[]>(qk.games, (list) => replaceGame(list, game)),
  });
}

export function useFillMissingArt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => call('games:art-fill-missing'),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.games, exact: true }),
  });
}

export function useLaunchGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => call('games:launch', id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.running }),
    // O arquivo pode ter sumido desde a última verificação.
    onError: () => qc.invalidateQueries({ queryKey: qk.missing }),
  });
}

/** Jogos cujo arquivo não existe mais. Revalida ao voltar para a janela (o usuário pode ter movido pastas). */
export function useMissingGames(): Set<number> {
  const { data } = useQuery({ queryKey: qk.missing, queryFn: () => call('games:missing'), staleTime: 30_000 });
  return useMemo(() => new Set(data ?? []), [data]);
}

export function useRelocateGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: number; action: 'pick' | 'auto' }) => call('games:relocate', input),
    onSuccess: (game) => {
      if (!game) return;
      qc.setQueryData<Game[]>(qk.games, (list) => replaceGame(list, game));
      qc.setQueryData<number[]>(qk.missing, (ids) => ids?.filter((id) => id !== game.id));
      void qc.invalidateQueries({ queryKey: qk.trophies(game.id) });
    },
  });
}

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

// ---------- Categorias ----------

export function useCategories() {
  return useQuery({ queryKey: qk.categories, queryFn: () => call('categories:list'), staleTime: 60_000 });
}

/** Categorias e jogos mudam juntos (contagens, grupos da barra lateral, filtro da biblioteca). */
function useCategoryMutation<I, O>(mutationFn: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.categories });
      void qc.invalidateQueries({ queryKey: qk.games, exact: true });
    },
  });
}

export const useCreateCategory = () => useCategoryMutation((name: string) => call('categories:create', name));
export const useRenameCategory = () => useCategoryMutation((input: { id: number; name: string }) => call('categories:rename', input));
export const useDeleteCategory = () => useCategoryMutation((id: number) => call('categories:delete', id));
export const useSetCategoryIcon = () =>
  useCategoryMutation((input: { id: number; icon: string | null }) => call('categories:set-icon', input));
export const useMoveCategory = () => useCategoryMutation((input: { id: number; direction: -1 | 1 }) => call('categories:move', input));
/**
 * Grava o jogo devolvido direto no cache: duas marcações seguidas partem do estado novo, e não de
 * uma lista antiga que desfaria a primeira enquanto a revalidação não chega.
 */
export function useSetGameCategories() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { gameId: number; categoryIds: number[] }) => call('categories:set-game', input),
    onSuccess: (game) => {
      qc.setQueryData<Game[]>(qk.games, (list) => replaceGame(list, game));
      void qc.invalidateQueries({ queryKey: qk.categories });
    },
  });
}
export const useAutoOrganize = () => useCategoryMutation((_: void) => call('categories:auto-organize'));

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
