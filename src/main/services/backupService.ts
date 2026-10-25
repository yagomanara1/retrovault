import { promises as fs, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { BackupInfo, BackupKind } from '@shared/types';
import type { DB } from '../db/database';
import { AppError } from '../errors';

// Backups do banco (biblioteca, tempo de jogo e troféus) em <userData>/backups.
// VACUUM INTO gera uma cópia consistente mesmo com WAL e compacta o arquivo.

const KEEP: Record<BackupKind, number> = { auto: 7, manual: 10, 'pre-migration': 3, 'pre-restore': 3 };
const NAME_PATTERN = /^retrovault-(auto|manual|pre-migration|pre-restore)-(\d{8}-\d{6})\.db$/;
const RESTORE_SUFFIX = '.restore';

const stamp = (d = new Date()) =>
  d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15); // 20261022-143005 (UTC)

const parseStamp = (s: string) =>
  new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`);

/** Copia o banco aberto para `target` de forma consistente (o arquivo não pode existir). */
function snapshotDatabase(db: DB, target: string): void {
  db.prepare('VACUUM INTO ?').run(target);
}

/** Backup síncrono com nome padrão; usado antes de migrations e de restaurações (banco ainda sem serviços). */
export function snapshotTo(db: DB, backupDir: string, kind: BackupKind): string {
  mkdirSync(backupDir, { recursive: true });
  const target = path.join(backupDir, `retrovault-${kind}-${stamp()}.db`);
  rmSync(target, { force: true });
  snapshotDatabase(db, target);
  console.info(`[backup] ${path.basename(target)}`);
  return target;
}

/** Confere se o arquivo é um banco do RetroVault antes de restaurá-lo. */
function assertValidBackup(file: string): void {
  let db: Database.Database | null = null;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const tables = new Set(db.prepare<[], string>("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all());
    if (!tables.has('games') || !tables.has('schema_migrations')) throw new Error('tabelas ausentes');
    if (db.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('integridade');
  } catch (err) {
    throw new AppError('VALIDATION', 'Este backup está corrompido ou não é do RetroVault.', { cause: err });
  } finally {
    db?.close();
  }
}

export class BackupService {
  constructor(
    private readonly db: DB,
    private readonly dbFile: string,
    readonly dir: string,
  ) {}

  async list(): Promise<BackupInfo[]> {
    const files = await fs.readdir(this.dir).catch(() => [] as string[]);
    const infos: BackupInfo[] = [];
    for (const name of files) {
      const match = NAME_PATTERN.exec(name);
      if (!match) continue;
      const stat = await fs.stat(path.join(this.dir, name)).catch(() => null);
      if (!stat) continue;
      infos.push({ name, kind: match[1] as BackupKind, createdAt: parseStamp(match[2]!).toISOString(), sizeBytes: stat.size });
    }
    return infos.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async create(kind: BackupKind): Promise<BackupInfo> {
    await fs.mkdir(this.dir, { recursive: true });
    const name = `retrovault-${kind}-${stamp()}.db`;
    const target = path.join(this.dir, name);
    const tmp = `${target}.tmp`;
    await fs.rm(tmp, { force: true });
    snapshotDatabase(this.db, tmp);
    await fs.rename(tmp, target); // nunca deixa um backup pela metade com nome válido
    await this.prune(kind);
    const stat = await fs.stat(target);
    console.info(`[backup] ${name} (${Math.round(stat.size / 1024)} KB)`);
    return { name, kind, createdAt: new Date().toISOString(), sizeBytes: stat.size };
  }

  /** Um backup automático por dia (data local), mantendo os últimos 7. */
  async ensureDaily(): Promise<void> {
    const today = new Date().toDateString();
    const backups = await this.list();
    // Backups síncronos (pre-migration/pre-restore) não passam por create(): poda aqui.
    await Promise.all((['pre-migration', 'pre-restore'] as const).map((k) => this.prune(k)));
    if (backups.some((b) => b.kind === 'auto' && new Date(b.createdAt).toDateString() === today)) return;
    await this.create('auto');
  }

  /** Valida e agenda: a troca acontece no próximo início, antes de o banco ser aberto. */
  async scheduleRestore(name: string): Promise<void> {
    if (!NAME_PATTERN.test(name)) throw new AppError('VALIDATION', 'Backup inválido.');
    const source = path.join(this.dir, name);
    if (!existsSync(source)) throw new AppError('NOT_FOUND', 'Backup não encontrado.');
    assertValidBackup(source);
    await fs.copyFile(source, this.dbFile + RESTORE_SUFFIX);
  }

  /** Arte usada pelos backups: a limpeza de arte não pode apagá-la (restaurar traria imagens quebradas). */
  async referencedArtwork(): Promise<string[]> {
    const urls: string[] = [];
    for (const { name } of await this.list()) {
      let db: Database.Database | null = null;
      try {
        db = new Database(path.join(this.dir, name), { readonly: true, fileMustExist: true });
        urls.push(
          ...db
            .prepare<[], string>(
              `SELECT cover_url FROM games UNION SELECT background_url FROM games UNION SELECT icon_url FROM games
               UNION SELECT icon_url FROM trophies UNION SELECT icon_url FROM trophy_sets`,
            )
            .pluck()
            .all()
            .filter(Boolean),
        );
      } catch {
        // backup antigo sem alguma tabela: ignora
      } finally {
        db?.close();
      }
    }
    return urls;
  }

  private async prune(kind: BackupKind): Promise<void> {
    const old = (await this.list()).filter((b) => b.kind === kind).slice(KEEP[kind]);
    await Promise.all(old.map((b) => fs.rm(path.join(this.dir, b.name), { force: true })));
  }
}

/**
 * Executado no início, ANTES de abrir o banco: aplica uma restauração agendada.
 * O estado atual vira um backup "pre-restore" (lido com WAL, então nada se perde).
 */
export function applyPendingRestore(dbFile: string, backupDir: string): boolean {
  const pending = dbFile + RESTORE_SUFFIX;
  if (!existsSync(pending)) return false;
  if (existsSync(dbFile)) {
    const current = new Database(dbFile);
    try {
      snapshotTo(current, backupDir, 'pre-restore');
    } finally {
      current.close();
    }
  }
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) rmSync(f, { force: true });
  renameSync(pending, dbFile);
  console.info('[backup] restauração aplicada');
  return true;
}
