import { promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

/** Bytes de dados de um setor de CD/DVD (o que o sistema de arquivos ISO 9660 enxerga). */
export const SECTOR_DATA = 2048;
/** Setor "cru" de CD: sincronismo + cabeçalho + dados + correção de erros. */
const RAW_SECTOR = 2352;
const SYNC = Buffer.from([0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00]);
// Formatos abertos aqui: DISC_IMAGE_EXTENSIONS (@shared/consoles). CHD e PBP, compactados, não.
const MAX_SHEET_BYTES = 64 * 1024;

/** Uma imagem de disco aberta: lê setores lógicos (2048 bytes de dados cada) a partir do LBA. */
export interface DiscImage {
  readSectors(lba: number, count: number): Promise<Buffer>;
  close(): Promise<void>;
}

/** Trilha de dados dentro de um arquivo: onde começa, tamanho do setor no arquivo e onde ficam os dados nele. */
interface Track {
  file: string;
  start: number;
  sectorSize: number;
  dataOffset: number;
}

class PlainTrackImage implements DiscImage {
  constructor(
    private readonly handle: FileHandle,
    private readonly track: Track,
  ) {}

  async readSectors(lba: number, count: number): Promise<Buffer> {
    const { start, sectorSize, dataOffset } = this.track;
    if (sectorSize === SECTOR_DATA) {
      const out = Buffer.alloc(count * SECTOR_DATA);
      const { bytesRead } = await this.handle.read(out, 0, out.length, start + lba * SECTOR_DATA);
      return out.subarray(0, bytesRead);
    }
    // Setores crus: lê o bloco inteiro e tira cabeçalho e correção de erros de cada um.
    const raw = Buffer.alloc(count * sectorSize);
    const { bytesRead } = await this.handle.read(raw, 0, raw.length, start + lba * sectorSize);
    const whole = Math.floor(bytesRead / sectorSize);
    const out = Buffer.alloc(whole * SECTOR_DATA);
    for (let i = 0; i < whole; i++) raw.copy(out, i * SECTOR_DATA, i * sectorSize + dataOffset, i * sectorSize + dataOffset + SECTOR_DATA);
    return out;
  }

  close(): Promise<void> {
    return this.handle.close();
  }
}

/**
 * CSO v1 (ISO compactado do PSP): blocos de 2048 bytes, cada um guardado inteiro ou comprimido com deflate.
 * Índice logo após o cabeçalho de 24 bytes; o bit mais alto da entrada diz "não comprimido".
 */
class CsoImage implements DiscImage {
  private constructor(
    private readonly handle: FileHandle,
    private readonly index: Uint32Array,
    private readonly blockSize: number,
    private readonly align: number,
  ) {}

  static async open(handle: FileHandle): Promise<CsoImage> {
    const head = Buffer.alloc(24);
    await handle.read(head, 0, 24, 0);
    if (head.toString('latin1', 0, 4) !== 'CISO') throw new Error('não é um arquivo CSO');
    const total = Number(head.readBigUInt64LE(8));
    const blockSize = head.readUInt32LE(16);
    const version = head[20]!;
    if (blockSize !== SECTOR_DATA || version > 1) throw new Error(`CSO v${version} com blocos de ${blockSize} bytes não é suportado`);
    const blocks = Math.ceil(total / blockSize);
    if (blocks > 4_000_000) throw new Error('CSO grande demais');
    const raw = Buffer.alloc((blocks + 1) * 4);
    await handle.read(raw, 0, raw.length, 24);
    const index = new Uint32Array(blocks + 1);
    for (let i = 0; i <= blocks; i++) index[i] = raw.readUInt32LE(i * 4);
    return new CsoImage(handle, index, blockSize, head[21]!);
  }

  async readSectors(lba: number, count: number): Promise<Buffer> {
    const parts: Buffer[] = [];
    for (let block = lba; block < lba + count && block + 1 < this.index.length; block++) {
      const entry = this.index[block]!;
      const next = this.index[block + 1]!;
      const at = (entry & 0x7fffffff) * 2 ** this.align;
      const end = (next & 0x7fffffff) * 2 ** this.align;
      const stored = Buffer.alloc(Math.max(0, Math.min(end - at, this.blockSize * 2)));
      await this.handle.read(stored, 0, stored.length, at);
      parts.push(entry & 0x80000000 ? stored.subarray(0, this.blockSize) : inflateRawSync(stored).subarray(0, this.blockSize));
    }
    return Buffer.concat(parts);
  }

  close(): Promise<void> {
    return this.handle.close();
  }
}

/** Minutos:segundos:quadros de um CUE → quadros (75 por segundo). */
function msfToFrames(msf: string): number {
  const [m, s, f] = msf.split(':').map(Number);
  return ((m ?? 0) * 60 + (s ?? 0)) * 75 + (f ?? 0);
}

/** Tamanho do setor e posição dos dados dentro dele, pelo modo da trilha no CUE. */
const TRACK_MODES: Record<string, { sectorSize: number; dataOffset: number }> = {
  'MODE1/2048': { sectorSize: 2048, dataOffset: 0 },
  'MODE1/2352': { sectorSize: 2352, dataOffset: 16 },
  'MODE2/2352': { sectorSize: 2352, dataOffset: 24 }, // Mode 2 Form 1 (PS1, PS2, Saturn)
  'MODE2/2336': { sectorSize: 2336, dataOffset: 8 },
};

/** Primeira trilha de dados de um .cue (o jogo; as de áudio vêm depois). */
export function parseCue(text: string, cueDir: string): Track | null {
  let file: string | null = null;
  let mode: string | null = null;
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    const fileMatch = line.match(/^FILE\s+(?:"([^"]+)"|(\S+))/i);
    if (fileMatch) {
      file = fileMatch[1] ?? fileMatch[2]!;
      mode = null;
      continue;
    }
    const trackMatch = line.match(/^TRACK\s+\d+\s+(\S+)/i);
    if (trackMatch) {
      mode = trackMatch[1]!.toUpperCase();
      continue;
    }
    const indexMatch = line.match(/^INDEX\s+01\s+(\d+:\d+:\d+)/i);
    if (indexMatch && file && mode && TRACK_MODES[mode]) {
      const { sectorSize, dataOffset } = TRACK_MODES[mode]!;
      // Só o nome do arquivo: um .cue não pode apontar para fora da própria pasta.
      return { file: path.join(cueDir, path.basename(file)), start: msfToFrames(indexMatch[1]!) * sectorSize, sectorSize, dataOffset };
    }
  }
  return null;
}

/** Primeiro disco de um .m3u (lista de discos de um jogo). */
export function parseM3u(text: string, m3uDir: string): string | null {
  const first = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'));
  return first ? path.join(m3uDir, path.basename(first)) : null;
}

/**
 * Formato dos setores pelo próprio conteúdo, como o rcheevos (cdreader_determine_sector_size): o modo
 * declarado no .cue pode estar errado. Procura o sincronismo de CD no setor 16 (2352 ou 2336 bytes por
 * setor) e, nele, "CD001" para saber se os dados começam no byte 24 (modo 2) ou 16 (modo 1); sem
 * sincronismo, "CD001" num setor de 2048. null se nada bater.
 */
async function detectLayout(handle: FileHandle, start: number): Promise<Pick<Track, 'sectorSize' | 'dataOffset'> | null> {
  const head = Buffer.alloc(32);
  const at = async (sectorSize: number) => {
    head.fill(0);
    await handle.read(head, 0, 32, start + 16 * sectorSize);
    return head;
  };
  for (const sectorSize of [RAW_SECTOR, 2336]) {
    if ((await at(sectorSize)).subarray(0, 12).equals(SYNC)) return { sectorSize, dataOffset: head.toString('latin1', 25, 30) === 'CD001' ? 24 : 16 };
  }
  if ((await at(SECTOR_DATA)).toString('latin1', 1, 6) === 'CD001') return { sectorSize: SECTOR_DATA, dataOffset: 0 };
  return null;
}

/** Trilha de um .iso/.bin/.img solto: pelo conteúdo; sem pistas, pelo tamanho do arquivo (como o rcheevos). */
async function detectPlainTrack(handle: FileHandle, file: string): Promise<Track> {
  const layout = await detectLayout(handle, 0);
  if (layout) return { file, start: 0, ...layout };
  const { size } = await handle.stat();
  if (size % RAW_SECTOR === 0) return { file, start: 0, sectorSize: RAW_SECTOR, dataOffset: 24 };
  if (size % SECTOR_DATA === 0) return { file, start: 0, sectorSize: SECTOR_DATA, dataOffset: 0 };
  if (size % 2336 === 0) return { file, start: 0, sectorSize: 2336, dataOffset: 8 };
  return { file, start: 0, sectorSize: SECTOR_DATA, dataOffset: 0 }; // imagem truncada: lê o que houver
}

async function readSheet(file: string): Promise<string> {
  const { size } = await fs.stat(file);
  if (size > MAX_SHEET_BYTES) throw new Error('arquivo de índice grande demais');
  return fs.readFile(file, 'utf8');
}

/** Abre uma imagem de disco (ISO, BIN/IMG, CUE, CSO ou M3U → primeiro disco). */
export async function openDiscImage(file: string, depth = 0): Promise<DiscImage> {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (ext === 'm3u') {
    const disc = depth === 0 ? parseM3u(await readSheet(file), path.dirname(file)) : null;
    if (!disc) throw new Error('lista .m3u vazia');
    return openDiscImage(disc, depth + 1);
  }
  if (ext === 'cue') {
    const track = parseCue(await readSheet(file), path.dirname(file));
    if (!track) throw new Error('o .cue não tem trilha de dados');
    const handle = await fs.open(track.file, 'r');
    try {
      // O conteúdo manda; o modo do .cue só vale se o conteúdo não disser nada.
      return new PlainTrackImage(handle, { ...track, ...(await detectLayout(handle, track.start)) });
    } catch (err) {
      await handle.close();
      throw err;
    }
  }
  const handle = await fs.open(file, 'r');
  try {
    if (ext === 'cso') return await CsoImage.open(handle);
    return new PlainTrackImage(handle, await detectPlainTrack(handle, file));
  } catch (err) {
    await handle.close();
    throw err;
  }
}
