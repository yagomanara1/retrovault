import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Game, Trophy } from '@shared/types';
import { openDatabase } from '../../db/database';
import { GameRepository } from '../../db/repositories/gameRepository';
import { TrophyRepository } from '../../db/repositories/trophyRepository';
import { makeRpcs3, makeVita3k, rpcs3Tropusr, vita3kTropusr, type FixtureTrophy } from '../../testing/emulatorTrophyFixtures';
import { makeTree, useTempDir } from '../../testing/tempDir';
import type { ArtworkService } from '../artworkService';
import type { GameService } from '../gameService';
import type { SettingsService } from '../settingsService';
import { locateEmulatorTrophies, parseRpcs3Progress, parseVita3kProgress, rtcTickToDate } from './emulatorTrophies';
import type { TrpLocator } from './trpLocator';
import { TrophyService } from './trophyService';

const TROPHIES: FixtureTrophy[] = [
  { id: 0, grade: 'P', name: 'Platina' },
  { id: 1, grade: 'G', name: 'Ouro' },
  { id: 2, grade: 'B', name: 'Bronze', hidden: true },
];
const DAY1 = new Date('2026-10-01T12:00:00Z');
const DAY2 = new Date('2026-10-02T08:30:00Z');

const game = (over: Partial<Game>): Game =>
  ({ id: 1, title: 'Jogo', kind: 'executable', path: 'C:\\x.exe', launchArgs: null, consoleId: null, raGameId: null, ...over }) as Game;

describe('TROPUSR.DAT', () => {
  it('RPCS3: estado e data de cada troféu (CellRtcTick → data)', () => {
    const progress = parseRpcs3Progress(rpcs3Tropusr(TROPHIES, new Map([[1, DAY1], [2, null]])));
    expect(progress.get(0)).toEqual({ unlocked: false, at: null });
    expect(progress.get(1)).toEqual({ unlocked: true, at: DAY1 });
    expect(progress.get(2)).toEqual({ unlocked: true, at: null });
    expect(rtcTickToDate(0n)).toBeNull();
  });

  it('Vita3K: bits de desbloqueio e datas em segundos', () => {
    const progress = parseVita3kProgress(vita3kTropusr(TROPHIES, new Map([[2, DAY2], [100, null]])));
    expect([...progress.keys()].sort((a, b) => a - b)).toEqual([2, 100]);
    expect(progress.get(2)).toEqual({ unlocked: true, at: DAY2 });
  });

  it('arquivo de outro formato não passa por progresso', () => {
    expect(() => parseRpcs3Progress(Buffer.alloc(100))).toThrow(/RPCS3/);
    expect(() => parseVita3kProgress(Buffer.alloc(100))).toThrow(/Vita3K/);
  });
});

describe('onde estão os troféus de cada jogo', () => {
  const tmp = useTempDir();

  it('RPCS3: pelo EBOOT.BIN nos argumentos (TROPDIR do disco); antes de rodar no emulador, nada', async () => {
    const root = path.join(tmp(), 'RPCS3');
    const { exe, eboot } = await makeRpcs3(root, path.join(tmp(), 'Jogos', 'BLUS30001'), 'NPWR00123_00', 'Jogo de PS3', TROPHIES, null);
    const g = game({ path: exe, launchArgs: `--no-gui "${eboot}"` });
    expect(await locateEmulatorTrophies(g, tmp())).toEqual({
      emulator: 'rpcs3',
      npCommId: 'NPWR00123_00',
      folder: path.join(root, 'dev_hdd0', 'home', '00000001', 'trophy', 'NPWR00123_00'),
      progressPath: path.join(root, 'dev_hdd0', 'home', '00000001', 'trophy', 'NPWR00123_00', 'TROPUSR.DAT'),
    });
    await fs.rm(path.join(root, 'dev_hdd0', 'home'), { recursive: true });
    expect(await locateEmulatorTrophies(g, tmp())).toBeNull();
  });

  it('RPCS3: dev_hdd0 mudado de lugar no vfs.yml', async () => {
    const root = path.join(tmp(), 'RPCS3');
    const elsewhere = path.join(tmp(), 'HD');
    const { eboot } = await makeRpcs3(elsewhere, path.join(tmp(), 'Jogo'), 'NPWR00007_00', 'X', TROPHIES, null);
    // makeRpcs3 criou dev_hdd0 em "HD"; o RPCS3 em outra pasta aponta para lá.
    await makeTree(root, { 'rpcs3.exe': 'x', 'config/vfs.yml': `$(EmulatorDir): ""\n/dev_hdd0/: ${path.join(elsewhere, 'dev_hdd0')}/\n` });
    const found = await locateEmulatorTrophies(game({ path: path.join(root, 'rpcs3.exe'), launchArgs: `"${eboot}"` }), tmp());
    expect(found?.folder).toBe(path.join(elsewhere, 'dev_hdd0', 'home', '00000001', 'trophy', 'NPWR00007_00'));
  });

  it('RPCS3 sem o jogo nos argumentos: pelo nome, só se um único conjunto bater', async () => {
    const root = path.join(tmp(), 'RPCS3');
    await makeRpcs3(root, path.join(tmp(), 'J1'), 'NPWR00001_00', 'Demon’s Souls™', TROPHIES, null);
    await makeRpcs3(root, path.join(tmp(), 'J2'), 'NPWR00002_00', 'Outro Jogo', TROPHIES, null);
    const exe = path.join(root, 'rpcs3.exe');
    // Pontuação e símbolos não contam: apóstrofo comum ou tipográfico, com ou sem ™.
    expect((await locateEmulatorTrophies(game({ title: "Demon's Souls", path: exe }), tmp()))?.npCommId).toBe('NPWR00001_00');
    expect((await locateEmulatorTrophies(game({ title: 'Demons Souls', path: exe }), tmp()))?.npCommId).toBe('NPWR00001_00');
    expect(await locateEmulatorTrophies(game({ title: 'Nada a ver', path: exe }), tmp())).toBeNull();
  });

  it('Vita3K: pasta de dados do config.yml e o jogo do "-r"; sem "-r", nada', async () => {
    const exeDir = path.join(tmp(), 'Vita3K');
    const pref = path.join(tmp(), 'VitaDados');
    await makeTree(exeDir, { 'Vita3K.exe': 'x', 'config.yml': `pref-path: '${pref}'\n` });
    await makeVita3k(pref, 'PCSE00123', 'NPWR00456_00', 'Jogo de Vita', TROPHIES, null);
    const exe = path.join(exeDir, 'Vita3K.exe');
    expect(await locateEmulatorTrophies(game({ path: exe, launchArgs: '-r PCSE00123' }), tmp())).toEqual({
      emulator: 'vita3k',
      npCommId: 'NPWR00456_00',
      folder: path.join(pref, 'ux0', 'user', '00', 'trophy', 'conf', 'NPWR00456_00'),
      progressPath: path.join(pref, 'ux0', 'user', '00', 'trophy', 'data', 'NPWR00456_00', 'TROPUSR.DAT'),
    });
    expect(await locateEmulatorTrophies(game({ path: exe, launchArgs: null }), tmp())).toBeNull();
  });

  it('Vita3K na pasta padrão (%APPDATA%\\Vita3K\\Vita3K)', async () => {
    const appData = path.join(tmp(), 'AppData');
    await makeVita3k(path.join(appData, 'Vita3K', 'Vita3K'), 'PCSB00001', 'NPWR00009_00', 'V', TROPHIES, null);
    const found = await locateEmulatorTrophies(game({ path: path.join(tmp(), 'v', 'Vita3K.exe'), launchArgs: '-r PCSB00001' }), appData);
    expect(found?.npCommId).toBe('NPWR00009_00');
  });
});

describe('TrophyService com emuladores', () => {
  const tmp = useTempDir();

  async function setup() {
    const db = openDatabase(':memory:');
    const gameRepo = new GameRepository(db);
    const repo = new TrophyRepository(db);
    const root = path.join(tmp(), 'RPCS3');
    const { exe, eboot } = await makeRpcs3(root, path.join(tmp(), 'Disco'), 'NPWR00123_00', 'Jogo de PS3', TROPHIES, rpcs3Tropusr(TROPHIES, new Map([[1, DAY1]])));
    const g = gameRepo.create({ title: 'Jogo de PS3', kind: 'executable', path: exe, corePath: null, launchArgs: `"${eboot}"`, consoleId: null, raGameId: null, romHash: null, coverUrl: null, backgroundUrl: null, iconUrl: null });
    const unlockedEvents: Trophy[][] = [];
    let saved = 0;
    const service = new TrophyService(
      repo,
      { get: (id: number) => gameRepo.get(id)!, list: () => gameRepo.list() } as unknown as GameService,
      { getTrophyKey: () => null } as unknown as SettingsService,
      { saveImage: async () => `rv-media://artwork/${++saved}.png` } as unknown as ArtworkService,
      { locate: async () => null } as unknown as TrpLocator,
      { onUnlocked: (_g, t) => unlockedEvents.push(t), onAutoImported: () => {}, onLogAttached: () => {} },
      tmp(),
    );
    const progressFile = path.join(root, 'dev_hdd0', 'home', '00000001', 'trophy', 'NPWR00123_00', 'TROPUSR.DAT');
    return { db, repo, service, gameId: g.id, unlockedEvents, progressFile };
  }

  it('importa a lista do emulador em português, com ícones e os troféus já ganhos (sem notificação)', async () => {
    const { db, service, gameId, unlockedEvents, repo } = await setup();
    const set = await service.autoImport(gameId);
    expect(set).toMatchObject({ source: 'rpcs3', npCommId: 'NPWR00123_00', title: 'Jogo de PS3 (PT)', logPath: null });
    expect(set.progressPath).toMatch(/TROPUSR\.DAT$/);
    expect(set.trophies.map((t) => [t.id, t.name, t.grade, t.hidden, !!t.iconUrl])).toEqual([
      [0, 'PT Platina', 'P', false, true],
      [1, 'PT Ouro', 'G', false, true],
      [2, 'PT Bronze', 'B', true, true],
    ]);
    expect(set.trophies[1]!.unlockedAt).toBe(DAY1.toISOString()); // a data do emulador
    expect(unlockedEvents).toEqual([]);
    // No banco: 'ps4' + emulador (o CHECK antigo continua valendo); a página geral já mostra "rpcs3".
    expect(db.prepare('SELECT source, emulator FROM trophy_sets').get()).toEqual({ source: 'ps4', emulator: 'rpcs3' });
    expect(repo.overview(10).games[0]!.source).toBe('rpcs3');
  });

  it('troféu novo no emulador: entra com a data dele e avisa; não se marca à mão', async () => {
    const { service, gameId, unlockedEvents, progressFile } = await setup();
    await service.autoImport(gameId);
    await fs.writeFile(progressFile, rpcs3Tropusr(TROPHIES, new Map([[1, DAY1], [2, DAY2]])));
    expect(await service.syncEmulatorProgress(gameId, true)).toEqual([2]);
    expect(unlockedEvents.map((list) => list.map((t) => t.name))).toEqual([['PT Bronze']]);
    expect(service.get(gameId)!.trophies[2]!.unlockedAt).toBe(DAY2.toISOString());
    expect(await service.syncEmulatorProgress(gameId, true)).toEqual([]); // idempotente
    expect(() => service.setUnlocked(gameId, 0, true)).toThrow(/vêm do RPCS3/);
  });

  it('durante o jogo, o TROPUSR.DAT é conferido e a última leitura acontece ao fechar', async () => {
    const { service, gameId, unlockedEvents, progressFile } = await setup();
    await service.autoImport(gameId);
    service.watchEmulatorProgress(gameId);
    await fs.writeFile(progressFile, rpcs3Tropusr(TROPHIES, new Map([[1, DAY1], [2, DAY2], [0, DAY2]])));
    await service.stopWatchingEmulatorProgress(gameId);
    expect(unlockedEvents.flat().map((t) => t.id).sort()).toEqual([0, 2]);
  });
});
