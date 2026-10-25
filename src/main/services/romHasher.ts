import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { canIdentifyFormat, CONSOLES, ConsoleId, DISC_IMAGE_EXTENSIONS, getConsole, type ConsoleDef } from '@shared/consoles';
import { detectDiscConsole, hashDisc } from './disc/raDiscHash';
import { readZipEntry } from './store/zipExtract';

// Acima disso é quase certamente mídia de disco (hash complexo) — evita carregar GBs na memória.
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

/**
 * Conteúdo da ROM: o próprio arquivo ou, num .zip, o arquivo de dentro com a extensão do console
 * (o primeiro, na ordem do zip, como o RetroArch carrega); um zip com um arquivo só vale qualquer nome.
 */
async function romBytes(filePath: string, def: ConsoleDef): Promise<Buffer | null> {
  if (extensionOf(filePath) === 'zip') {
    const choose = (names: string[]) => names.find((n) => def.extensions.includes(extensionOf(n))) ?? (names.length === 1 ? names[0]! : null);
    return readZipEntry(filePath, choose, MAX_HASHABLE_BYTES);
  }
  const { size } = await fs.stat(filePath);
  if (size === 0 || size > MAX_HASHABLE_BYTES) return null;
  return fs.readFile(filePath);
}

/**
 * Calcula o hash no mesmo formato do rcheevos (biblioteca usada pelo RetroArch),
 * permitindo identificar a ROM na base do RetroAchievements.
 */
export async function hashRom(filePath: string, consoleId: number | null): Promise<string | null> {
  if (consoleId == null || !canAutoMatch(filePath, consoleId)) return null;
  const def = getConsole(consoleId)!;

  switch (def.hashMethod) {
    case 'filename':
      return md5(path.basename(filePath, path.extname(filePath)));
    case 'ps1':
    case 'ps2':
    case 'psp':
    case 'sega-disc':
      return hashDisc(filePath, def.hashMethod);
    case 'nds': {
      const data = await romBytes(filePath, def);
      return data ? hashNds(data) : null;
    }
    case 'file': {
      const data = await romBytes(filePath, def);
      return data && data.length > 0 ? md5(normalizeRom(data, consoleId)) : null;
    }
    default:
      return null;
  }
}

/**
 * Nintendo DS: MD5 do cabeçalho (0x160 bytes), do código ARM9 e ARM7 e do ícone (0xA00 bytes), como o
 * rcheevos. ROMs com o cabeçalho de 512 bytes do SuperCard têm tudo deslocado.
 */
export function hashNds(data: Buffer): string | null {
  if (data.length < 0x200) return null;
  let offset = 0;
  let header = data.subarray(0, 0x200);
  const superCard =
    header[0] === 0x2e && header[1] === 0 && header[2] === 0 && header[3] === 0xea && header[0xb0] === 0x44 && header[0xb1] === 0x46 && header[0xb2] === 0x96 && header[0xb3] === 0;
  if (superCard) {
    if (data.length < 0x400) return null;
    offset = 0x200;
    header = data.subarray(0x200, 0x400);
  }
  const arm9 = header.readUInt32LE(0x20);
  const arm9Size = header.readUInt32LE(0x2c);
  const arm7 = header.readUInt32LE(0x30);
  const arm7Size = header.readUInt32LE(0x3c);
  const icon = header.readUInt32LE(0x68);
  if (arm9Size + arm7Size > 16 * 1024 * 1024) return null; // não é uma ROM de DS
  // Trecho que passe do fim do arquivo é completado com zeros (o rcheevos lê para um buffer zerado).
  const slice = (at: number, size: number) => {
    const out = Buffer.alloc(size);
    data.copy(out, 0, Math.min(data.length, at + offset), Math.min(data.length, at + offset + size));
    return out;
  };
  return createHash('md5')
    .update(header.subarray(0, 0x160))
    .update(slice(arm9, arm9Size))
    .update(slice(arm7, arm7Size))
    .update(slice(icon, 0xa00)) // sempre, como o rcheevos (ícone incompleto vira zeros)
    .digest('hex');
}

export function normalizeRom(data: Buffer, consoleId: number): Buffer {
  switch (consoleId) {
    case ConsoleId.NES: {
      // Cabeçalho iNES/FDS de 16 bytes não entra no hash.
      const magic = data.subarray(0, 4).toString('latin1');
      return magic === 'NES\x1a' || magic === 'FDS\x1a' ? data.subarray(16) : data;
    }
    case ConsoleId.SNES:
      // Cabeçalho de copiadora de 512 bytes.
      return data.length % 8192 === 512 ? data.subarray(512) : data;
    case ConsoleId.PCEngine:
      return data.length % 131072 === 512 ? data.subarray(512) : data;
    case ConsoleId.Lynx:
      return data.subarray(0, 5).toString('latin1') === 'LYNX\0' ? data.subarray(64) : data;
    case ConsoleId.Atari7800:
      return data.subarray(1, 10).toString('latin1') === 'ATARI7800' ? data.subarray(128) : data;
    case ConsoleId.N64:
      return toBigEndianN64(data);
    default:
      return data;
  }
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
