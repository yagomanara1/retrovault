import type Database from 'better-sqlite3';
type Statement<P extends unknown[] | object = unknown[], R = unknown> = Database.Statement<P, R>;
import type { DB } from '../database';

export class SettingsRepository {
  private readonly getStmt: Statement<[string], { value: string }>;
  private readonly upsertStmt: Statement<[string, string]>;
  private readonly deleteStmt: Statement<[string]>;

  constructor(private readonly db: DB) {
    this.getStmt = db.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?');
    this.upsertStmt = db.prepare<[string, string]>(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    );
    this.deleteStmt = db.prepare<[string]>('DELETE FROM settings WHERE key = ?');
  }

  get<T>(key: string, fallback: T): T {
    const row = this.getStmt.get(key);
    if (!row) return fallback;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return fallback;
    }
  }

  set(key: string, value: unknown): void {
    if (value === null || value === undefined) this.deleteStmt.run(key);
    else this.upsertStmt.run(key, JSON.stringify(value));
  }

  transaction(fn: () => void): void {
    this.db.transaction(fn)();
  }
}
