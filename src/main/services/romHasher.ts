import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { md5Range, readAt } from './fileHash';
import { canIdentifyFormat, CONSOLES, ConsoleId, DISC_IMAGE_EXTENSIONS, getConsole, type ConsoleDef } from '@shared/consoles';
import { detectDiscConsole, hashDisc } from './disc/raDiscHash';
import { readZipEntry } from './store/zipExtract';

// Cartucho acima disso é quase certamente outra coisa (mídia de disco). A leitura é em pedaços: o limite
// é de sanidade, não de memória. DS não tem limite (só lê o cabeçalho e três trechos).
const MAX_HASHABLE_BYTES = 128 * 1024 * 1024;

function extensionOf(filePath: string): string {
  return path.extname(filePath).slice(1).toLowerCase();
}

export function consoleFromExtension(filePath: string): number | null {
  const ext = extensionOf(filePath);
  return CONSOLES.find((c) => c.extensions.includes(ext))?.id ?? null;
}

/**
 * Console do arquivo: pela extensão e, para imagens de disco (que servem a vários consoles), pelo conteúdo
 * do disco (SYSTEM.CNF, PSP_GAME, cabeçalho da Sega). null se não der para saber.
 */
export async function detectConsole(filePath: string): Promise<number | null> {
  const byExtension = consoleFromExtension(filePath);
  if (byExtension != null) return byExtension;
  return DISC_IMAGE_EXTENSIONS.has(extensionOf(filePath)) ? detectDiscConsole(filePath) : null;
}

export function canAutoMatch(filePath: string, consoleId: number | null): boolean {
  return canIdentifyFormat(consoleId, extensionOf(filePath));
}

const md5 = (data: Buffer | string) => createHash('md5').update(data).digest('hex');

/** ROM dentro de um .zip: o arquivo com a extensão do console (o primeiro, na ordem do zip, como o RetroArch carrega); um zip com um arquivo só vale qualquer nome. */
function zipRomBytes(filePath: string, def: ConsoleDef): Promise<Buffer | null> {
  const choose = (names: string[]) => names.find((n) => def.extensions.includes(extensionOf(n))) ?? (names.length === 1 ? names[0]! : null);
  return readZipEntry(filePath, choose, MAX_HASHABLE_BYTES);
}

/** Leitor de trechos: o que passar do fim vem com zeros (como o rcheevos, que lê para um buffer zerado). */
interface ByteSource {
  size: number;
  read(at: number, length: number): Promise<Buffer>;
}

function bufferSource(data: Buffer): ByteSource {
  return {
    size: data.length,
    async read(at, length) {
      const out = Buffer.alloc(length);
      data.copy(out, 0, Math.min(data.length, at), Math.min(data.length, at + length));
      return out;
    },
  };
}

/** Abre a ROM e entrega um leitor de trechos (sem carregar o arquivo inteiro). */
async function withFileSource<T>(filePath: string, fn: (source: ByteSource, handle: FileHandle) => Promise<T>): Promise<T> {
  const handle = await fs.open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    return await fn({ size, read: (at, length) => readAt(handle, at, length) }, handle);
  } finally {
    await handle.close();
  }
}

/**
 * Calcula o hash no mesmo formato do rcheevos (biblioteca usada pelo RetroArch),
 * permitindo identificar a ROM na base do RetroAchievements.
 */
export async function hashRom(filePath: string, consoleId: number | null): Promise<string | null> {
  if (consoleId == null || !canAutoMatch(filePath, consoleId)) return null;
  const def = getConsole(consoleId)!;
  const zipped = extensionOf(filePath) === 'zip';

  switch (def.hashMethod) {
    case 'filename':
      return md5(path.basename(filePath, path.extname(filePath)));
    case 'ps1':
    case 'ps2':
    case 'psp':
    case 'sega-disc':
      return hashDisc(filePath, def.hashMethod);
    case 'nds': {
      // Só o cabeçalho e três trechos entram no hash: arquivo solto é lido aos pedaços, de qualquer tamanho.
      if (!zipped) return withFileSource(filePath, (source) => hashNds(source));
      const data = await zipRomBytes(filePath, def);
      return data ? hashNds(data) : null;
    }
    case 'file': {
      if (!zipped) {
        return withFileSource(filePath, async (source, handle) => {
          if (source.size === 0 || source.size > MAX_HASHABLE_BYTES) return null;
          const { skip, swap } = romLayout(await source.read(0, Math.min(LAYOUT_HEAD_BYTES, source.size)), source.size, consoleId);
          return md5Range(handle, skip, source.size, swap);
        });
      }
      const data = await zipRomBytes(filePath, def);
      return data && data.length > 0 ? md5(normalizeRom(data, consoleId)) : null;
    }
    default:
      return null;
  }
}

/**
 * Nintendo DS: MD5 do cabeçalho (0x160 bytes), do código ARM9 e ARM7 e do ícone (0xA00 bytes), como o
 * rcheevos. ROMs com o cabeçalho de 512 bytes do SuperCard têm tudo deslocado. Lê só esses trechos.
 */
export async function hashNds(input: Buffer | ByteSource): Promise<string | null> {
  const source = Buffer.isBuffer(input) ? bufferSource(input) : input;
  if (source.size < 0x200) return null;
  let offset = 0;
  let header = await source.read(0, 0x200);
  const superCard =
    header[0] === 0x2e && header[1] === 0 && header[2] === 0 && header[3] === 0xea && header[0xb0] === 0x44 && header[0xb1] === 0x46 && header[0xb2] === 0x96 && header[0xb3] === 0;
  if (superCard) {
    if (source.size < 0x400) return null;
    offset = 0x200;
    header = await source.read(0x200, 0x200);
  }
  const arm9 = header.readUInt32LE(0x20);
  const arm9Size = header.readUInt32LE(0x2c);
  const arm7 = header.readUInt32LE(0x30);
  const arm7Size = header.readUInt32LE(0x3c);
  const icon = header.readUInt32LE(0x68);
  if (arm9Size + arm7Size > 16 * 1024 * 1024) return null; // não é uma ROM de DS
  return createHash('md5')
    .update(header.subarray(0, 0x160))
    .update(await source.read(arm9 + offset, arm9Size))
    .update(await source.read(arm7 + offset, arm7Size))
    .update(await source.read(icon + offset, 0xa00)) // sempre, como o rcheevos (ícone incompleto vira zeros)
    .digest('hex');
}

/** Bytes do começo da ROM que bastam para decidir o layout (o maior cabeçalho é o de 512 bytes). */
const LAYOUT_HEAD_BYTES = 512;

/**
 * Onde a ROM começa (cabeçalho de copiadora/emulador que o rcheevos ignora) e como reordenar os bytes
 * (N64 em .v64/.n64 vira .z64). Depende só do começo do arquivo e do tamanho: vale para a ROM inteira na
 * memória e para a leitura em pedaços.
 */
export function romLayout(head: Buffer, size: number, consoleId: number): { skip: number; swap: 0 | 2 | 4 } {
  switch (consoleId) {
    case ConsoleId.NES: {
      // Cabeçalho iNES/FDS de 16 bytes não entra no hash.
      const magic = head.subarray(0, 4).toString('latin1');
      return { skip: magic === 'NES\x1a' || magic === 'FDS\x1a' ? 16 : 0, swap: 0 };
    }
    case ConsoleId.SNES:
      // Cabeçalho de copiadora de 512 bytes.
      return { skip: size % 8192 === 512 ? 512 : 0, swap: 0 };
    case ConsoleId.PCEngine:
      return { skip: size % 131072 === 512 ? 512 : 0, swap: 0 };
    case ConsoleId.Lynx:
      return { skip: head.subarray(0, 5).toString('latin1') === 'LYNX\0' ? 64 : 0, swap: 0 };
    case ConsoleId.Atari7800:
      return { skip: head.subarray(1, 10).toString('latin1') === 'ATARI7800' ? 128 : 0, swap: 0 };
    case ConsoleId.N64:
      // O rcheevos (e os ports) usam N64 sempre no formato .z64 (big-endian).
      if (head[0] === 0x37 && size % 2 === 0) return { skip: 0, swap: 2 }; // .v64
      if (head[0] === 0x40 && size % 4 === 0) return { skip: 0, swap: 4 }; // .n64
      return { skip: 0, swap: 0 };
    default:
      return { skip: 0, swap: 0 };
  }
}

export function normalizeRom(data: Buffer, consoleId: number): Buffer {
  const { skip, swap } = romLayout(data, data.length, consoleId);
  const body = skip ? data.subarray(skip) : data;
  if (swap === 2) return Buffer.from(body).swap16();
  if (swap === 4) return Buffer.from(body).swap32();
  return body;
}

export type N64ByteOrder = 'z64' | 'v64' | 'n64';

/** Ordem de bytes de uma ROM de N64 pelos 4 primeiros bytes (0x80371240 em .z64); null se não for N64. */
export function n64ByteOrder(data: Buffer): N64ByteOrder | null {
  if (data.length < 0x40) return null;
  const magic = data.readUInt32BE(0);
  if (magic === 0x80371240) return 'z64';
  if (magic === 0x37804012 && data.length % 2 === 0) return 'v64';
  if (magic === 0x40123780 && data.length % 4 === 0) return 'n64';
  return null;
}

/** O rcheevos (e os ports) usam N64 sempre no formato .z64 (big-endian). */
export function toBigEndianN64(data: Buffer): Buffer {
  const first = data[0];
  if (first === 0x37 && data.length % 2 === 0) return Buffer.from(data).swap16(); // .v64
  if (first === 0x40 && data.length % 4 === 0) return Buffer.from(data).swap32(); // .n64
  return data; // .z64 (0x80) ou desconhecido
}
