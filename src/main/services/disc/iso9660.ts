import { SECTOR_DATA, type DiscImage } from './discImage';

/** Arquivo no disco: setor inicial (LBA) e tamanho em bytes. */
export interface DiscFile {
  lba: number;
  size: number;
}

/** Pastas maiores que isso não existem em jogo de verdade (proteção contra imagem corrompida). */
const MAX_DIR_BYTES = 4 * 1024 * 1024;

/** Nome no disco → comparação: maiúsculas, sem a versão ";1" e sem o ponto final de nomes sem extensão. */
function normalizeName(name: string): string {
  return name.replace(/;\d+$/, '').replace(/\.$/, '').toUpperCase();
}

/** Registros de uma pasta: cada um com nome, setor, tamanho e se é pasta. Registros não cruzam setores. */
function* dirRecords(data: Buffer): Generator<{ name: string; file: DiscFile; isDir: boolean }> {
  let at = 0;
  while (at < data.length) {
    const len = data[at]!;
    if (len === 0) {
      at = (Math.floor(at / SECTOR_DATA) + 1) * SECTOR_DATA; // resto do setor vazio
      continue;
    }
    if (len < 34 || at + len > data.length) return;
    const nameLen = data[at + 32]!;
    const rawName = data.subarray(at + 33, at + 33 + nameLen);
    // 0x00 e 0x01 são "." e ".."
    if (!(nameLen === 1 && rawName[0]! <= 1)) {
      yield {
        name: rawName.toString('latin1'),
        file: { lba: data.readUInt32LE(at + 2), size: data.readUInt32LE(at + 10) },
        isDir: (data[at + 25]! & 0x02) !== 0,
      };
    }
    at += len;
  }
}

/** Pasta raiz, pelo descritor primário do volume (setor 16). */
async function rootDirectory(disc: DiscImage): Promise<DiscFile> {
  const pvd = await disc.readSectors(16, 1);
  if (pvd.length < 190 || pvd[0] !== 1 || pvd.toString('latin1', 1, 6) !== 'CD001') throw new Error('não é um disco ISO 9660');
  return { lba: pvd.readUInt32LE(156 + 2), size: pvd.readUInt32LE(156 + 10) };
}

/**
 * Acha um arquivo pelo caminho (separado por "\" ou "/", sem diferença de maiúsculas, como o rcheevos).
 * null se não existir.
 */
export async function findDiscFile(disc: DiscImage, filePath: string): Promise<DiscFile | null> {
  const parts = filePath.split(/[\\/]+/).filter(Boolean).map(normalizeName);
  if (parts.length === 0) return null;
  let dir = await rootDirectory(disc);
  for (const part of parts) {
    if (dir.size > MAX_DIR_BYTES) return null;
    // Como o rcheevos: pasta com tamanho 0 no registro ainda tem um setor; e a entrada é achada só pelo
    // nome, sem olhar a marca de pasta (gravadores de imagem nem sempre a preenchem certo).
    const sectors = Math.max(1, Math.ceil(dir.size / SECTOR_DATA));
    const data = await disc.readSectors(dir.lba, sectors);
    const hit = [...dirRecords(data)].find((r) => normalizeName(r.name) === part);
    if (!hit) return null;
    dir = hit.file;
  }
  return dir;
}

/** Conteúdo de um arquivo do disco, até `maxBytes` (o rcheevos também limita). */
export async function readDiscFile(disc: DiscImage, file: DiscFile, maxBytes: number): Promise<Buffer> {
  const size = Math.min(file.size, maxBytes);
  const data = await disc.readSectors(file.lba, Math.ceil(size / SECTOR_DATA));
  return data.subarray(0, size);
}
