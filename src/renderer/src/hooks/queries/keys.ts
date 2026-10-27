// Chaves do cache do react-query (fonte única: telas e eventos do main invalidam pelas mesmas chaves).
import type { Game } from '@shared/types';

/** Um minuto, para os staleTime. */
export const MIN = 60_000;

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

/** Troca um jogo da lista em cache pela versão nova devolvida pelo main. */
export function replaceGame(list: Game[] | undefined, game: Game): Game[] | undefined {
  return list?.map((g) => (g.id === game.id ? game : g));
}
