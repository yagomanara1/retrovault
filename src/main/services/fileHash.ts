import { createHash } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';

/** Tamanho de cada leitura: a memória fica em ~1 MB e o main atende o IPC entre um pedaço e outro. */
export const HASH_CHUNK_BYTES = 1024 * 1024;

/**
 * Lê `length` bytes a partir de `position` (repete se o sistema entregar menos de uma vez). O que passar do
 * fim do arquivo fica com zeros, como o rcheevos faz ao ler para um buffer zerado.
 */
export async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const out = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await handle.read(out, filled, length - filled, position + filled);
    if (bytesRead === 0) break; // fim do arquivo
    filled += bytesRead;
  }
  return out;
}

/**
 * MD5 de [start, end) do arquivo, em pedaços. `swap` reordena cada pedaço (2 ou 4 bytes, para ROMs de N64
 * em .v64/.n64): os pedaços têm tamanho múltiplo de 4, então a troca nunca corta uma palavra ao meio.
 */
export async function md5Range(handle: FileHandle, start: number, end: number, swap: 0 | 2 | 4 = 0): Promise<string> {
  const hash = createHash('md5');
  for (let pos = start; pos < end; pos += HASH_CHUNK_BYTES) {
    const chunk = await readAt(handle, pos, Math.min(HASH_CHUNK_BYTES, end - pos));
    if (swap === 2) chunk.swap16();
    else if (swap === 4) chunk.swap32();
    hash.update(chunk);
  }
  return hash.digest('hex');
}
