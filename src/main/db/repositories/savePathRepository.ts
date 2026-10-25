import type { DB } from '../database';

export type SavePathMode = 'manual' | 'ignored';

/** Ajustes do usuário sobre os locais de save detectados (adicionar / ignorar). */
export class SavePathRepository {
  constructor(private readonly db: DB) {}

  list(gameId: number): { path: string; mode: SavePathMode }[] {
    return this.db
      .prepare<[number], { path: string; mode: SavePathMode }>('SELECT path, mode FROM save_paths WHERE game_id = ? ORDER BY path')
      .all(gameId);
  }

  set(gameId: number, filePath: string, mode: SavePathMode): void {
    this.db
      .prepare('INSERT INTO save_paths (game_id, path, mode) VALUES (?, ?, ?) ON CONFLICT (game_id, path) DO UPDATE SET mode = excluded.mode')
      .run(gameId, filePath, mode);
  }

  remove(gameId: number, filePath: string): void {
    this.db.prepare('DELETE FROM save_paths WHERE game_id = ? AND path = ?').run(gameId, filePath);
  }
}
