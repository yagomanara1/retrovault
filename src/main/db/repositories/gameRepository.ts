import type Database from 'better-sqlite3';
type Statement<P extends unknown[] | object = unknown[], R = unknown> = Database.Statement<P, R>;
import type { Game, GameKind } from '@shared/types';
import type { DB } from '../database';

interface GameRow {
  id: number;
  title: string;
  kind: GameKind;
  path: string;
  core_path: string | null;
  launch_args: string | null;
  console_id: number | null;
  ra_game_id: number | null;
  rom_hash: string | null;
  steam_app_id: number | null;
  cover_url: string | null;
  background_url: string | null;
  icon_url: string | null;
  favorite: number;
  playtime_seconds: number;
  last_played_at: string | null;
  created_at: string;
  /** "3,7" (group_concat das categorias) ou null. */
  category_ids: string | null;
}

/** Colunas do jogo + categorias numa só consulta (sem uma consulta extra por jogo). */
const SELECT_GAME = `
  SELECT g.*, (SELECT group_concat(gc.category_id) FROM game_categories gc WHERE gc.game_id = g.id) AS category_ids
  FROM games g`;

export interface NewGameRecord {
  title: string;
  kind: GameKind;
  path: string;
  corePath: string | null;
  launchArgs: string | null;
  consoleId: number | null;
  raGameId: number | null;
  romHash: string | null;
  /** Ausente = não é da Steam. */
  steamAppId?: number | null;
  coverUrl: string | null;
  backgroundUrl: string | null;
  iconUrl: string | null;
}

export type GamePatch = Partial<Omit<NewGameRecord, 'kind' | 'path' | 'steamAppId'>> & { favorite?: boolean };

// Whitelist: só estas colunas podem ser atualizadas dinamicamente (evita SQL injection por chave).
const PATCH_COLUMNS: Record<keyof GamePatch, string> = {
  title: 'title',
  corePath: 'core_path',
  launchArgs: 'launch_args',
  consoleId: 'console_id',
  raGameId: 'ra_game_id',
  romHash: 'rom_hash',
  coverUrl: 'cover_url',
  backgroundUrl: 'background_url',
  iconUrl: 'icon_url',
  favorite: 'favorite',
};

function toGame(row: GameRow): Game {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    path: row.path,
    corePath: row.core_path,
    launchArgs: row.launch_args,
    consoleId: row.console_id,
    raGameId: row.ra_game_id,
    romHash: row.rom_hash,
    steamAppId: row.steam_app_id,
    coverUrl: row.cover_url,
    backgroundUrl: row.background_url,
    iconUrl: row.icon_url,
    favorite: row.favorite === 1,
    playtimeSeconds: row.playtime_seconds,
    lastPlayedAt: row.last_played_at,
    createdAt: row.created_at,
    categoryIds: row.category_ids ? row.category_ids.split(',').map(Number) : [],
  };
}

export class GameRepository {
  private readonly listStmt: Statement<[], GameRow>;
  private readonly getStmt: Statement<[number], GameRow>;
  private readonly insertStmt: Statement<NewGameRecord>;
  private readonly deleteStmt: Statement<[number]>;
  private readonly startSessionStmt: Statement<[number, string]>;
  private readonly endSessionStmt: Statement<[string, number, number]>;
  private readonly addPlaytimeStmt: Statement<[number, string, number]>;
  private readonly endSessionTx: (sessionId: number, gameId: number, endedAt: string, duration: number) => void;

  constructor(private readonly db: DB) {
    this.listStmt = db.prepare<[], GameRow>(`${SELECT_GAME} ORDER BY g.title COLLATE NOCASE`);
    this.getStmt = db.prepare<[number], GameRow>(`${SELECT_GAME} WHERE g.id = ?`);
    this.insertStmt = db.prepare<NewGameRecord>(`
      INSERT INTO games (title, kind, path, core_path, launch_args, console_id, ra_game_id, rom_hash, steam_app_id, cover_url, background_url, icon_url)
      VALUES (@title, @kind, @path, @corePath, @launchArgs, @consoleId, @raGameId, @romHash, @steamAppId, @coverUrl, @backgroundUrl, @iconUrl)
    `);
    this.deleteStmt = db.prepare<[number]>('DELETE FROM games WHERE id = ?');
    this.startSessionStmt = db.prepare<[number, string]>(
      'INSERT INTO play_sessions (game_id, started_at) VALUES (?, ?)',
    );
    this.endSessionStmt = db.prepare<[string, number, number]>(
      'UPDATE play_sessions SET ended_at = ?, duration_seconds = ? WHERE id = ?',
    );
    this.addPlaytimeStmt = db.prepare<[number, string, number]>(
      'UPDATE games SET playtime_seconds = playtime_seconds + ?, last_played_at = ? WHERE id = ?',
    );
    this.endSessionTx = db.transaction((sessionId: number, gameId: number, endedAt: string, duration: number) => {
      this.endSessionStmt.run(endedAt, duration, sessionId);
      this.addPlaytimeStmt.run(duration, endedAt, gameId);
    });
  }

  list(): Game[] {
    return this.listStmt.all().map(toGame);
  }

  get(id: number): Game | null {
    const row = this.getStmt.get(id);
    return row ? toGame(row) : null;
  }

  create(record: NewGameRecord): Game {
    const info = this.insertStmt.run({ ...record, steamAppId: record.steamAppId ?? null });
    return this.get(Number(info.lastInsertRowid))!;
  }

  update(id: number, patch: GamePatch): Game | null {
    const entries = (Object.entries(patch) as [keyof GamePatch, unknown][]).filter(
      ([key, value]) => value !== undefined && key in PATCH_COLUMNS,
    );
    if (entries.length > 0) {
      const assignments = entries.map(([key]) => `${PATCH_COLUMNS[key]} = @${key}`).join(', ');
      const params = Object.fromEntries(
        entries.map(([key, value]) => [key, typeof value === 'boolean' ? Number(value) : value]),
      );
      this.db.prepare(`UPDATE games SET ${assignments} WHERE id = @id`).run({ ...params, id });
    }
    return this.get(id);
  }

  /** Troca o arquivo do jogo; UNIQUE(path) vira DUPLICATE se outro jogo já usa o arquivo. */
  updatePath(id: number, newPath: string): Game | null {
    this.db.prepare('UPDATE games SET path = ? WHERE id = ?').run(newPath, id);
    return this.get(id);
  }

  /** Importação de progresso: fica o maior tempo de jogo e a data mais recente. true se mudou algo. */
  mergePlaytime(id: number, playtimeSeconds: number, lastPlayedAt: string | null): boolean {
    return (
      this.db
        .prepare(
          `UPDATE games SET
             playtime_seconds = MAX(playtime_seconds, @playtime),
             last_played_at = CASE WHEN @last IS NOT NULL AND (last_played_at IS NULL OR @last > last_played_at)
                                   THEN @last ELSE last_played_at END
           WHERE id = @id AND (playtime_seconds < @playtime OR (@last IS NOT NULL AND (last_played_at IS NULL OR @last > last_played_at)))`,
        )
        .run({ id, playtime: playtimeSeconds, last: lastPlayedAt }).changes > 0
    );
  }

  remove(id: number): void {
    this.deleteStmt.run(id);
  }

  startSession(gameId: number, startedAt: string): number {
    return Number(this.startSessionStmt.run(gameId, startedAt).lastInsertRowid);
  }

  endSession(sessionId: number, gameId: number, endedAt: string, durationSeconds: number): void {
    this.endSessionTx(sessionId, gameId, endedAt, durationSeconds);
  }

  /** Sessão que não chegou a acontecer (ex.: a Steam não abriu o jogo): não conta como jogado. */
  discardSession(sessionId: number): void {
    this.db.prepare('DELETE FROM play_sessions WHERE id = ?').run(sessionId);
  }
}
