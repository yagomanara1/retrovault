import type { GitHubStatus, StoreRelease } from '@shared/store';
import { AppError } from '../../errors';
import type { ApiCache } from '../apiCache';
import { defaultFetch, type FetchFn, httpGet } from '../http';
import { pickAsset } from './catalogSchema';

const API_BASE = 'https://api.github.com';
const RELEASES_PER_PAGE = 10;
const RELEASES_TTL_MS = 60 * 60_000;
const MAX_NOTES = 6000;

/** Campos usados da API de releases do GitHub (o resto é ignorado). */
interface RawRelease {
  tag_name: string;
  name: string | null;
  published_at: string | null;
  prerelease: boolean;
  draft: boolean;
  body: string | null;
  html_url: string;
  assets: { name: string; size: number; browser_download_url: string; digest?: string | null }[];
}

/** O que fica no cache: só os campos usados (a resposta do GitHub traz muito mais) e o ETag. */
interface CachedReleases {
  etag: string | null;
  raw: RawRelease[];
}

function slimRelease(r: RawRelease): RawRelease {
  const body = r.body ?? '';
  return {
    tag_name: r.tag_name,
    name: r.name,
    published_at: r.published_at,
    prerelease: r.prerelease,
    draft: r.draft,
    body: body.length > MAX_NOTES ? body.slice(0, MAX_NOTES + 1) : body,
    html_url: r.html_url,
    assets: r.assets.map((a) => ({ name: a.name, size: a.size, browser_download_url: a.browser_download_url, digest: a.digest ?? null })),
  };
}

export function mapRelease(raw: RawRelease, windowsPattern: string): StoreRelease {
  const asset = pickAsset(raw.assets, windowsPattern);
  const notes = raw.body ?? '';
  return {
    tag: raw.tag_name,
    name: raw.name?.trim() || raw.tag_name,
    publishedAt: raw.published_at,
    prerelease: raw.prerelease,
    notes: notes.length > MAX_NOTES ? `${notes.slice(0, MAX_NOTES)}…` : notes,
    htmlUrl: raw.html_url,
    windowsAsset: asset && {
      name: asset.name,
      size: asset.size,
      downloadUrl: asset.browser_download_url,
      sha256: asset.digest?.startsWith('sha256:') ? asset.digest.slice('sha256:'.length) : null,
    },
  };
}

function resetTime(header: string | null): string {
  const epoch = Number(header);
  if (!Number.isFinite(epoch) || epoch <= 0) return 'mais tarde';
  return `às ${new Date(epoch * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

interface RequestResult<T> {
  data: T | null;
  etag: string | null;
  notModified: boolean;
}

/**
 * Cliente da API pública do GitHub.
 * - Sem conta: 60 consultas/hora. Com a conta vinculada (token): 5.000/hora.
 * - Versões em cache de 1 h (stale-if-error do ApiCache) e revalidadas com ETag.
 * - Token recusado (revogado/expirado) não derruba a Loja: a consulta é refeita sem conta.
 */
export class GitHubClient {
  constructor(
    private readonly cache: ApiCache,
    /** Token da conta vinculada (decifrado sob demanda no main); null = sem conta. */
    private readonly token: () => string | null,
    private readonly fetchFn: FetchFn = defaultFetch,
  ) {}

  async listReleases(repo: string, windowsPattern: string, force = false): Promise<StoreRelease[]> {
    // A regex vem do catálogo (pode mudar sem a versão mudar): o arquivo é escolhido na leitura.
    return (await this.rawReleases(repo, force)).map((r) => mapRelease(r, windowsPattern));
  }

  /** Arquivos da versão estável mais recente (ou da prévia, se só houver prévias); null sem versões. */
  async latestAssets(repo: string): Promise<{ tag: string; assets: { name: string; size: number }[] } | null> {
    const releases = await this.rawReleases(repo);
    const latest = releases.find((r) => !r.prerelease) ?? releases[0];
    return latest ? { tag: latest.tag_name, assets: latest.assets.map((a) => ({ name: a.name, size: a.size })) } : null;
  }

  private async rawReleases(repo: string, force = false): Promise<RawRelease[]> {
    const key = `store:releases:${repo.toLowerCase()}`;
    const entry = await this.cache.getOrFetch<CachedReleases>(
      key,
      RELEASES_TTL_MS,
      async () => {
        // Revalida com ETag: "304 Not Modified" não conta no limite de consultas do GitHub.
        const previous = this.cache.peek<CachedReleases>(key);
        const result = await this.request<RawRelease[]>(`/repos/${repo}/releases?per_page=${RELEASES_PER_PAGE}`, {
          etag: previous?.etag,
        });
        if (result.notModified && previous) return previous;
        return { etag: result.etag, raw: result.data!.filter((r) => !r.draft).map(slimRelease) };
      },
      { force },
    );
    return entry.raw;
  }

  /** Confere um token novo e devolve o usuário dono dele (GITHUB_AUTH se for recusado). */
  async verifyToken(token: string): Promise<string> {
    const { data } = await this.request<{ login: string }>('/user', { token, anonymousFallback: false });
    if (!data?.login) throw new AppError('GITHUB_AUTH', 'O GitHub não informou o usuário deste token.');
    return data.login;
  }

  /** Limite atual (a rota /rate_limit não gasta consulta). Sem internet: null. */
  async status(login: string | null): Promise<GitHubStatus> {
    try {
      const { data } = await this.request<{ rate: { limit: number; remaining: number; reset: number } }>('/rate_limit');
      const rate = data!.rate;
      return { login, rate: { limit: rate.limit, remaining: rate.remaining, resetAt: new Date(rate.reset * 1000).toISOString() } };
    } catch (err) {
      if (err instanceof AppError && err.code === 'STORE_NETWORK') return { login, rate: null };
      throw err;
    }
  }

  private async request<T>(
    pathAndQuery: string,
    options: { etag?: string | null; token?: string | null; anonymousFallback?: boolean } = {},
  ): Promise<RequestResult<T>> {
    const token = options.token !== undefined ? options.token : this.token();
    const response = await this.send(pathAndQuery, token, options.etag);

    if (response.status === 401 && token) {
      if (options.anonymousFallback === false) {
        throw new AppError('GITHUB_AUTH', 'O GitHub recusou este token. Confira se ele foi copiado inteiro e se não expirou.');
      }
      console.warn('[github] token recusado (expirado ou revogado); consultando sem conta');
      return this.parse<T>(await this.send(pathAndQuery, null, options.etag), options.etag);
    }
    return this.parse<T>(response, options.etag);
  }

  private async send(pathAndQuery: string, token: string | null, etag?: string | null): Promise<Response> {
    return httpGet(this.fetchFn, `${API_BASE}${pathAndQuery}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(etag ? { 'If-None-Match': etag } : {}),
      },
      offline: { code: 'STORE_NETWORK', message: 'Sem conexão com o GitHub. Verifique a internet e tente de novo.' },
    });
  }

  private async parse<T>(response: Response, etag?: string | null): Promise<RequestResult<T>> {
    if (response.status === 304) return { data: null, etag: etag ?? null, notModified: true };
    if (response.ok) return { data: (await response.json()) as T, etag: response.headers.get('etag'), notModified: false };

    const remaining = response.headers.get('x-ratelimit-remaining');
    if ((response.status === 403 || response.status === 429) && remaining === '0') {
      const limit = Number(response.headers.get('x-ratelimit-limit'));
      const anonymous = !Number.isFinite(limit) || limit <= 60;
      throw new AppError(
        'RATE_LIMITED',
        anonymous
          ? `O GitHub limita consultas sem conta a 60 por hora e o limite acabou. Tente de novo ${resetTime(response.headers.get('x-ratelimit-reset'))} ou vincule sua conta do GitHub (5.000 por hora).`
          : `O limite de consultas da sua conta do GitHub acabou. Tente de novo ${resetTime(response.headers.get('x-ratelimit-reset'))}.`,
      );
    }
    if (response.status === 404) throw new AppError('NOT_FOUND', 'Repositório do port não encontrado no GitHub.');
    throw new AppError('STORE_HTTP', `O GitHub respondeu com erro ${response.status}.`);
  }
}
