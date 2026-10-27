import type {
  CompletionEntry,
  ConsoleInfo,
  GameProgress,
  RaGameSearchResult,
  RecentAchievement,
  UserProfile,
} from '@shared/types';
import { wordKey } from '@shared/text';
import { AppError } from '../../errors';
import type { ApiCache } from '../apiCache';
import type { RaCredentials } from '../settingsService';
import {
  type GameListEntry,
  mapCompletion,
  mapConsole,
  mapGameListEntry,
  mapGameProgress,
  mapProfile,
  mapRecent,
} from './mappers';
import type {
  RawCompletionPage,
  RawConsole,
  RawGameListEntry,
  RawGameProgress,
  RawRecentAchievement,
  RawUserProfile,
} from './rawTypes';

const API_BASE = 'https://retroachievements.org/API/';
const USER_AGENT = 'RetroVault/0.1 (+desktop launcher)';
const MIN_INTERVAL_MS = 250;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 3;
const COMPLETION_PAGE_SIZE = 500;
const MAX_COMPLETION_PAGES = 20;

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const TTL = {
  consoles: 30 * DAY,
  gameList: 7 * DAY,
  profile: 10 * MIN,
  recent: 2 * MIN,
  completion: 10 * MIN,
  gameProgress: 5 * MIN,
} as const;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function backoffMs(attempt: number, retryAfter: string | null): number {
  const seconds = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 30_000);
  return 500 * 2 ** attempt + Math.random() * 250;
}

const normalizeTitle = wordKey;

/**
 * Cliente da Web API do RetroAchievements.
 * - Rate limiting (espaçamento mínimo entre requisições)
 * - Retry com backoff exponencial em 429/5xx/erros de rede
 * - Cache de duas camadas com chaves isoladas por usuário
 */
export class RetroAchievementsClient {
  private gate: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(
    private readonly credentials: () => RaCredentials | null,
    private readonly cache: ApiCache,
  ) {}

  hasCredentials(): boolean {
    return this.credentials() !== null;
  }

  // ---------- Dados do usuário ----------

  getProfile(force = false): Promise<UserProfile> {
    const { username } = this.requireCredentials();
    return this.cache.getOrFetch(
      this.userKey(username, 'profile'),
      TTL.profile,
      async () => mapProfile(await this.request<RawUserProfile>('API_GetUserProfile.php', { u: username })),
      { force },
    );
  }

  getRecentAchievements(force = false): Promise<RecentAchievement[]> {
    const { username } = this.requireCredentials();
    return this.cache.getOrFetch(
      this.userKey(username, 'recent'),
      TTL.recent,
      () => this.fetchLatestUnlocks(60 * 24 * 30).then((list) => list.slice(0, 50)),
      { force },
    );
  }

  /** Sem cache: usado pelo watcher para detectar desbloqueios em tempo real. */
  async fetchLatestUnlocks(minutes: number): Promise<RecentAchievement[]> {
    const { username } = this.requireCredentials();
    const raw = await this.request<RawRecentAchievement[]>('API_GetUserRecentAchievements.php', {
      u: username,
      m: minutes,
    });
    return (Array.isArray(raw) ? raw : [])
      .map(mapRecent)
      .sort((a, b) => b.unlockedAt.localeCompare(a.unlockedAt));
  }

  getCompletionProgress(force = false): Promise<CompletionEntry[]> {
    const { username } = this.requireCredentials();
    return this.cache.getOrFetch(
      this.userKey(username, 'completion'),
      TTL.completion,
      async () => {
        const results: CompletionEntry[] = [];
        for (let page = 0; page < MAX_COMPLETION_PAGES; page++) {
          const raw = await this.request<RawCompletionPage>('API_GetUserCompletionProgress.php', {
            u: username,
            c: COMPLETION_PAGE_SIZE,
            o: page * COMPLETION_PAGE_SIZE,
          });
          const batch = raw?.Results ?? [];
          results.push(...batch.map(mapCompletion));
          if (batch.length < COMPLETION_PAGE_SIZE || results.length >= Number(raw?.Total ?? 0)) break;
        }
        return results;
      },
      { force },
    );
  }

  getGameProgress(raGameId: number, force = false): Promise<GameProgress> {
    const { username } = this.requireCredentials();
    return this.cache.getOrFetch(
      this.userKey(username, `game:${raGameId}`),
      TTL.gameProgress,
      async () =>
        mapGameProgress(
          await this.request<RawGameProgress>('API_GetGameInfoAndUserProgress.php', {
            g: raGameId,
            u: username,
            a: 1,
          }),
        ),
      { force },
    );
  }

  /** Invalida dados do usuário após uma sessão de jogo ou desbloqueio. */
  invalidateUserData(raGameIds: readonly number[] = []): void {
    const creds = this.credentials();
    if (!creds) return;
    for (const part of ['profile', 'recent', 'completion']) {
      this.cache.invalidate(this.userKey(creds.username, part));
    }
    for (const id of raGameIds) this.cache.invalidate(this.userKey(creds.username, `game:${id}`));
  }

  invalidateAllUserData(): void {
    this.cache.invalidate('u:');
  }

  // ---------- Catálogo (global, cache longo) ----------

  getConsoles(): Promise<ConsoleInfo[]> {
    return this.cache.getOrFetch('consoles', TTL.consoles, async () => {
      const raw = await this.request<RawConsole[]>('API_GetConsoleIDs.php', { a: 1, g: 1 });
      return (Array.isArray(raw) ? raw : [])
        .map(mapConsole)
        .filter((c) => c.id > 0)
        .sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  private getGameList(consoleId: number): Promise<GameListEntry[]> {
    return this.cache.getOrFetch(`gamelist:${consoleId}`, TTL.gameList, async () => {
      const raw = await this.request<RawGameListEntry[]>('API_GetGameList.php', { i: consoleId, f: 1, h: 1 });
      return (Array.isArray(raw) ? raw : []).map(mapGameListEntry);
    });
  }

  async findGameByHash(consoleId: number, hash: string): Promise<GameListEntry | null> {
    const needle = hash.toLowerCase();
    const list = await this.getGameList(consoleId);
    return list.find((g) => g.hashes.includes(needle)) ?? null;
  }

  async searchGames(consoleId: number, query: string, limit = 50): Promise<RaGameSearchResult[]> {
    const tokens = normalizeTitle(query).split(' ').filter(Boolean);
    const list = await this.getGameList(consoleId);
    const scored = list
      .map((g) => {
        const title = normalizeTitle(g.title);
        if (!tokens.every((t) => title.includes(t))) return null;
        const score = title === tokens.join(' ') ? 0 : title.startsWith(tokens[0] ?? '') ? 1 : 2;
        return { g, score };
      })
      .filter((x): x is { g: GameListEntry; score: number } => x !== null)
      .sort((a, b) => a.score - b.score || a.g.title.localeCompare(b.g.title))
      .slice(0, limit);
    return scored.map(({ g }) => ({
      id: g.id,
      title: g.title,
      consoleId: g.consoleId,
      consoleName: g.consoleName,
      iconUrl: g.iconUrl,
      numAchievements: g.numAchievements,
    }));
  }

  // ---------- HTTP ----------

  private requireCredentials(): RaCredentials {
    const creds = this.credentials();
    if (!creds) {
      throw new AppError(
        'RA_NOT_CONFIGURED',
        'Configure seu usuário e Web API Key do RetroAchievements em Configurações.',
      );
    }
    return creds;
  }

  private userKey(username: string, part: string): string {
    return `u:${username.toLowerCase()}:${part}`;
  }

  /** Garante um intervalo mínimo entre o início de requisições, sem serializar a execução. */
  private waitTurn(): Promise<void> {
    const turn = this.gate.then(async () => {
      const wait = this.lastRequestAt + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastRequestAt = Date.now();
    });
    this.gate = turn;
    return turn;
  }

  private async request<T>(endpoint: string, params: Record<string, string | number>): Promise<T> {
    const { apiKey } = this.requireCredentials();
    const url = new URL(endpoint, API_BASE);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    url.searchParams.set('y', apiKey);

    for (let attempt = 0; ; attempt++) {
      await this.waitTurn();
      let response: Response;
      try {
        response = await fetch(url, {
          headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        if (attempt < MAX_RETRIES) {
          await sleep(backoffMs(attempt, null));
          continue;
        }
        throw new AppError(
          'RA_NETWORK',
          'Não foi possível conectar ao RetroAchievements. Verifique sua conexão.',
          { cause: err },
        );
      }

      if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt, response.headers.get('retry-after')));
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        throw new AppError('RA_AUTH', 'Usuário ou Web API Key do RetroAchievements inválidos.');
      }
      if (response.status === 404) {
        throw new AppError('NOT_FOUND', 'Recurso não encontrado no RetroAchievements.');
      }
      if (!response.ok) {
        throw new AppError('RA_HTTP', `RetroAchievements respondeu com HTTP ${response.status}.`);
      }
      try {
        return (await response.json()) as T;
      } catch (err) {
        throw new AppError('RA_HTTP', 'Resposta inválida do RetroAchievements.', { cause: err });
      }
    }
  }
}
