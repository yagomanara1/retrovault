import { promises as fs } from 'node:fs';
import path from 'node:path';
import { AppError } from '../errors';

/** Arquivo ou pasta existe? */
export function pathExists(p: string): Promise<boolean> {
  return fs.stat(p).then(
    () => true,
    () => false,
  );
}

export async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

export async function assertFile(filePath: string, message?: string): Promise<void> {
  if (!(await isFile(filePath))) {
    throw new AppError('FILE_MISSING', message ?? `Arquivo não encontrado: ${filePath}`);
  }
}

/** "Super Mario World (USA) [!].sfc" → "Super Mario World" */
export function titleFromPath(filePath: string): string {
  const base = path.basename(filePath, path.extname(filePath));
  const cleaned = base
    .replace(/[([][^)\]]*[)\]]/g, '')
    .replace(/[_.]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned || base;
}

/** Divide argumentos respeitando aspas duplas: `-a "C:\\Meus Jogos" -b` */
export function parseArgs(input: string | null | undefined): string[] {
  if (!input) return [];
  const args: string[] = [];
  const pattern = /"([^"]*)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) args.push(match[1] ?? match[2] ?? '');
  return args;
}
