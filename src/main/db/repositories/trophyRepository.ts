import type Database from 'better-sqlite3';
type Statement<P extends unknown[] | object = unknown[], R = unknown> = Database.Statement<P, R>;
import type { Trophy, TrophyGameSummary, TrophyGrade, TrophyOverview, TrophySet, TrophySource } from '@shared/types';
import type { DB } from '../database';

interface SetRow {
  game_id: number;
  source: 'ps4' | 'manual';
  np_comm_id: string | null;
  title: string | null;
  icon_url: string | null;
  log_path: string | null;
  log_pattern: string | null;
  log_cursor: number;
  log_tail_hash: string | null;
  log_disabled: number;
  emulator: 'rpcs3' | 'vita3k' | null;
  progress_path: string | null;
}

/**
 * No banco, as listas dos emuladores ficam com source 'ps4' (o CHECK antigo só aceita 'ps4' | 'manual')
 * e o emulador na coluna própria; fora do repositório, o source já diz o emulador.
 */
const domainSource = (row: Pick<SetRow, 'source' | 'emulator'>): TrophySource => row.emulator ?? row.source;
const dbColumns = (source: TrophySource) =>
  source === 'manual' ? { source: 'manual' as const, emulator: null } : { source: 'ps4' as const, emulator: source === 'ps4' ? null : source };

/** Lista lida de um emulador, para ressincronizar os desbloqueios. */
export interface EmulatorSet {
  gameId: number;
  emulator: 'rpcs3' | 'vita3k';
  progressPath: string;
}

interface TrophyRow {
  trophy_id: number;
  name: string;
  detail: string;
  grade: TrophyGrade;
  hidden: number;
  icon_url: string | null;
  unlocked_at: string | null;
  unlock_source: 'auto' | 'manual' | null;
}

export interface TrophySetRecord {
  gameId: number;
  source: TrophySource;
  npCommId: string | null;
  title: string | null;
  iconUrl: string | null;
  logPath: string | null;
  progressPath?: string | null;
}

export interface TrophyRecord {
  trophyId: number;
  name: string;
  detail: string;
  grade: TrophyGrade;
  hidden: boolean;
  iconUrl: string | null;
}

export interface WatchedSet {
  gameId: number;
  logPath: string;
  logPattern: string | null;
  cursor: number;
  tailHash: string | null;
}

const toTrophy = (r: TrophyRow): Trophy => ({
  id: r.trophy_id,
  name: r.name,
  detail: r.detail,
  grade: r.grade,
  hidden: r.hidden === 1,
  iconUrl: r.icon_url,
  unlockedAt: r.unlocked_at,
  unlockSource: r.unlock_source,
});

export class TrophyRepository {
  private readonly getSetStmt: Statement<[number], SetRow>;
  private readonly listTrophiesStmt: Statement<[number], TrophyRow>;
  private readonly insertSetStmt: Statement<
    [number, string, string | null, string | null, string | null, string | null, string, string | null, string | null]
  >;
  private readonly insertTrophyStmt: Statement<
    [number, number, string, string, TrophyGrade, number, string | null, string | null, string | null]
  >;
  private readonly deleteSetStmt: Statement<[number]>;
  private readonly unlockStmt: Statement<[string, string, number, number]>;
  private readonly lockStmt: Statement<[number, number]>;
  private readonly watchedStmt: Statement<[], SetRow>;
  private readonly cursorStmt: Statement<[number, string | null, number]>;

  constructor(private readonly db: DB) {
    this.getSetStmt = db.prepare<[number], SetRow>('SELECT * FROM trophy_sets WHERE game_id = ?');
    this.listTrophiesStmt = db.prepare<[number], TrophyRow>(
      'SELECT * FROM trophies WHERE game_id = ? ORDER BY trophy_id',
    );
    this.insertSetStmt = db.prepare<
      [number, string, string | null, string | null, string | null, string | null, string, string | null, string | null]
    >(
      `INSERT INTO trophy_sets (game_id, source, np_comm_id, title, icon_url, log_path, created_at, emulator, progress_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.insertTrophyStmt = db.prepare<
      [number, number, string, string, TrophyGrade, number, string | null, string | null, string | null]
    >(
      `INSERT INTO trophies (game_id, trophy_id, name, detail, grade, hidden, icon_url, unlocked_at, unlock_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.deleteSetStmt = db.prepare<[number]>('DELETE FROM trophy_sets WHERE game_id = ?');
    this.unlockStmt = db.prepare<[string, string, number, number]>(
      `UPDATE trophies SET unlocked_at = ?, unlock_source = ?
       WHERE game_id = ? AND trophy_id = ? AND unlocked_at IS NULL`,
    );
    this.lockStmt = db.prepare<[number, number]>(
      'UPDATE trophies SET unlocked_at = NULL, unlock_source = NULL WHERE game_id = ? AND trophy_id = ?',
    );
    this.watchedStmt = db.prepare<[], SetRow>('SELECT * FROM trophy_sets WHERE log_path IS NOT NULL');
    this.cursorStmt = db.prepare<[number, string | null, number]>('UPDATE trophy_sets SET log_cursor = ?, log_tail_hash = ? WHERE game_id = ?');
  }

  getSet(gameId: number): TrophySet | null {
    const row = this.getSetStmt.get(gameId);
    if (!row) return null;
    return {
      gameId: row.game_id,
      source: domainSource(row),
      npCommId: row.np_comm_id,
      title: row.title,
      iconUrl: row.icon_url,
      logPath: row.log_path,
      progressPath: row.progress_path,
      trophies: this.listTrophiesStmt.all(gameId).map(toTrophy),
    };
  }

  /** Substitui a lista (reimportação) preservando os desbloqueios já obtidos. */
  replaceSet(record: TrophySetRecord, trophies: readonly TrophyRecord[]): void {
    this.db.transaction(() => {
      this.clearAutoImportOptOut(record.gameId);
      const previous = new Map(
        this.listTrophiesStmt.all(record.gameId).map((t) => [t.trophy_id, t] as const),
      );
      const logDisabled = this.getSetStmt.get(record.gameId)?.log_disabled ?? 0;
      this.deleteSetStmt.run(record.gameId);
      const { source, emulator } = dbColumns(record.source);
      this.insertSetStmt.run(
        record.gameId,
        source,
        record.npCommId,
        record.title,
        record.iconUrl,
        logDisabled ? null : record.logPath,
        new Date().toISOString(),
        emulator,
        record.progressPath ?? null,
      );
      // Reimportar não religa uma detecção que o usuário desligou.
      if (logDisabled) this.db.prepare('UPDATE trophy_sets SET log_disabled = 1 WHERE game_id = ?').run(record.gameId);
      for (const t of trophies) {
        const old = previous.get(t.trophyId);
        this.insertTrophyStmt.run(
          record.gameId,
          t.trophyId,
          t.name,
          t.detail,
          t.grade,
          t.hidden ? 1 : 0,
          t.iconUrl,
          old?.unlocked_at ?? null,
          old?.unlock_source ?? null,
        );
      }
    })();
  }

  createManualSet(gameId: number, logPath: string | null): void {
    if (this.getSetStmt.get(gameId)) return;
    this.db.transaction(() => {
      this.clearAutoImportOptOut(gameId);
      this.insertSetStmt.run(gameId, 'manual', null, null, null, logPath, new Date().toISOString(), null, null);
    })();
  }

  /** Remove a lista e impede que a importação automática a recrie. */
  deleteSet(gameId: number): void {
    this.db.transaction(() => {
      this.deleteSetStmt.run(gameId);
      this.db
        .prepare('INSERT OR IGNORE INTO trophy_auto_import_optout (game_id, created_at) VALUES (?, ?)')
        .run(gameId, new Date().toISOString());
    })();
  }

  /** Jogos sem lista de troféus que ainda aceitam importação automática. */
  gamesPendingAutoImport(): number[] {
    return this.db
      .prepare<[], number>(
        `SELECT g.id FROM games g
         WHERE NOT EXISTS (SELECT 1 FROM trophy_sets s WHERE s.game_id = g.id)
           AND NOT EXISTS (SELECT 1 FROM trophy_auto_import_optout o WHERE o.game_id = g.id)
         ORDER BY g.id`,
      )
      .pluck()
      .all();
  }

  private clearAutoImportOptOut(gameId: number): void {
    this.db.prepare('DELETE FROM trophy_auto_import_optout WHERE game_id = ?').run(gameId);
  }

  upsertTrophy(gameId: number, trophy: Omit<TrophyRecord, 'trophyId' | 'iconUrl'> & { trophyId?: number }): number {
    if (trophy.trophyId !== undefined) {
      this.db
        .prepare('UPDATE trophies SET name = ?, detail = ?, grade = ?, hidden = ? WHERE game_id = ? AND trophy_id = ?')
        .run(trophy.name, trophy.detail, trophy.grade, trophy.hidden ? 1 : 0, gameId, trophy.trophyId);
      return trophy.trophyId;
    }
    const next = this.db
      .prepare<[number], number>('SELECT COALESCE(MAX(trophy_id) + 1, 0) FROM trophies WHERE game_id = ?')
      .pluck()
      .get(gameId)!;
    this.insertTrophyStmt.run(gameId, next, trophy.name, trophy.detail, trophy.grade, trophy.hidden ? 1 : 0, null, null, null);
    return next;
  }

  deleteTrophy(gameId: number, trophyId: number): void {
    this.db.prepare('DELETE FROM trophies WHERE game_id = ? AND trophy_id = ?').run(gameId, trophyId);
  }

  /** Desbloqueia de forma idempotente; retorna só os ids que mudaram de estado. */
  unlock(gameId: number, trophyIds: readonly number[], source: 'auto' | 'manual', at = new Date().toISOString()): number[] {
    const changed: number[] = [];
    this.db.transaction(() => {
      for (const id of trophyIds) {
        if (this.unlockStmt.run(at, source, gameId, id).changes > 0) changed.push(id);
      }
    })();
    return changed;
  }

  lock(gameId: number, trophyId: number): void {
    this.lockStmt.run(gameId, trophyId);
  }

  /** null = o usuário desligou a detecção (não é religada sozinha). */
  setLogPath(gameId: number, logPath: string | null): void {
    this.db
      .prepare(
        'UPDATE trophy_sets SET log_path = ?, log_cursor = 0, log_tail_hash = NULL, log_disabled = ? WHERE game_id = ?',
      )
      .run(logPath, logPath ? 0 : 1, gameId);
  }

  /** Listas sem log que ainda aceitam detecção automática (o log pode surgir depois). */
  setsMissingLog(): number[] {
    return this.db
      // Listas de emulador não usam log: os desbloqueios vêm do TROPUSR.DAT.
      .prepare<[], number>('SELECT game_id FROM trophy_sets WHERE log_path IS NULL AND log_disabled = 0 AND emulator IS NULL')
      .pluck()
      .all();
  }

  attachLog(gameId: number, logPath: string): void {
    this.db
      .prepare(
        'UPDATE trophy_sets SET log_path = ?, log_cursor = 0, log_tail_hash = NULL WHERE game_id = ? AND log_path IS NULL AND log_disabled = 0',
      )
      .run(logPath, gameId);
  }

  watchedSets(): WatchedSet[] {
    return this.watchedStmt.all().map((r) => ({
      gameId: r.game_id,
      logPath: r.log_path!,
      logPattern: r.log_pattern,
      cursor: r.log_cursor,
      tailHash: r.log_tail_hash,
    }));
  }

  saveCursor(gameId: number, cursor: number, tailHash: string | null): void {
    this.cursorStmt.run(cursor, tailHash, gameId);
  }

  /** Listas que vêm de um emulador (os desbloqueios são relidos do TROPUSR.DAT dele). */
  emulatorSets(): EmulatorSet[] {
    return this.db
      .prepare<[], { game_id: number; emulator: 'rpcs3' | 'vita3k'; progress_path: string }>(
        'SELECT game_id, emulator, progress_path FROM trophy_sets WHERE emulator IS NOT NULL AND progress_path IS NOT NULL',
      )
      .all()
      .map((r) => ({ gameId: r.game_id, emulator: r.emulator, progressPath: r.progress_path }));
  }

  /**
   * Página geral: contagens por jogo e grau em uma só consulta (GROUP BY), sem carregar
   * a lista de cada jogo; e os últimos troféus obtidos (índice parcial em unlocked_at).
   */
  overview(recentLimit: number): TrophyOverview {
    const rows = this.db
      .prepare<
        [],
        {
          game_id: number;
          title: string;
          icon_url: string | null;
          source: 'ps4' | 'manual';
          emulator: 'rpcs3' | 'vita3k' | null;
          grade: TrophyGrade | null;
          total: number;
          unlocked: number;
          last_unlocked: string | null;
        }
      >(
        `SELECT s.game_id, g.title, COALESCE(s.icon_url, g.icon_url, g.cover_url) AS icon_url, s.source, s.emulator,
                t.grade, COUNT(t.trophy_id) AS total, COUNT(t.unlocked_at) AS unlocked, MAX(t.unlocked_at) AS last_unlocked
         FROM trophy_sets s
         JOIN games g ON g.id = s.game_id
         LEFT JOIN trophies t ON t.game_id = s.game_id
         GROUP BY s.game_id, t.grade`,
      )
      .all();

    const games = new Map<number, TrophyGameSummary>();
    for (const r of rows) {
      let game = games.get(r.game_id);
      if (!game) {
        game = {
          gameId: r.game_id,
          title: r.title,
          iconUrl: r.icon_url,
          source: domainSource(r),
          byGrade: { P: { total: 0, unlocked: 0 }, G: { total: 0, unlocked: 0 }, S: { total: 0, unlocked: 0 }, B: { total: 0, unlocked: 0 } },
          lastUnlockedAt: null,
        };
        games.set(r.game_id, game);
      }
      if (r.grade) game.byGrade[r.grade] = { total: r.total, unlocked: r.unlocked };
      if (r.last_unlocked && (!game.lastUnlockedAt || r.last_unlocked > game.lastUnlockedAt)) game.lastUnlockedAt = r.last_unlocked;
    }

    const recent = this.db
      .prepare<[number], TrophyRow & { game_id: number; game_title: string }>(
        `SELECT t.*, g.title AS game_title FROM trophies t JOIN games g ON g.id = t.game_id
         WHERE t.unlocked_at IS NOT NULL ORDER BY t.unlocked_at DESC LIMIT ?`,
      )
      .all(recentLimit)
      .map((r) => ({ gameId: r.game_id, gameTitle: r.game_title, trophy: toTrophy(r) }));

    return { games: [...games.values()], recent };
  }

  artworkUrls(): string[] {
    return this.db
      .prepare<[], string>(
        `SELECT icon_url FROM trophies WHERE icon_url IS NOT NULL
         UNION SELECT icon_url FROM trophy_sets WHERE icon_url IS NOT NULL`,
      )
      .pluck()
      .all();
  }
}
