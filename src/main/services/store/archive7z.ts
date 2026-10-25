import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { AppError } from '../../errors';
import { safeEntryPath, type ExtractProgress } from './zipExtract';

const MAX_ENTRIES = 100_000;

/** Pacotes abertos pelo tar.exe (o resto é .zip, aberto pelo yauzl). */
export const TAR_FORMATS = /\.(7z|tar\.gz|tgz|tar\.xz|txz|tar)$/i;

/**
 * O tar.exe do Windows (bsdtar/libarchive, no System32 desde o Windows 10 1803) lê .7z e .tar.gz:
 * sem dependência nova no app. Caminho absoluto: nunca um "tar.exe" qualquer que esteja no PATH.
 * O bsdtar já recusa por padrão caminhos absolutos e ".." ao extrair; a listagem é conferida antes.
 */
export function systemTar(): string {
  return path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
}

/** Roda o tar e devolve a saída; cancela (mata o processo) pelo signal. */
function runTar(
  args: string[],
  options: { signal?: AbortSignal; onLine?: (line: string) => void; tar?: string } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.tar ?? systemTar(), args, { windowsHide: true });
    let out = '';
    let err = '';
    let partial = '';
    const onAbort = () => child.kill();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => {
      const text = partial + d.toString('utf8');
      const lines = text.split(/\r?\n/);
      partial = lines.pop() ?? '';
      for (const line of lines) {
        if (options.onLine) options.onLine(line);
        else err += `${line}\n`;
      }
    });
    child.on('error', (e) => {
      options.signal?.removeEventListener('abort', onAbort);
      reject(new AppError('VALIDATION', 'Este Windows não tem o extrator de pacotes (tar.exe).', { cause: e }));
    });
    child.on('close', (code) => {
      options.signal?.removeEventListener('abort', onAbort);
      if (options.signal?.aborted) return reject(options.signal.reason);
      if (code === 0) resolve(out);
      else reject(new AppError('VALIDATION', `O pacote não pôde ser extraído${err.trim() ? `: ${err.trim().split('\n')[0]}` : ''}.`));
    });
  });
}

/**
 * Confere a listagem do pacote antes de extrair: cada caminho tem de ficar dentro de `destDir`.
 * "./" no começo (pacotes criados a partir de uma pasta) é inofensivo; "..", unidade e "/" não.
 */
export function checkListing(listing: string, destDir: string): string[] {
  const names = listing
    .split(/\r?\n/)
    .map((n) => n.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, ''))
    .filter((n) => n && n !== '.');
  if (names.length > MAX_ENTRIES) throw new AppError('VALIDATION', 'O pacote tem arquivos demais para ser um port.');
  for (const name of names) {
    if (!safeEntryPath(destDir, name)) throw new AppError('VALIDATION', `O pacote tem um caminho inseguro ("${name}") e foi recusado.`);
  }
  return names;
}

async function findSymlink(dir: string): Promise<string | null> {
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isSymbolicLink()) return full;
    if (item.isDirectory()) {
      const found = await findSymlink(full);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Extrai um .7z ou .tar.gz em `destDir` com as mesmas garantias do .zip: o conteúdo é listado e cada caminho
 * conferido ANTES de extrair (nada fora da pasta), e links simbólicos são recusados depois.
 */
export async function extract7z(
  file: string,
  destDir: string,
  options: { signal?: AbortSignal; onProgress?: (p: ExtractProgress) => void; tar?: string } = {},
): Promise<{ files: number }> {
  const names = checkListing(await runTar(['-tf', file], { signal: options.signal, tar: options.tar }), destDir);
  const totalFiles = names.filter((n) => !n.endsWith('/')).length;
  let files = 0;
  // -v manda "x caminho" para o stderr a cada item: serve de progresso.
  await runTar(['-xvf', file, '-C', destDir], {
    signal: options.signal,
    tar: options.tar,
    onLine: (line) => {
      if (/^x\s/.test(line) && !/[/\\]$/.test(line) && !/^x\s+\.$/.test(line)) options.onProgress?.({ files: ++files, totalFiles });
    },
  });
  const link = await findSymlink(destDir);
  if (link) throw new AppError('VALIDATION', 'O pacote contém links simbólicos e foi recusado.');
  return { files: totalFiles };
}
