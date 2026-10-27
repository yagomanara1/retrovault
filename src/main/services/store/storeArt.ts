import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import type { PortArt, StorePort } from '@shared/store';
import type { StoreArtRepository } from '../../db/repositories/storeArtRepository';
import { AppError } from '../../errors';
import type { ApiCache } from '../apiCache';
import { defaultFetch, type FetchFn, httpGet } from '../http';
import { isAllowedArtUrl } from './catalogSchema';
import { SteamGridDbClient } from './steamGridDb';

const MAX_ART_BYTES = 10 * 1024 * 1024;
const ART_TTL_MS = 7 * 24 * 60 * 60_000;
const NO_ART: PortArt = { cover: null, hero: null, logo: null, icon: null, source: 'none' };

type ImageFormat = 'png' | 'jpg' | 'webp' | 'gif';

/** Formato pela assinatura dos bytes (o Content-Type de CDN não é confiável). */
export function imageFormat(data: Buffer): ImageFormat | null {
  if (data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'png';
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg';
  if (data.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif';
  if (data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

function isHttpsHost(url: string, host: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === host;
  } catch {
    return false;
  }
}

/**
 * Ícone do Windows (.ico): devolve a maior imagem dele em PNG. Os .ico modernos guardam o tamanho 256
 * já em PNG; os antigos só têm bitmaps, e os de 32 bits (com transparência) são convertidos. Bitmaps
 * de paleta (4 ou 8 bits) não servem; sem nenhuma imagem aproveitável: null.
 */
export function pngFromIco(data: Buffer): Buffer | null {
  if (data.length < 6 || data.readUInt16LE(0) !== 0 || data.readUInt16LE(2) !== 1) return null;
  const count = data.readUInt16LE(4);
  if (count === 0 || count > 64 || data.length < 6 + count * 16) return null;
  let best: Buffer | null = null;
  let bestSide = 0;
  let bestBmp: Buffer | null = null;
  let bestBmpSide = 0;
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16;
    const side = data[entry] || 256; // 0 = 256 px
    const size = data.readUInt32LE(entry + 8);
    const offset = data.readUInt32LE(entry + 12);
    if (offset + size > data.length || size < 8) continue;
    const image = data.subarray(offset, offset + size);
    if (imageFormat(image) === 'png') {
      if (side > bestSide) [best, bestSide] = [image, side];
    } else if (side > bestBmpSide && image.length >= 40 && image.readUInt16LE(14) === 32) {
      [bestBmp, bestBmpSide] = [image, side];
    }
  }
  // O PNG embutido ganha, a não ser que o bitmap seja maior.
  if (bestBmp && bestBmpSide > bestSide) return pngFromDib32(bestBmp) ?? best;
  return best;
}

/** Bitmap de 32 bits de um .ico (cabeçalho BITMAPINFOHEADER, linhas de baixo para cima, BGRA) em PNG. */
function pngFromDib32(dib: Buffer): Buffer | null {
  const headerSize = dib.readUInt32LE(0);
  const width = dib.readInt32LE(4);
  const height = dib.readInt32LE(8) / 2; // no .ico a altura conta também a máscara
  const compression = dib.readUInt32LE(16);
  if (headerSize < 40 || compression !== 0 || width < 1 || width > 256 || height !== width) return null;
  const rowBytes = width * 4;
  if (dib.length < headerSize + rowBytes * height) return null;
  const pixels = dib.subarray(headerSize, headerSize + rowBytes * height);
  // Ícones antigos com alfa todo zerado usam só a máscara: aí a imagem fica opaca.
  let hasAlpha = false;
  for (let i = 3; i < pixels.length && !hasAlpha; i += 4) hasAlpha = pixels[i] !== 0;
  const raw = Buffer.alloc((rowBytes + 1) * height); // cada linha começa com o filtro 0 (nenhum)
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * rowBytes;
    const dst = y * (rowBytes + 1) + 1;
    for (let x = 0; x < rowBytes; x += 4) {
      raw[dst + x] = pixels[src + x + 2];
      raw[dst + x + 1] = pixels[src + x + 1];
      raw[dst + x + 2] = pixels[src + x];
      raw[dst + x + 3] = hasAlpha ? pixels[src + x + 3] : 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8 bits por canal, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function pngChunk(type: string, body: Buffer): Buffer {
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  let crc = 0xffffffff;
  for (const byte of typed) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  const out = Buffer.alloc(typed.length + 8);
  out.writeUInt32BE(body.length, 0);
  typed.copy(out, 4);
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, typed.length + 4);
  return out;
}

/**
 * Destino de um link simbólico do git lido pelo raw.githubusercontent.com: o conteúdo é só um nome
 * de imagem (sem pastas) e o destino fica na mesma pasta. null se não for esse caso.
 */
export function gitSymlinkTarget(url: string, data: Buffer): string | null {
  if (data.length > 255 || new URL(url).hostname !== 'raw.githubusercontent.com') return null;
  const name = data.toString('utf8').trim();
  if (!/^[^/\\:*?"<>|\r\n]+\.(png|jpe?g|webp|gif)$/i.test(name)) return null;
  return `${url.slice(0, url.lastIndexOf('/') + 1)}${encodeURIComponent(name)}`;
}

interface StoreArtDeps {
  artwork: {
    /** Logos e ícones: reduzidos só se forem grandes, mantendo a transparência. */
    saveGraphic(data: Buffer, format: ImageFormat): Promise<string>;
    /** A imagem já baixada ainda existe no cofre? */
    has(url: string): Promise<boolean>;
    /** Capas (sem transparência): reduzidas e em JPEG. */
    savePhoto(data: Buffer, format: ImageFormat): Promise<string>;
  };
  repo: StoreArtRepository;
  cache: ApiCache;
  /** Chave do SteamGridDB (decifrada no main); null = só os logos dos projetos. */
  sgdbKey: () => string | null;
  fetchFn?: FetchFn;
}

/**
 * Artes da Loja. Com a chave do SteamGridDB: capa, banner, logo e ícone do jogo original. Sem ela
 * (ou se o SteamGridDB falhar): o logo que o projeto publica. As imagens são baixadas pelo main só
 * de hosts permitidos, conferidas pela assinatura e guardadas no cofre de artes (rv-media://): a
 * tela nunca carrega imagem da internet. Arte é enfeite: nenhuma falha aqui derruba a Loja.
 */
export class StoreArtService {
  private readonly fetchFn: FetchFn;
  readonly sgdb: SteamGridDbClient;

  constructor(private readonly deps: StoreArtDeps) {
    this.fetchFn = deps.fetchFn ?? defaultFetch;
    this.sgdb = new SteamGridDbClient(this.fetchFn);
  }

  /**
   * Arte em cache, conferindo que os arquivos ainda estão no cofre: se algum sumiu (apagado fora do
   * app, cofre restaurado de outro PC…), esquece o cache e monta de novo em vez de mostrar imagem quebrada.
   */
  private async cached(cacheKey: string, build: () => Promise<PortArt>): Promise<PortArt> {
    const art = await this.deps.cache.getOrFetch(cacheKey, ART_TTL_MS, build);
    const urls = [art.cover, art.hero, art.logo, art.icon].filter((u): u is string => !!u);
    const present = await Promise.all(urls.map((u) => this.deps.artwork.has(u)));
    if (present.every(Boolean)) return art;
    this.deps.cache.invalidate(cacheKey);
    return this.deps.cache.getOrFetch(cacheKey, ART_TTL_MS, build);
  }

  async art(port: StorePort): Promise<PortArt> {
    const key = this.deps.sgdbKey();
    // A chave do cache inclui o que define a arte: se o catálogo trocar o logo ou o nome de busca,
    // a arte é buscada de novo (em vez de esperar os 7 dias).
    const inputs = createHash('md5')
      .update(JSON.stringify([port.art?.logo ?? null, port.art?.boxart ?? null, port.artQuery ?? port.original.title]))
      .digest('hex')
      .slice(0, 12);
    if (key) {
      try {
        // Falha do SteamGridDB não fica em cache: na próxima vez ele é tentado de novo.
        return await this.cached(`store:art:${port.id}:sgdb:${inputs}`, () => this.fromSteamGridDb(port, key));
      } catch (err) {
        console.warn('[store] SteamGridDB indisponível; usando o logo do projeto', port.id, err);
      }
    }
    try {
      return await this.cached(`store:art:${port.id}:project:${inputs}`, () => this.fromProject(port));
    } catch (err) {
      console.warn('[store] arte indisponível', port.id, err);
      return NO_ART;
    }
  }

  /** Chave nova ou removida: as artes são buscadas de novo. */
  invalidate(): void {
    this.deps.cache.invalidate('store:art:');
  }

  referencedArtwork(): string[] {
    return this.deps.repo.localUrls();
  }

  /** Confere uma chave nova numa busca de verdade (SGDB_AUTH se for recusada). */
  async verifyKey(key: string): Promise<void> {
    await this.sgdb.search('zelda', key);
  }

  /** Artes do SteamGridDB; lança erro se não achar nada (o chamador cai para o logo do projeto). */
  private async fromSteamGridDb(port: StorePort, key: string): Promise<PortArt> {
    const game = await this.sgdb.bestMatch(port.artQuery ?? port.original.title, key);
    const urls = game ? await this.sgdb.firstOfEach(game.id, key) : {};
    const [cover, hero, logo, icon] = await Promise.all(
      ([[urls.cover, true], [urls.hero, true], [urls.logo, false], [urls.icon, false]] as const).map(([u, photo]) =>
        u ? this.importRemote(u, { photo }).catch(() => null) : null,
      ),
    );
    if (!cover && !hero && !logo && !icon) throw new AppError('NOT_FOUND', 'Nenhuma arte encontrada no SteamGridDB.');
    // O que faltar no SteamGridDB vem do catálogo (capa do libretro, logo do projeto).
    const [boxart, projectLogo] = await Promise.all([cover ? null : this.optional(port.art?.boxart, true), logo ? null : this.optional(port.art?.logo, false)]);
    return { cover: cover ?? boxart, hero, logo: logo ?? projectLogo, icon, source: 'steamgriddb' };
  }

  private async fromProject(port: StorePort): Promise<PortArt> {
    const [cover, logo] = await Promise.all([this.optional(port.art?.boxart, true), this.optional(port.art?.logo, false)]);
    // Tinha imagem no catálogo e não baixou (sem internet?): erro, para "sem arte" não ficar 7 dias em cache.
    if ((port.art?.boxart && !cover) || (port.art?.logo && !logo)) {
      throw new AppError('STORE_NETWORK', 'Não foi possível baixar as imagens do port.');
    }
    return cover || logo ? { ...NO_ART, cover, logo, source: 'project' } : NO_ART;
  }

  /** Baixa uma imagem do catálogo, se houver; falha vira null (a arte é enfeite). */
  private async optional(url: string | undefined, photo: boolean): Promise<string | null> {
    return url ? this.importRemote(url, { photo }).catch(() => null) : null;
  }

  /**
   * Baixa (uma vez só) uma imagem de host permitido e devolve o endereço local rv-media://.
   * `photo`: capa/banner (sem transparência), guardada reduzida em JPEG; logos e ícones mantêm a transparência.
   * `remember: false` (miniaturas para escolher): não registra em store_art, então a limpeza de artes
   * da inicialização apaga o que não foi escolhido.
   */
  async importRemote(url: string, opts: { photo: boolean; followLink?: boolean; remember?: boolean; host?: string }): Promise<string> {
    // `host`: outra origem permitida para quem chama (ex.: as imagens dos mods do GameBanana).
    const allowed = (u: string) => (opts.host ? isHttpsHost(u, opts.host) : isAllowedArtUrl(u));
    if (!allowed(url)) throw new AppError('FORBIDDEN', 'Imagem fora dos endereços permitidos.');
    const remember = opts.remember !== false;
    const known = remember ? this.deps.repo.get(url) : null;
    // Arquivo apagado do cofre fora do app: baixa de novo em vez de entregar um endereço quebrado.
    if (known && (await this.deps.artwork.has(known))) return known;
    const response = await httpGet(this.fetchFn, url, { offline: { code: 'STORE_NETWORK', message: 'Sem conexão para baixar a imagem.' } });
    if (response.url && !allowed(response.url)) throw new AppError('FORBIDDEN', 'A imagem foi redirecionada para fora dos endereços permitidos.');
    if (!response.ok) throw new AppError('STORE_HTTP', `Imagem respondeu com erro ${response.status}.`);
    if (Number(response.headers.get('content-length')) > MAX_ART_BYTES) throw new AppError('VALIDATION', 'Imagem grande demais.');
    const downloaded = Buffer.from(await response.arrayBuffer());
    if (downloaded.length > MAX_ART_BYTES) throw new AppError('VALIDATION', 'Imagem grande demais.');
    // Projeto que só publica o ícone do Windows: usa o PNG grande que vem dentro do .ico.
    const data = pngFromIco(downloaded) ?? downloaded;
    const format = imageFormat(data);
    if (!format) {
      // Link simbólico do git servido pelo raw.githubusercontent.com (o libretro-thumbnails usa para
      // capas repetidas): o conteúdo é o nome da capa de verdade, na mesma pasta. Segue uma vez só.
      const target = gitSymlinkTarget(url, data);
      if (opts.followLink !== false && target) {
        const local = await this.importRemote(target, { ...opts, followLink: false });
        if (remember) this.deps.repo.save(url, local);
        return local;
      }
      throw new AppError('VALIDATION', 'O arquivo baixado não é uma imagem.');
    }
    const local = opts.photo && format !== 'gif' ? await this.deps.artwork.savePhoto(data, format) : await this.deps.artwork.saveGraphic(data, format);
    if (remember) this.deps.repo.save(url, local);
    return local;
  }
}
