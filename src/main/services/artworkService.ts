import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, nativeImage, shell } from 'electron';
import { AppError } from '../errors';
import { extractLargestIcon } from './peIcon';

export const ARTWORK_SCHEME = 'rv-media';
const URL_PREFIX = `${ARTWORK_SCHEME}://artwork/`;
const FILE_PATTERN = /^[a-f0-9]{32}\.(png|jpg|webp|gif)$/;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

type StoredFormat = 'png' | 'jpg' | 'webp' | 'gif';

const PASSTHROUGH: Record<string, StoredFormat> = {
  '.png': 'png',
  '.jpg': 'jpg',
  '.jpeg': 'jpg',
  '.webp': 'webp',
  '.gif': 'gif',
};
const CONVERTIBLE = new Set(['.bmp', '.ico']);
const ICON_SOURCES = new Set(['.exe', '.dll', '.lnk']);

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'ico'];

export function isLocalArtwork(url: string | null | undefined): boolean {
  return !!url && url.startsWith(URL_PREFIX);
}

/** Confere a assinatura do arquivo: a extensão sozinha não garante que é uma imagem. */
function hasImageSignature(data: Buffer, format: StoredFormat): boolean {
  switch (format) {
    case 'png':
      return data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    case 'jpg':
      return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
    case 'gif':
      return data.subarray(0, 4).toString('latin1') === 'GIF8';
    case 'webp':
      return data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP';
  }
}

/**
 * Armazena artes personalizadas em <userData>/artwork com nome = hash do conteúdo
 * (deduplicação + cache-busting automático) e as serve via protocolo rv-media://.
 */
export class ArtworkService {
  constructor(private readonly dir: string) {}

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  /** Traduz rv-media://artwork/<arquivo> em caminho local, bloqueando path traversal. */
  resolve(requestUrl: string): string | null {
    if (!requestUrl.startsWith(URL_PREFIX)) return null;
    const name = decodeURIComponent(requestUrl.slice(URL_PREFIX.length).split(/[?#]/)[0] ?? '');
    return FILE_PATTERN.test(name) ? path.join(this.dir, name) : null;
  }

  /** O arquivo de um endereço rv-media:// ainda está no cofre (pode ter sido apagado fora do app)? */
  async has(url: string): Promise<boolean> {
    const file = this.resolve(url);
    return !!file && (await fs.stat(file).then((s) => s.isFile(), () => false));
  }

  async importImage(sourcePath: string): Promise<string> {
    const ext = path.extname(sourcePath).toLowerCase();

    if (ICON_SOURCES.has(ext)) {
      const icon = await this.extractExecutableIcon(sourcePath);
      if (!icon) throw new AppError('VALIDATION', 'Não foi possível extrair um ícone deste arquivo.');
      return icon;
    }

    const stat = await fs.stat(sourcePath).catch(() => null);
    if (!stat?.isFile()) throw new AppError('FILE_MISSING', 'Imagem não encontrada.');
    if (stat.size > MAX_IMAGE_BYTES) throw new AppError('VALIDATION', 'Imagem muito grande (máximo 25 MB).');

    const format = PASSTHROUGH[ext];
    if (format) {
      const data = await fs.readFile(sourcePath);
      if (!hasImageSignature(data, format)) throw new AppError('VALIDATION', 'O arquivo não é uma imagem válida.');
      return this.store(data, format);
    }
    if (CONVERTIBLE.has(ext)) {
      const image = nativeImage.createFromPath(sourcePath);
      if (image.isEmpty()) throw new AppError('VALIDATION', 'Não foi possível ler esta imagem.');
      return this.store(image.toPNG(), 'png');
    }
    throw new AppError('VALIDATION', 'Formato não suportado. Use PNG, JPG, WEBP, GIF, BMP, ICO ou um executável.');
  }

  /** Ícone em alta resolução de um .exe/.dll/.lnk; cai para o ícone do shell se necessário. */
  async extractExecutableIcon(filePath: string): Promise<string | null> {
    let target = filePath;
    if (path.extname(filePath).toLowerCase() === '.lnk' && process.platform === 'win32') {
      try {
        const link = shell.readShortcutLink(filePath);
        target = link.icon && /\.(exe|dll|ico)$/i.test(link.icon) ? link.icon : link.target || filePath;
      } catch {
        // atalho inválido: usa o próprio .lnk no fallback
      }
    }

    try {
      if (/\.ico$/i.test(target)) {
        const image = nativeImage.createFromPath(target);
        if (!image.isEmpty()) return await this.store(image.toPNG(), 'png');
      }
      if (/\.(exe|dll)$/i.test(target)) {
        const icon = await extractLargestIcon(target);
        if (icon) {
          const png = icon.format === 'png' ? icon.data : await this.icoToPng(icon.data);
          if (png) return await this.store(png, 'png');
        }
      }
      const fallback = await app.getFileIcon(target, { size: 'large' });
      if (!fallback.isEmpty()) return await this.store(fallback.toPNG(), 'png');
    } catch (err) {
      console.warn('[artwork] falha ao extrair ícone', target, err);
    }
    return null;
  }

  /** Remove arquivos que nenhum jogo referencia mais. */
  async collectGarbage(referenced: Iterable<string | null>): Promise<void> {
    const keep = new Set<string>();
    for (const url of referenced) if (url && isLocalArtwork(url)) keep.add(url.slice(URL_PREFIX.length));
    const files = await fs.readdir(this.dir).catch(() => [] as string[]);
    await Promise.all(
      files
        .filter((f) => FILE_PATTERN.test(f) && !keep.has(f))
        .map((f) => fs.rm(path.join(this.dir, f), { force: true })),
    );
  }

  private async icoToPng(ico: Buffer): Promise<Buffer | null> {
    const tmp = path.join(os.tmpdir(), `rv-icon-${process.pid}-${Date.now()}.ico`);
    try {
      await fs.writeFile(tmp, ico);
      const image = nativeImage.createFromPath(tmp);
      return image.isEmpty() ? null : image.toPNG();
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }

  /** Salva bytes de imagem já validados (ex.: ícones de troféu extraídos do .trp). */
  saveImage(data: Buffer, format: StoredFormat): Promise<string> {
    return this.store(data, format);
  }

  /**
   * Logo ou ícone (pode ter transparência): só reduz o que passar de `maxSide` px no lado maior,
   * mantendo o formato (PNG continua PNG, com o canal alfa). GIF fica como veio (animação).
   * Logos de 2048 px e 1 MB viram ~100 KB: a lista da Loja desenha dezenas deles em 80 px.
   */
  async saveGraphic(data: Buffer, format: StoredFormat, maxSide = 512): Promise<string> {
    if (format === 'gif') return this.store(data, format);
    const image = nativeImage.createFromBuffer(data);
    if (image.isEmpty()) return this.store(data, format);
    const { width, height } = image.getSize();
    if (Math.max(width, height) <= maxSide) return this.store(data, format);
    const scaled = width >= height ? image.resize({ width: maxSide, quality: 'best' }) : image.resize({ height: maxSide, quality: 'best' });
    return format === 'jpg' ? this.store(scaled.toJPEG(88), 'jpg') : this.store(scaled.toPNG(), 'png');
  }

  /**
   * Foto sem transparência (ex.: capa de caixa): reduz para no máximo `maxHeight` px de altura e
   * recodifica em JPEG. Capas em PNG de ~800 KB viram ~60 KB e aparecem bem mais rápido nas listas.
   * Se a imagem não puder ser lida pelo Electron, guarda como veio.
   */
  async savePhoto(data: Buffer, format: StoredFormat, maxHeight = 600): Promise<string> {
    const image = nativeImage.createFromBuffer(data);
    if (image.isEmpty()) return this.store(data, format);
    const { height } = image.getSize();
    const scaled = height > maxHeight ? image.resize({ height: maxHeight, quality: 'best' }) : image;
    return this.store(scaled.toJPEG(85), 'jpg');
  }

  private async store(data: Buffer, format: StoredFormat): Promise<string> {
    const name = `${createHash('md5').update(data).digest('hex')}.${format}`;
    try {
      await fs.writeFile(path.join(this.dir, name), data, { flag: 'wx' });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    return URL_PREFIX + name;
  }
}
