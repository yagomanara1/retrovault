import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import { AppError } from '../../errors';

/** Limites contra zip malicioso ou corrompido ("zip bomb"). O maior port do catálogo tem ~20 mil arquivos. */
const MAX_ENTRIES = 100_000;
const MAX_TOTAL_BYTES = 16 * 1024 ** 3;
/** Arquivos gravados ao mesmo tempo (medido com o Ship of Harkinian, ~20 mil arquivos). */
// Acima de ~4 não ganha mais nada: o limite passa a ser o Windows criando arquivos (e o antivírus
// inspecionando cada um). Medido: 20,4 s em série → 18 s; o tar.exe nativo leva ~10 s no mesmo zip.
const WRITE_CONCURRENCY = 8;

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

export interface ExtractProgress {
  files: number;
  totalFiles: number;
}

/** Caminho seguro dentro de `root`, ou null se a entrada tentar sair dela (zip slip). */
export function safeEntryPath(root: string, fileName: string): string | null {
  // yauzl já recusa "..", absolutos e "\" (validateFileName); a checagem final é pelo caminho resolvido.
  if (yauzl.validateFileName(fileName) !== null) return null;
  const target = path.resolve(root, fileName);
  const base = path.resolve(root) + path.sep;
  return target.startsWith(base) ? target : null;
}

function isSymlink(entry: Entry): boolean {
  return ((entry.externalFileAttributes >>> 16) & S_IFMT) === S_IFLNK;
}

async function* entries(zip: ZipFile): AsyncGenerator<Entry> {
  // lazyEntries: uma entrada por vez, o próximo só é lido quando o anterior terminou de gravar.
  while (true) {
    const next = await new Promise<Entry | null>((resolve, reject) => {
      const onEntry = (e: Entry) => done(e);
      const onEnd = () => done(null);
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        zip.off('entry', onEntry);
        zip.off('end', onEnd);
        zip.off('error', onError);
      };
      const done = (e: Entry | null) => {
        cleanup();
        resolve(e);
      };
      zip.on('entry', onEntry);
      zip.on('end', onEnd);
      zip.on('error', onError);
      zip.readEntry();
    });
    if (!next) return;
    yield next;
  }
}

/**
 * Extrai um .zip em `destDir` (que deve estar vazia). Recusa entradas que saiam da pasta,
 * links simbólicos e arquivos grandes demais. Pode ser cancelada pelo `signal`.
 */
export async function extractZip(
  file: string,
  destDir: string,
  options: { signal?: AbortSignal; onProgress?: (p: ExtractProgress) => void } = {},
): Promise<{ files: number; bytes: number }> {
  let zip: ZipFile;
  try {
    // autoClose: false — com gravações em paralelo, o índice termina antes das últimas entradas
    // serem abertas; o arquivo é fechado no finally, depois de todas.
    zip = await yauzl.openPromise(file, { lazyEntries: true, autoClose: false, strictFileNames: false, validateEntrySizes: true });
  } catch (err) {
    throw new AppError('VALIDATION', 'O arquivo baixado não é um .zip válido.', { cause: err });
  }
  if (zip.entryCount > MAX_ENTRIES) {
    zip.close();
    throw new AppError('VALIDATION', 'O pacote tem arquivos demais para ser um port.');
  }

  let files = 0;
  let bytes = 0;
  // Uma criação por pasta, mesmo com várias gravações pedindo a mesma pasta ao mesmo tempo.
  const madeDirs = new Map<string, Promise<unknown>>();
  const ensureDir = (dir: string) => {
    let made = madeDirs.get(dir);
    if (!made) {
      made = fs.mkdir(dir, { recursive: true });
      madeDirs.set(dir, made);
    }
    return made;
  };

  // Gravações em paralelo: com milhares de arquivos pequenos o custo é abrir/fechar arquivo
  // (e o antivírus inspecionar cada um), não ler o zip. As checagens continuam por entrada.
  const pending = new Set<Promise<void>>();
  let failure: unknown = null;

  try {
    for await (const entry of entries(zip)) {
      if (failure) throw failure;
      options.signal?.throwIfAborted();
      const target = safeEntryPath(destDir, entry.fileName);
      if (!target) throw new AppError('VALIDATION', `O pacote tem um caminho inseguro ("${entry.fileName}") e foi recusado.`);
      if (isSymlink(entry)) throw new AppError('VALIDATION', 'O pacote contém links simbólicos e foi recusado.');

      if (entry.fileName.endsWith('/')) {
        await ensureDir(target);
        continue;
      }
      bytes += entry.uncompressedSize;
      if (bytes > MAX_TOTAL_BYTES) throw new AppError('VALIDATION', 'O pacote descompactado é grande demais.');

      const task: Promise<void> = (async () => {
        await ensureDir(path.dirname(target));
        const stream = await zip.openReadStreamPromise(entry);
        // "wx": nunca sobrescreve (duas entradas com o mesmo nome = pacote inválido).
        await pipeline(stream, createWriteStream(target, { flags: 'wx' }), { signal: options.signal });
        files++;
        options.onProgress?.({ files, totalFiles: zip.entryCount });
      })()
        .catch((err: unknown) => {
          failure ??= err;
        })
        .finally(() => pending.delete(task));
      pending.add(task);
      if (pending.size >= WRITE_CONCURRENCY) await Promise.race(pending);
    }
    await Promise.all(pending);
    if (failure) throw failure;
  } finally {
    await Promise.allSettled(pending);
    zip.close();
  }
  return { files, bytes };
}

/**
 * Lê para a memória um arquivo de dentro de um .zip, escolhido pelo nome (ex.: a ROM de um jogo compactado).
 * `choose` recebe os nomes dos arquivos (sem pastas) e devolve o escolhido; null se nenhum servir ou se o
 * escolhido passar de `maxBytes`.
 */
export async function readZipEntry(file: string, choose: (names: string[]) => string | null, maxBytes: number): Promise<Buffer | null> {
  const zip = await yauzl.openPromise(file, { lazyEntries: true, autoClose: false, strictFileNames: false, validateEntrySizes: true });
  try {
    if (zip.entryCount > MAX_ENTRIES) return null;
    const found: Entry[] = [];
    for await (const entry of entries(zip)) if (!entry.fileName.endsWith('/') && !isSymlink(entry)) found.push(entry);
    const name = choose(found.map((e) => e.fileName));
    const entry = found.find((e) => e.fileName === name);
    if (!entry || entry.uncompressedSize > maxBytes) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of await zip.openReadStreamPromise(entry)) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  } finally {
    zip.close();
  }
}

/**
 * Pasta com o conteúdo de verdade: se o zip tem uma única pasta no topo (ex.: "pd-x86_64-windows/"),
 * é ela; senão, a própria pasta de extração.
 */
export async function contentRoot(dir: string): Promise<string> {
  const items = await fs.readdir(dir, { withFileTypes: true });
  return items.length === 1 && items[0]!.isDirectory() ? path.join(dir, items[0]!.name) : dir;
}
