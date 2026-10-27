import { createHash } from 'node:crypto';
import { type Dirent, promises as fs } from 'node:fs';
import path from 'node:path';
import type { SaveSnapshot, SaveSnapshotReason } from '@shared/types';
import { compactKey } from '@shared/text';
import { z } from 'zod';
import { AppError } from '../../errors';

// Cofre de saves: <raiz>\<Título do jogo>\
//   identity.json                      quem é o jogo (nome do exe/ROM e título) — sobrevive a reinstalar
//   20261022-153000-session\
//     manifest.json                    de onde veio cada item e como restaurar
//     data\0\…, data\1\…               cópia dos arquivos/pastas de save
// Cada versão é gravada numa pasta temporária e renomeada no fim: nunca fica pela metade.

/** game = relativo à pasta do jogo (sobrevive a reinstalar em outro lugar); retroarch = à do RetroArch. */
export type Anchor = 'game' | 'retroarch' | 'abs';

export interface SaveEntry {
  anchor: Anchor;
  /** Caminho relativo à âncora (ou absoluto, se anchor = abs). */
  key: string;
  isDirectory: boolean;
  /** Caminho atual no disco (só na hora do backup). */
  source: string;
}

interface ManifestEntry extends Omit<SaveEntry, 'source'> {
  stored: string;
}

interface Manifest {
  version: 1;
  createdAt: string;
  reason: SaveSnapshotReason;
  title: string;
  entries: ManifestEntry[];
  files: number;
  sizeBytes: number;
  fingerprint: string;
}

const GameIdentitySchema = z.object({
  title: z.string(),
  /** Nome do executável ou da ROM, em minúsculas ("god of war iii.exe"). Cofres antigos podem não ter. */
  file: z.string().catch(''),
});
export type GameIdentity = z.infer<typeof GameIdentitySchema>;

/**
 * identity.json de uma pasta do cofre: `null` se não existe (não é pasta de jogo), `'invalid'` se está
 * corrompido ou incompleto (ex.: cópia de conflito do OneDrive). Ler nunca lança.
 */
async function readIdentity(dir: string): Promise<GameIdentity | 'invalid' | null> {
  const text = await fs.readFile(path.join(dir, 'identity.json'), 'utf8').catch(() => null);
  if (text === null) return null;
  try {
    const parsed = GameIdentitySchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : 'invalid';
  } catch {
    return 'invalid';
  }
}

const KEEP_SNAPSHOTS = 15;
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_SNAPSHOT_FILES = 50_000;
const SNAPSHOT_ID = /^\d{8}-\d{6}-(session|auto|manual|initial|pre-restore)(-\d+)?$/;
/** Nomes que não identificam um jogo sozinhos. */
const GENERIC_FILE = /^(main|game|start|launch(er)?|play|run|app|client|eboot)$/i;

const stamp = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};


/** Nome de pasta seguro no Windows. */
export function safeFolderName(title: string): string {
  // Caracteres de controle (\u0000-\u001f) são proibidos em nomes do Windows: tirá-los é o objetivo.
  // eslint-disable-next-line no-control-regex
  const cleaned = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return (cleaned || 'Jogo').slice(0, 80);
}

interface FileStat {
  rel: string;
  size: number;
  mtimeMs: number;
}

/** Lista arquivos (recursivo) de um item de save, com limites de segurança. */
async function listFiles(source: string, isDirectory: boolean, budget: { files: number; bytes: number }): Promise<FileStat[]> {
  if (!isDirectory) {
    const s = await fs.stat(source);
    budget.files++;
    budget.bytes += s.size;
    return [{ rel: path.basename(source), size: s.size, mtimeMs: Math.floor(s.mtimeMs) }];
  }
  const out: FileStat[] = [];
  const walk = async (dir: string, rel: string) => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(full, r);
      else if (e.isFile()) {
        const s = await fs.stat(full);
        out.push({ rel: r, size: s.size, mtimeMs: Math.floor(s.mtimeMs) });
        budget.files++;
        budget.bytes += s.size;
        if (budget.files > MAX_SNAPSHOT_FILES || budget.bytes > MAX_SNAPSHOT_BYTES) {
          throw new AppError(
            'VALIDATION',
            'O save passou de 2 GB ou 50 mil arquivos: confira se um local de save não aponta para a pasta inteira do jogo.',
          );
        }
      }
    }
  };
  await walk(source, '');
  return out;
}

/**
 * Move o cofre para outra pasta (ex.: uma pasta do OneDrive). Recusa destinos dentro da pasta atual
 * (ou o contrário) e pastas que já têm arquivos, para nunca misturar nem sobrescrever nada.
 */
export async function moveVaultRoot(from: string, to: string): Promise<void> {
  const a = path.resolve(from);
  const b = path.resolve(to);
  if (a.toLowerCase() === b.toLowerCase()) return;
  const inside = (x: string, y: string) => {
    const rel = path.relative(y, x);
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  };
  if (inside(b, a) || inside(a, b)) throw new AppError('VALIDATION', 'Escolha uma pasta que não esteja dentro da pasta atual de saves (nem o contrário).');
  const targetEntries = await fs.readdir(b).catch(() => [] as string[]);
  if (targetEntries.length > 0) throw new AppError('VALIDATION', 'A pasta escolhida não está vazia. Escolha ou crie uma pasta vazia.');
  const hasVault = await fs.stat(a).then((s) => s.isDirectory(), () => false);
  if (!hasVault) {
    await fs.mkdir(b, { recursive: true });
    return;
  }
  await fs.rm(b, { recursive: true, force: true }); // vazia: rename exige que não exista
  try {
    await fs.rename(a, b); // mesmo disco: instantâneo
  } catch {
    await fs.cp(a, b, { recursive: true, preserveTimestamps: true }); // outro disco: copia e só então apaga
    await fs.rm(a, { recursive: true, force: true });
  }
}

/**
 * Junta um cofre em outro (ex.: conectar a nuvem num segundo PC, onde a pasta já tem o cofre do
 * primeiro). Jogos novos entram inteiros; em jogos que existem nos dois, entram só as versões que
 * faltam. Nada no destino é sobrescrito. Com `removeSource`, o cofre de origem é apagado no fim.
 */
export async function mergeVaultInto(from: string, to: string, removeSource: boolean): Promise<{ games: number; snapshots: number }> {
  const a = path.resolve(from);
  const b = path.resolve(to);
  if (a.toLowerCase() === b.toLowerCase()) return { games: 0, snapshots: 0 };
  const rel = path.relative(a, b);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) throw new AppError('VALIDATION', 'O destino não pode ficar dentro do cofre atual.');
  await fs.mkdir(b, { recursive: true });

  let games = 0;
  let snapshots = 0;
  for (const game of await fs.readdir(a, { withFileTypes: true }).catch(() => [] as Dirent[])) {
    if (!game.isDirectory()) continue;
    const src = path.join(a, game.name);
    const identity = await readIdentity(src);
    if (!identity) continue; // não é uma pasta de jogo do cofre
    // Corrompido: sem como achar o par no destino, entra como jogo novo (nada se perde).
    const existing = identity === 'invalid' ? null : await new SaveVault(() => b).findGameDir(identity);
    if (!existing) {
      let dest = path.join(b, game.name);
      for (let n = 2; await fs.stat(dest).then(() => true, () => false); n++) dest = path.join(b, `${game.name} (${n})`);
      await fs.cp(src, dest, { recursive: true, preserveTimestamps: true });
      games++;
      continue;
    }
    for (const snap of await fs.readdir(src, { withFileTypes: true })) {
      if (!snap.isDirectory() || !SNAPSHOT_ID.test(snap.name)) continue;
      const dest = path.join(existing, snap.name);
      if (await fs.stat(dest).then(() => true, () => false)) continue; // mesma versão já existe
      await fs.cp(path.join(src, snap.name), dest, { recursive: true, preserveTimestamps: true });
      snapshots++;
    }
  }
  if (removeSource) await fs.rm(a, { recursive: true, force: true });
  return { games, snapshots };
}

export class SaveVault {
  constructor(private readonly root: () => string) {}

  get rootDir(): string {
    return this.root();
  }

  /**
   * Pasta do jogo no cofre (também para um jogo readicionado depois de apagado):
   * 1) arquivo + título iguais  2) título igual  3) só o arquivo, se o nome não for genérico.
   * "main.exe" sozinho não basta: dois jogos diferentes dividiriam o mesmo save.
   */
  async findGameDir(identity: GameIdentity): Promise<string | null> {
    const root = this.root();
    const dirs = await fs.readdir(root, { withFileTypes: true }).catch(() => [] as Dirent[]);
    let byTitle: string | null = null;
    let byFile: string | null = null;
    const distinctive = !GENERIC_FILE.test(path.basename(identity.file, path.extname(identity.file)));
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const dir = path.join(root, d.name);
      const stored = await readIdentity(dir);
      if (!stored || stored === 'invalid') continue;
      const sameTitle = compactKey(stored.title) === compactKey(identity.title);
      const sameFile = !!stored.file && stored.file === identity.file;
      if (sameTitle && sameFile) return dir;
      if (sameTitle) byTitle ??= dir;
      if (sameFile && distinctive) byFile ??= dir;
    }
    return byTitle ?? byFile;
  }

  async list(gameDir: string | null): Promise<SaveSnapshot[]> {
    if (!gameDir) return [];
    const dirs = await fs.readdir(gameDir, { withFileTypes: true }).catch(() => [] as Dirent[]);
    const out: SaveSnapshot[] = [];
    for (const d of dirs) {
      if (!d.isDirectory() || !SNAPSHOT_ID.test(d.name)) continue;
      const manifest = await this.readManifest(path.join(gameDir, d.name));
      if (manifest) out.push({ id: d.name, createdAt: manifest.createdAt, reason: manifest.reason, files: manifest.files, sizeBytes: manifest.sizeBytes });
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }

  /** Impressão digital (tamanho + data de cada arquivo): detecta se o save mudou sem copiar nada. */
  async fingerprint(entries: readonly SaveEntry[]): Promise<{ hash: string; files: number; bytes: number }> {
    const budget = { files: 0, bytes: 0 };
    const lines: string[] = [];
    for (const e of entries) {
      for (const f of await listFiles(e.source, e.isDirectory, budget)) lines.push(`${e.anchor}|${e.key}|${f.rel}|${f.size}|${f.mtimeMs}`);
    }
    return { hash: createHash('sha1').update(lines.sort().join('\n')).digest('hex'), files: budget.files, bytes: budget.bytes };
  }

  /**
   * Grava uma versão nova. Com `skipIfUnchanged`, não grava se o save for idêntico ao da última versão.
   * @returns a versão criada, ou null se nada mudou.
   */
  async snapshot(
    identity: GameIdentity,
    entries: readonly SaveEntry[],
    reason: SaveSnapshotReason,
    skipIfUnchanged: boolean,
  ): Promise<SaveSnapshot | null> {
    if (entries.length === 0) return null;
    const { hash, files, bytes } = await this.fingerprint(entries);
    if (files === 0) return null;

    const gameDir = (await this.findGameDir(identity)) ?? (await this.createGameDir(identity));
    if (skipIfUnchanged) {
      const [latest] = await this.list(gameDir);
      const last = latest ? await this.readManifest(path.join(gameDir, latest.id)) : null;
      if (last?.fingerprint === hash) return null;
    }

    let id = `${stamp()}-${reason}`;
    for (let n = 2; await fs.stat(path.join(gameDir, id)).then(() => true, () => false); n++) id = `${stamp()}-${reason}-${n}`;
    const tmp = path.join(gameDir, `.tmp-${id}`);
    await fs.rm(tmp, { recursive: true, force: true });
    try {
      const manifestEntries: ManifestEntry[] = [];
      for (const [i, e] of entries.entries()) {
        const stored = `data/${i}`;
        const target = path.join(tmp, stored);
        if (e.isDirectory) {
          await fs.cp(e.source, target, { recursive: true, preserveTimestamps: true });
        } else {
          await fs.mkdir(target, { recursive: true });
          await fs.copyFile(e.source, path.join(target, path.basename(e.source)));
        }
        manifestEntries.push({ anchor: e.anchor, key: e.key, isDirectory: e.isDirectory, stored });
      }
      const manifest: Manifest = {
        version: 1,
        createdAt: new Date().toISOString(),
        reason,
        title: identity.title,
        entries: manifestEntries,
        files,
        sizeBytes: bytes,
        fingerprint: hash,
      };
      await fs.writeFile(path.join(tmp, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
      await fs.rename(tmp, path.join(gameDir, id));
    } catch (err) {
      await fs.rm(tmp, { recursive: true, force: true });
      throw err;
    }
    await this.prune(gameDir);
    return { id, createdAt: new Date().toISOString(), reason, files, sizeBytes: bytes };
  }

  /** Itens de uma versão, prontos para copiar de volta (o chamador resolve as âncoras). */
  async entriesOf(gameDir: string, snapshotId: string): Promise<(ManifestEntry & { storedPath: string })[]> {
    if (!SNAPSHOT_ID.test(snapshotId)) throw new AppError('VALIDATION', 'Versão de save inválida.');
    const dir = path.join(gameDir, snapshotId);
    const manifest = await this.readManifest(dir);
    if (!manifest) throw new AppError('NOT_FOUND', 'Versão de save não encontrada ou corrompida.');
    return manifest.entries.map((e) => ({ ...e, storedPath: path.join(dir, e.stored) }));
  }

  private async createGameDir(identity: GameIdentity): Promise<string> {
    const root = this.root();
    await fs.mkdir(root, { recursive: true });
    const base = safeFolderName(identity.title);
    let dir = path.join(root, base);
    for (let n = 2; await fs.stat(dir).then(() => true, () => false); n++) dir = path.join(root, `${base} (${n})`);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'identity.json'), JSON.stringify(identity, null, 2), 'utf8');
    return dir;
  }

  private async readManifest(dir: string): Promise<Manifest | null> {
    try {
      const m = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8')) as Manifest;
      return m.version === 1 && Array.isArray(m.entries) ? m : null;
    } catch {
      return null;
    }
  }

  private async prune(gameDir: string): Promise<void> {
    const old = (await this.list(gameDir)).slice(KEEP_SNAPSHOTS);
    await Promise.all(old.map((s) => fs.rm(path.join(gameDir, s.id), { recursive: true, force: true })));
  }
}
