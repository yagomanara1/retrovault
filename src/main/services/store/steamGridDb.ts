import { wordKey } from '@shared/text';
import { AppError } from '../../errors';
import { defaultFetch, type FetchFn, httpGet } from '../http';
import { isAllowedArtUrl } from './catalogSchema';

const SGDB_API = 'https://www.steamgriddb.com/api/v2';
/** Sem conteúdo adulto nem "humor" (paródias): é a capa do jogo na biblioteca. */
const SAFE = 'nsfw=false&humor=false';

export interface SgdbGame {
  id: number;
  name: string;
}

/** Uma imagem do SteamGridDB: `url` é o arquivo inteiro e `thumb` a miniatura (para escolher). */
export interface SgdbImage {
  url: string;
  thumb: string;
  width: number;
  height: number;
}

/** Tipos de arte: capa vertical (grid 600x900), banner largo (hero), logo e ícone quadrado. */
export type SgdbKind = 'cover' | 'hero' | 'logo' | 'icon';

const PATHS: Record<SgdbKind, (gameId: number) => string> = {
  cover: (id) => `/grids/game/${id}?dimensions=600x900&${SAFE}`,
  hero: (id) => `/heroes/game/${id}?${SAFE}`,
  logo: (id) => `/logos/game/${id}?${SAFE}`,
  icon: (id) => `/icons/game/${id}?${SAFE}`,
};

export const normalizeTitle = wordKey;

/**
 * Cliente da API v2 do SteamGridDB (chave do usuário, decifrada no main). Usado pela Loja e pela
 * biblioteca. Só devolve imagens de hosts permitidos; quem baixa é o chamador.
 */
export class SteamGridDbClient {
  private readonly fetchFn: FetchFn;

  constructor(fetchFn?: FetchFn) {
    this.fetchFn = fetchFn ?? defaultFetch;
  }

  /** Jogos com nome parecido, na ordem do SteamGridDB (o mais provável primeiro). */
  search(title: string, key: string): Promise<SgdbGame[]> {
    return this.get<SgdbGame[]>(`/search/autocomplete/${encodeURIComponent(title)}`, key);
  }

  /** O jogo de nome igual ao procurado, ou o primeiro resultado. */
  async bestMatch(title: string, key: string): Promise<SgdbGame | null> {
    const games = await this.search(title, key);
    const wanted = normalizeTitle(title);
    return games.find((g) => normalizeTitle(g.name) === wanted) ?? games[0] ?? null;
  }

  /** Imagens de um tipo, mais votadas primeiro; só as de hosts permitidos. */
  async images(gameId: number, kind: SgdbKind, key: string, limit = 12): Promise<SgdbImage[]> {
    const list = await this.get<Array<Partial<SgdbImage>>>(PATHS[kind](gameId), key);
    return list
      .filter((i): i is SgdbImage => !!i.url && isAllowedArtUrl(i.url))
      .map((i) => ({ url: i.url, thumb: i.thumb && isAllowedArtUrl(i.thumb) ? i.thumb : i.url, width: i.width ?? 0, height: i.height ?? 0 }))
      .slice(0, limit);
  }

  /** A primeira imagem de cada tipo (falha num tipo não derruba os outros). */
  async firstOfEach(gameId: number, key: string): Promise<Partial<Record<SgdbKind, string>>> {
    const kinds: SgdbKind[] = ['cover', 'hero', 'logo', 'icon'];
    const urls = await Promise.all(kinds.map((k) => this.images(gameId, k, key, 1).then((l) => l[0]?.url, () => undefined)));
    return Object.fromEntries(kinds.map((k, i) => [k, urls[i]]).filter(([, u]) => u));
  }

  private async get<T>(path: string, key: string): Promise<T> {
    const response = await httpGet(this.fetchFn, `${SGDB_API}${path}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      offline: { code: 'STORE_NETWORK', message: 'Sem conexão com o SteamGridDB.' },
    });
    if (response.status === 401 || response.status === 403) {
      throw new AppError('SGDB_AUTH', 'O SteamGridDB recusou esta chave. Confira se ela foi copiada inteira.');
    }
    // O site às vezes responde 200 com HTML vazio quando está instável: isso não é uma resposta da API.
    const isJson = (response.headers.get('content-type') ?? '').includes('application/json');
    if (!isJson) throw new AppError('STORE_HTTP', 'O SteamGridDB não está respondendo direito agora. Tente mais tarde.');
    const body = (await response.json()) as { success?: boolean; data?: T; errors?: string[] };
    if (!response.ok || !body.success) {
      throw new AppError('STORE_HTTP', `O SteamGridDB respondeu com erro (${body.errors?.join(', ') || response.status}).`);
    }
    return body.data as T;
  }
}
