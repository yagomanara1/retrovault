import type { ModSort } from '@shared/mods';
import { AppError } from '../../errors';
import type { ApiCache } from '../apiCache';
import { defaultFetch, type FetchFn, httpGet } from '../http';

const API = 'https://gamebanana.com/apiv11';
const LIST_TTL_MS = 15 * 60_000;
const DETAILS_TTL_MS = 30 * 60_000;
export const MODS_PER_PAGE = 24;
/** Imagens dos mods: só deste host (o main baixa; a tela nunca carrega da internet). */
export const GAMEBANANA_IMAGE_HOST = 'images.gamebanana.com';

const SORT: Record<ModSort, string> = { popular: 'Generic_MostLiked', newest: 'Generic_Newest', downloads: 'Generic_MostDownloaded' };

interface RawImage {
  _sBaseUrl?: string;
  _sFile?: string;
  _sFile220?: string;
  _sFile530?: string;
}
interface RawMod {
  _idRow: number;
  _sName: string;
  _sProfileUrl: string;
  _sVersion?: string;
  _tsDateUpdated?: number;
  _tsDateModified?: number;
  _nLikeCount?: number;
  _bHasContentRatings?: boolean;
  _bIsObsolete?: boolean;
  _aRootCategory?: { _sName?: string };
  _aCategory?: { _sName?: string };
  _aSubmitter?: { _sName?: string };
  _aPreviewMedia?: { _aImages?: RawImage[] };
}
interface RawFile {
  _idRow: number;
  _sFile: string;
  _nFilesize: number;
  _sDownloadUrl: string;
  _sMd5Checksum?: string;
  _sAnalysisResult?: string;
  _sDescription?: string;
}
interface RawProfile extends RawMod {
  _sText?: string;
  _nDownloadCount?: number;
  _aFiles?: RawFile[];
  _bIsTrashed?: boolean;
  _bIsWithheld?: boolean;
  _bIsPrivate?: boolean;
  _aContentRatings?: unknown;
}

export interface GbModSummary {
  id: number;
  name: string;
  category: string | null;
  author: string | null;
  likes: number;
  version: string | null;
  updatedAt: number | null;
  thumbUrl: string | null;
  url: string;
}
export interface GbModDetails extends GbModSummary {
  text: string;
  imageUrls: string[];
  downloads: number;
  files: { id: number; name: string; size: number; md5: string | null; downloadUrl: string; scanOk: boolean; description: string | null }[];
}

/** HTML do texto do mod → texto simples com as quebras de linha (o app não renderiza HTML de terceiros). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/h\d|\/li|\/div)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function imageUrl(img: RawImage | undefined, size: '220' | '530'): string | null {
  if (!img?._sBaseUrl) return null;
  const file = (size === '220' ? img._sFile220 : img._sFile530) ?? img._sFile;
  if (!file) return null;
  const url = `${img._sBaseUrl}/${file}`;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === GAMEBANANA_IMAGE_HOST ? url : null;
  } catch {
    return null;
  }
}

function summary(m: RawMod): GbModSummary {
  return {
    id: m._idRow,
    name: m._sName,
    category: m._aRootCategory?._sName ?? m._aCategory?._sName ?? null,
    author: m._aSubmitter?._sName ?? null,
    likes: m._nLikeCount ?? 0,
    version: m._sVersion?.trim() || null,
    updatedAt: m._tsDateUpdated ?? m._tsDateModified ?? null,
    thumbUrl: imageUrl(m._aPreviewMedia?._aImages?.[0], '220'),
    url: `https://gamebanana.com/mods/${m._idRow}`,
  };
}

/**
 * Cliente da API pública do GameBanana (apiv11, sem conta). Lista e detalha mods de um jogo,
 * escondendo os marcados como conteúdo adulto e os obsoletos/removidos. Respostas em cache.
 */
export class GameBananaClient {
  constructor(
    private readonly cache: ApiCache,
    private readonly fetchFn: FetchFn = defaultFetch,
  ) {}

  async listMods(gameId: number, opts: { page: number; sort: ModSort; query?: string }): Promise<{ mods: GbModSummary[]; total: number }> {
    const params = new URLSearchParams({
      _nPage: String(opts.page),
      _nPerpage: String(MODS_PER_PAGE),
      '_aFilters[Generic_Game]': String(gameId),
      _sSort: SORT[opts.sort],
    });
    const query = opts.query?.trim();
    if (query) params.set('_aFilters[Generic_Name]', `contains,${query}`);
    const key = `gb:mods:${gameId}:${params.toString()}`;
    const data = await this.cache.getOrFetch(key, LIST_TTL_MS, () => this.get<{ _aRecords?: RawMod[]; _aMetadata?: { _nRecordCount?: number } }>(`/Mod/Index?${params}`));
    const mods = (data._aRecords ?? []).filter((m) => !m._bHasContentRatings && !m._bIsObsolete).map(summary);
    return { mods, total: data._aMetadata?._nRecordCount ?? mods.length };
  }

  async modDetails(modId: number): Promise<GbModDetails> {
    const p = await this.cache.getOrFetch(`gb:mod:${modId}`, DETAILS_TTL_MS, () => this.get<RawProfile>(`/Mod/${modId}/ProfilePage`));
    if (p._bIsTrashed || p._bIsWithheld || p._bIsPrivate) throw new AppError('NOT_FOUND', 'Este mod não está mais disponível no GameBanana.');
    if (p._bHasContentRatings || (Array.isArray(p._aContentRatings) ? p._aContentRatings.length : p._aContentRatings && Object.keys(p._aContentRatings).length)) {
      throw new AppError('FORBIDDEN', 'Este mod tem conteúdo adulto e não é mostrado na Loja.');
    }
    return {
      ...summary(p),
      text: htmlToText(p._sText ?? ''),
      imageUrls: (p._aPreviewMedia?._aImages ?? []).map((i) => imageUrl(i, '530')).filter((u): u is string => !!u).slice(0, 6),
      downloads: p._nDownloadCount ?? 0,
      files: (p._aFiles ?? []).map((f) => ({
        id: f._idRow,
        name: f._sFile,
        size: f._nFilesize,
        md5: /^[0-9a-f]{32}$/i.test(f._sMd5Checksum ?? '') ? f._sMd5Checksum!.toLowerCase() : null,
        downloadUrl: f._sDownloadUrl,
        scanOk: f._sAnalysisResult === 'ok',
        description: f._sDescription?.trim() || null,
      })),
    };
  }

  private async get<T>(path: string): Promise<T> {
    const response = await httpGet(this.fetchFn, `${API}${path}`, {
      headers: { Accept: 'application/json' },
      offline: { code: 'STORE_NETWORK', message: 'Sem conexão com o GameBanana.' },
    });
    if (response.status === 404) throw new AppError('NOT_FOUND', 'Não encontrado no GameBanana.');
    if (!response.ok) throw new AppError('STORE_HTTP', `O GameBanana respondeu com erro ${response.status}.`);
    try {
      return (await response.json()) as T;
    } catch (err) {
      throw new AppError('STORE_HTTP', 'O GameBanana não respondeu direito agora. Tente mais tarde.', { cause: err });
    }
  }
}
