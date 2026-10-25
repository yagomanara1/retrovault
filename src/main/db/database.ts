import Database from 'better-sqlite3';
import { migrations } from './migrations';

export type DB = Database.Database;

export interface OpenOptions {
  /** Chamado só quando há migrations pendentes num banco já existente (ex.: backup de segurança). */
  beforeMigrate?: (db: DB) => void;
}

export function openDatabase(file: string, options: OpenOptions = {}): DB {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db, options.beforeMigrate);
  return db;
}

function migrate(db: DB, beforeMigrate?: (db: DB) => void): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);

  const applied = new Set(
    db.prepare<[], number>('SELECT version FROM schema_migrations').pluck().all(),
  );
  const record = db.prepare<[number, string, string]>(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  );

  const pending = migrations.filter((m) => !applied.has(m.version));
  // Banco novo (nenhuma migration aplicada) não tem o que proteger.
  if (pending.length > 0 && applied.size > 0) beforeMigrate?.(db);

  for (const migration of pending) {
    db.transaction(() => {
      db.exec(migration.sql);
      record.run(migration.version, migration.name, new Date().toISOString());
    })();
    console.info(`[db] migration ${migration.version} (${migration.name}) aplicada`);
  }
}
