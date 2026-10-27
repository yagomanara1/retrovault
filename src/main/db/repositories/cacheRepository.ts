import type Database from 'better-sqlite3';
type Statement<P extends unknown[] | object = unknown[], R = unknown> = Database.Statement<P, R>;
import type { DB } from '../database';

export interface CacheRow {
  value: string;
  expires_at: number;
}

export class CacheRepository {
  private readonly getStmt: Statement<[string], CacheRow>;
  private readonly setStmt: Statement<[string, string, number]>;
  private readonly deletePrefixStmt: Statement<[number, string]>;
  private readonly purgeStmt: Statement<[number]>;

  constructor(db: DB) {
    this.getStmt = db.prepare<[string], CacheRow>('SELECT value, expires_at FROM api_cache WHERE key = ?');
    this.setStmt = db.prepare<[string, string, number]>(
      `INSERT INTO api_cache (key, value, expires_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`,
    );
    this.deletePrefixStmt = db.prepare<[number, string]>('DELETE FROM api_cache WHERE substr(key, 1, ?) = ?');
    this.purgeStmt = db.prepare<[number]>('DELETE FROM api_cache WHERE expires_at < ?');
  }

  get(key: string): CacheRow | undefined {
    return this.getStmt.get(key);
  }

  set(key: string, value: string, expiresAt: number): void {
    this.setStmt.run(key, value, expiresAt);
  }

  deletePrefix(prefix: string): void {
    this.deletePrefixStmt.run(prefix.length, prefix);
  }

  /** Remove entradas expiradas há mais de `graceMs` (mantidas para stale-if-error). */
  purgeExpired(graceMs: number): void {
    this.purgeStmt.run(Date.now() - graceMs);
  }
}
