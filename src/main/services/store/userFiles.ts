import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Arquivos do usuário dentro da pasta de um port (saves, configurações, o .o2r gerado da ROM, mods…).
 *
 * Na instalação, a lista dos arquivos do pacote fica num manifesto na própria pasta. Tudo que estiver
 * lá e não constar no manifesto foi criado depois (pelo jogo ou pelo usuário) e é levado para a
 * versão nova ao atualizar, ou de volta ao voltar para a anterior.
 */
export const MANIFEST = '.retrovault-files.json';

/** Caminhos relativos (com "/") de todos os arquivos da pasta, sem o manifesto. */
export async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (current: string, prefix: string) => {
    for (const item of await fs.readdir(current, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) await walk(path.join(current, item.name), rel);
      else if (item.isFile() && rel !== MANIFEST) out.push(rel);
    }
  };
  await walk(dir, '');
  return out;
}

/** No Windows nomes não diferenciam maiúsculas: compara sempre em minúsculas. */
const key = (rel: string) => rel.toLowerCase();

export async function writeManifest(dir: string, files: readonly string[]): Promise<void> {
  await fs.writeFile(path.join(dir, MANIFEST), JSON.stringify({ version: 1, files }), 'utf8');
}

/** Arquivos do pacote registrados na instalação; null se a pasta é de antes do manifesto. */
export async function readManifest(dir: string): Promise<Set<string> | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(dir, MANIFEST), 'utf8')) as { files?: unknown };
    return Array.isArray(parsed.files) ? new Set(parsed.files.filter((f): f is string => typeof f === 'string').map(key)) : null;
  } catch {
    return null;
  }
}

/**
 * Copia os arquivos do usuário de `fromDir` para `toDir` (sobrescrevendo: os mais novos valem).
 * Arquivos que fazem parte do pacote de destino nunca são substituídos.
 * Sem manifesto na origem (instalação antiga), "do usuário" = tudo que não vem no pacote de destino.
 */
export async function carryUserFiles(fromDir: string, toDir: string, toPackage: ReadonlySet<string>): Promise<number> {
  const fromPackage = await readManifest(fromDir);
  let copied = 0;
  for (const rel of await listFiles(fromDir)) {
    const k = key(rel);
    if (fromPackage?.has(k) || toPackage.has(k)) continue;
    const target = path.join(toDir, ...rel.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(fromDir, ...rel.split('/')), target);
    copied++;
  }
  return copied;
}

/** Conjunto (em minúsculas) dos arquivos do pacote de uma pasta: o manifesto, ou o que está lá. */
export async function packageFilesOf(dir: string): Promise<Set<string>> {
  return (await readManifest(dir)) ?? new Set((await listFiles(dir)).map(key));
}
