import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyPendingRestore, BackupService } from '../services/backupService';
import { ProgressService } from '../services/progressService';
import { useTempDir } from '../testing/tempDir';
import { type DB, openDatabase } from './database';
import { type Migration, migrations } from './migrations';
import { GameRepository, type NewGameRecord } from './repositories/gameRepository';
import { type TrophyRecord, TrophyRepository } from './repositories/trophyRepository';

// Camada de banco com o better-sqlite3 real (o mesmo binário do app, via Node do Electron).

const tmp = useTempDir('rv-db-');

function newGame(repo: GameRepository, title: string, filePath = `C:\\Jogos\\${title}\\${title}.exe`) {
  const record: NewGameRecord = {
    title,
    kind: 'executable',
    path: filePath,
    corePath: null,
    launchArgs: null,
    consoleId: null,
    raGameId: null,
    romHash: null,
    coverUrl: null,
    backgroundUrl: null,
    iconUrl: null,
  };
  return repo.create(record);
}

const trophies = (grades: string): TrophyRecord[] =>
  [...grades].map((g, i) => ({ trophyId: i, name: `T${i}`, detail: '', grade: g as TrophyRecord['grade'], hidden: false, iconUrl: null }));

function setup(file = ':memory:'): { db: DB; games: GameRepository; repo: TrophyRepository } {
  const db = openDatabase(file);
  return { db, games: new GameRepository(db), repo: new TrophyRepository(db) };
}

const ps4Set = (gameId: number, npCommId = 'NPWR00001_00', logPath: string | null = null) => ({
  gameId,
  source: 'ps4' as const,
  npCommId,
  title: 'Set',
  iconUrl: null,
  logPath,
});

describe('migrations', () => {
  it('banco novo recebe todas, sem backup antes (não há o que proteger)', () => {
    let backups = 0;
    const db = openDatabase(':memory:', { beforeMigrate: () => backups++ });
    expect(db.prepare('SELECT COUNT(*) FROM schema_migrations').pluck().get()).toBe(migrations.length);
    expect(backups).toBe(0);
  });

  it('banco existente com migration pendente chama beforeMigrate uma vez, antes de migrar', () => {
    const file = path.join(tmp(), 'app.db');
    openDatabase(file).close();
    const current = migrations[migrations.length - 1]!.version;
    // Simula uma atualização do app com uma migration nova (genérico: não depende de qual é a última real).
    const list = migrations as Migration[];
    list.push({ version: current + 1, name: 'teste', sql: 'CREATE TABLE teste_migration (x INTEGER)' });
    try {
      const seen: number[] = [];
      const db = openDatabase(file, {
        beforeMigrate: (d) => seen.push(d.prepare<[], number>('SELECT MAX(version) FROM schema_migrations').pluck().get()!),
      });
      expect(seen).toEqual([current]); // o backup viu o esquema antigo
      expect(db.prepare('SELECT MAX(version) FROM schema_migrations').pluck().get()).toBe(current + 1);
      db.close();
    } finally {
      list.pop();
    }
  });
});

describe('TrophyRepository', () => {
  it('reimportar a lista preserva os troféus já obtidos', () => {
    const { games, repo } = setup();
    const g = newGame(games, 'GoW');
    repo.replaceSet(ps4Set(g.id), trophies('PGB'));
    repo.unlock(g.id, [2], 'auto', '2026-10-21T10:00:00.000Z');
    repo.replaceSet(ps4Set(g.id), trophies('PGBB'));
    const set = repo.getSet(g.id)!;
    expect(set.trophies).toHaveLength(4);
    expect(set.trophies.find((t) => t.id === 2)).toMatchObject({ unlockedAt: '2026-10-21T10:00:00.000Z', unlockSource: 'auto' });
  });

  it('unlock é idempotente e só devolve o que mudou', () => {
    const { games, repo } = setup();
    const g = newGame(games, 'A');
    repo.replaceSet(ps4Set(g.id), trophies('BB'));
    expect(repo.unlock(g.id, [0, 1], 'auto')).toEqual([0, 1]);
    expect(repo.unlock(g.id, [0, 1], 'auto')).toEqual([]);
  });

  it('remover a lista impede a importação automática; importar de novo libera', () => {
    const { games, repo } = setup();
    const a = newGame(games, 'A');
    const b = newGame(games, 'B');
    expect(repo.gamesPendingAutoImport()).toEqual([a.id, b.id]);
    repo.replaceSet(ps4Set(a.id), trophies('B'));
    repo.deleteSet(a.id);
    expect(repo.gamesPendingAutoImport()).toEqual([b.id]); // opt-out
    repo.createManualSet(a.id, null);
    repo.deleteSet(a.id);
    repo.replaceSet(ps4Set(a.id), trophies('B'));
    expect(repo.gamesPendingAutoImport()).toEqual([b.id]); // tem lista de novo
  });

  it('log desativado pelo usuário não é religado nem por reimportação', () => {
    const { games, repo } = setup();
    const g = newGame(games, 'BB');
    repo.replaceSet(ps4Set(g.id), trophies('B'));
    expect(repo.setsMissingLog()).toEqual([g.id]); // sem log ainda: pode ser ligado depois
    repo.attachLog(g.id, 'C:\\x\\user\\last_run.log');
    expect(repo.getSet(g.id)!.logPath).toBe('C:\\x\\user\\last_run.log');

    repo.setLogPath(g.id, null); // "Desativar"
    expect(repo.setsMissingLog()).toEqual([]);
    repo.attachLog(g.id, 'C:\\outro.log');
    expect(repo.getSet(g.id)!.logPath).toBeNull();
    repo.replaceSet(ps4Set(g.id, 'NPWR00001_00', 'C:\\novo.log'), trophies('B'));
    expect(repo.getSet(g.id)!.logPath).toBeNull();
  });

  it('overview agrega por jogo e grau e lista os recentes em ordem', () => {
    const { games, repo } = setup();
    const a = newGame(games, 'A');
    const b = newGame(games, 'B');
    repo.replaceSet(ps4Set(a.id), trophies('PGSB'));
    repo.replaceSet(ps4Set(b.id, 'NPWR00002_00'), trophies('BB'));
    repo.unlock(a.id, [3], 'auto', '2026-10-20T00:00:00.000Z');
    repo.unlock(b.id, [0], 'manual', '2026-10-22T00:00:00.000Z');

    const o = repo.overview(10);
    const ga = o.games.find((g) => g.gameId === a.id)!;
    expect(ga.byGrade).toEqual({ P: { total: 1, unlocked: 0 }, G: { total: 1, unlocked: 0 }, S: { total: 1, unlocked: 0 }, B: { total: 1, unlocked: 1 } });
    expect(ga.lastUnlockedAt).toBe('2026-10-20T00:00:00.000Z');
    expect(o.recent.map((r) => [r.gameTitle, r.trophy.id])).toEqual([
      ['B', 0],
      ['A', 3],
    ]);
  });

  it('apagar o jogo apaga lista, troféus e opt-out (cascata)', () => {
    const { db, games, repo } = setup();
    const g = newGame(games, 'A');
    repo.replaceSet(ps4Set(g.id), trophies('BB'));
    games.remove(g.id);
    expect(db.prepare('SELECT COUNT(*) FROM trophies').pluck().get()).toBe(0);
  });
});

describe('GameRepository.mergePlaytime', () => {
  it('fica com o maior tempo e a data mais recente; sem mudança devolve false', () => {
    const { games } = setup();
    const g = newGame(games, 'A');
    expect(games.mergePlaytime(g.id, 600, '2026-10-01T00:00:00Z')).toBe(true);
    expect(games.mergePlaytime(g.id, 100, '2026-09-01T00:00:00Z')).toBe(false);
    expect(games.get(g.id)).toMatchObject({ playtimeSeconds: 600, lastPlayedAt: '2026-10-01T00:00:00Z' });
  });

  it('caminho já usado por outro jogo viola UNIQUE (a UI mostra DUPLICATE)', () => {
    const { games } = setup();
    newGame(games, 'A', 'C:\\x.exe');
    const b = newGame(games, 'B', 'C:\\y.exe');
    expect(() => games.updatePath(b.id, 'C:\\x.exe')).toThrow(/UNIQUE/);
  });
});

describe('ProgressService', () => {
  it('exportar → perder → importar devolve troféus (com data original) e tempo de jogo', async () => {
    const { games, repo } = setup();
    const svc = new ProgressService(games, repo);
    const g = newGame(games, 'God of War III');
    repo.replaceSet(ps4Set(g.id, 'NPWR08268_00'), trophies('PBB'));
    repo.unlock(g.id, [1, 2], 'manual', '2026-10-22T02:46:57.605Z');
    games.mergePlaytime(g.id, 624, '2026-10-22T03:00:00Z');
    const file = path.join(tmp(), 'progresso.json');
    await svc.export(file);

    // Perda total + jogo mudou de pasta: o NPCommID ainda reconhece o jogo.
    const fresh = setup();
    const moved = newGame(fresh.games, 'GoW3', 'D:\\OutroDisco\\gow3\\God of War III.exe');
    fresh.repo.replaceSet(ps4Set(moved.id, 'NPWR08268_00'), trophies('PBB'));
    const result = await new ProgressService(fresh.games, fresh.repo).import(file);

    expect(result).toEqual({ gamesMatched: 1, trophiesRestored: 2, playtimeUpdated: 1, gamesNotFound: [] });
    expect(fresh.repo.getSet(moved.id)!.trophies.filter((t) => t.unlockedAt).map((t) => t.unlockedAt)).toEqual([
      '2026-10-22T02:46:57.605Z',
      '2026-10-22T02:46:57.605Z',
    ]);
    expect(fresh.games.get(moved.id)!.playtimeSeconds).toBe(624);

    // Importar de novo não muda nada.
    expect(await new ProgressService(fresh.games, fresh.repo).import(file)).toMatchObject({ trophiesRestored: 0, playtimeUpdated: 0 });
  });

  it('jogos sem correspondência são listados; arquivo inválido é recusado', async () => {
    const { games, repo } = setup();
    const svc = new ProgressService(games, repo);
    newGame(games, 'Só Aqui');
    const file = path.join(tmp(), 'p.json');
    await svc.export(file);
    const other = setup();
    expect((await new ProgressService(other.games, other.repo).import(file)).gamesNotFound).toEqual(['Só Aqui']);

    await fs.writeFile(path.join(tmp(), 'ruim.json'), '{"format":"outro"}');
    await expect(svc.import(path.join(tmp(), 'ruim.json'))).rejects.toThrow(/não é um progresso/);
  });
});

describe('BackupService', () => {
  it('backup, restauração em duas fases e cópia "antes de restaurar"', async () => {
    const dbFile = path.join(tmp(), 'retrovault.db');
    const dir = path.join(tmp(), 'backups');
    let { db, games } = setup(dbFile);
    newGame(games, 'Antes');
    const backups = new BackupService(db, dbFile, dir);
    const saved = await backups.create('manual');
    newGame(games, 'Depois');

    await backups.scheduleRestore(saved.name);
    db.close();
    expect(applyPendingRestore(dbFile, dir)).toBe(true);
    expect(applyPendingRestore(dbFile, dir)).toBe(false); // nada pendente

    ({ db, games } = setup(dbFile));
    expect(games.list().map((g) => g.title)).toEqual(['Antes']);
    const kinds = (await new BackupService(db, dbFile, dir).list()).map((b) => b.kind).sort();
    expect(kinds).toEqual(['manual', 'pre-restore']);
    db.close();
  });

  it('recusa nomes fora do padrão (path traversal) e arquivos que não são backups', async () => {
    const { db } = setup();
    const dir = path.join(tmp(), 'backups');
    const backups = new BackupService(db, path.join(tmp(), 'x.db'), dir);
    await expect(backups.scheduleRestore('..\\..\\retrovault.db')).rejects.toThrow(/inválido/);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'retrovault-manual-20260101-000000.db'), 'não é sqlite');
    await expect(backups.scheduleRestore('retrovault-manual-20260101-000000.db')).rejects.toThrow(/corrompido/);
  });

  it('poda: guarda só os mais recentes de cada tipo', async () => {
    const { db } = setup();
    const dir = path.join(tmp(), 'backups');
    await fs.mkdir(dir, { recursive: true });
    for (let day = 1; day <= 9; day++) {
      await fs.writeFile(path.join(dir, `retrovault-auto-202610${String(day).padStart(2, '0')}-120000.db`), 'x');
    }
    const backups = new BackupService(db, path.join(tmp(), 'x.db'), dir);
    await backups.ensureDaily(); // cria o de hoje e poda para 7
    const autos = (await backups.list()).filter((b) => b.kind === 'auto');
    expect(autos).toHaveLength(7);
    expect(autos.some((b) => b.name.includes('20261001'))).toBe(false); // o mais antigo saiu
  });
});
