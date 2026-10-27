import { promises as fs } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Game, Trophy } from '@shared/types';
import { openDatabase } from '../../db/database';
import { GameRepository } from '../../db/repositories/gameRepository';
import { TrophyRepository } from '../../db/repositories/trophyRepository';
import { makeTree, useTempDir } from '../../testing/tempDir';
import type { ArtworkService } from '../artworkService';
import type { GameService } from '../gameService';
import type { SettingsService } from '../settingsService';
import type { TrpLocator } from './trpLocator';
import { TrophyService } from './trophyService';

/** Serviço com os repositórios de verdade; jogos, arte e localização do .trp de mentira. */
function setup(dir: string) {
  const db = openDatabase(':memory:');
  const gameRepo = new GameRepository(db);
  const repo = new TrophyRepository(db);
  const events = { unlocked: [] as { game: string; trophies: Trophy[] }[], attached: [] as string[] };
  const games = {
    get: (id: number) => gameRepo.get(id) ?? (() => { throw Object.assign(new Error('não achou'), { code: 'NOT_FOUND' }); })(),
    find: (id: number) => gameRepo.get(id),
    list: () => gameRepo.list(),
  } as unknown as GameService;
  const service = new TrophyService(
    repo,
    games,
    { getTrophyKey: () => null } as unknown as SettingsService,
    { saveImage: async () => 'rv-media://artwork/x.png' } as unknown as ArtworkService,
    { locate: async () => null } as unknown as TrpLocator,
    {
      onUnlocked: (game, trophies) => events.unlocked.push({ game: game.title, trophies }),
      onAutoImported: () => {},
      onLogAttached: (_game: Game, logPath: string) => events.attached.push(logPath),
    },
    dir,
  );
  const addGame = (exe: string) =>
    gameRepo.create({ title: path.basename(exe, '.exe'), kind: 'executable', path: exe, corePath: null, launchArgs: null, consoleId: null, raGameId: null, romHash: null, coverUrl: null, backgroundUrl: null, iconUrl: null });
  return { service, repo, events, addGame };
}

/** Lista manual com platina, ouro e bronze (troféu novo vai sem trophyId: recebe 0, 1, 2…). */
async function manualList(service: TrophyService, gameId: number) {
  await service.createManual(gameId);
  service.upsert({ gameId, name: ' Platina ', detail: '', grade: 'P', hidden: false });
  service.upsert({ gameId, name: 'Ouro', detail: ' Vença o chefe ', grade: 'G', hidden: false });
  return service.upsert({ gameId, name: 'Bronze', detail: '', grade: 'B', hidden: true });
}

const unlockedIds = (service: TrophyService, gameId: number) => service.get(gameId)!.trophies.filter((t) => t.unlockedAt).map((t) => t.id);

describe('TrophyService: listas e log do port', () => {
  const tmp = useTempDir();
  let exe: string;

  beforeEach(async () => {
    await makeTree(tmp(), { 'Port/port.exe': 'MZ', 'Port/user/': null, 'Outro/outro.exe': 'MZ' });
    exe = path.join(tmp(), 'Port', 'port.exe');
  });

  it('lista manual: textos aparados e log do port detectado em user/last_run.log', async () => {
    const { service, addGame } = setup(tmp());
    const set = await manualList(service, addGame(exe).id);
    expect(set).toMatchObject({ source: 'manual', logPath: path.join(tmp(), 'Port', 'user', 'last_run.log') });
    expect(set.trophies.map((t) => [t.id, t.name, t.detail])).toEqual([
      [0, 'Platina', ''],
      [1, 'Ouro', 'Vença o chefe'],
      [2, 'Bronze', ''],
    ]);
  });

  it('platina vem sozinha quando todos os outros são ganhos, e só então', async () => {
    const { service, addGame } = setup(tmp());
    const { id } = addGame(exe);
    await manualList(service, id);
    service.setUnlocked(id, 1, true);
    expect(unlockedIds(service, id)).toEqual([1]);
    service.setUnlocked(id, 2, true);
    expect(unlockedIds(service, id)).toEqual([0, 1, 2]);
    service.setUnlocked(id, 2, false);
    expect(unlockedIds(service, id)).toEqual([0, 1]);
  });

  it('log do port: desbloqueia os ids conhecidos, avisa só os novos (com a platina) e guarda o cursor', async () => {
    const { service, events, addGame } = setup(tmp());
    const { id } = addGame(exe);
    await manualList(service, id);
    service.applyLogProgress(id, 120, 'abc', [1, 2, 99]);
    expect(events.unlocked).toEqual([{ game: 'port', trophies: expect.any(Array) }]);
    expect(events.unlocked[0]!.trophies.map((t) => t.id).sort()).toEqual([0, 1, 2]);
    expect(service.watchedSets().find((w) => w.gameId === id)).toMatchObject({ cursor: 120, tailHash: 'abc' });

    service.applyLogProgress(id, 200, 'def', [1]);
    expect(events.unlocked).toHaveLength(1);
    expect(service.watchedSets().find((w) => w.gameId === id)).toMatchObject({ cursor: 200 });
  });

  it('sem lista, editar troféus vira NOT_FOUND', () => {
    const { service, addGame } = setup(tmp());
    const { id } = addGame(exe);
    expect(() => service.upsert({ gameId: id, trophyId: 1, name: 'x', detail: '', grade: 'B', hidden: false })).toThrow(/ainda não tem lista/);
    expect(() => service.setUnlocked(id, 1, true)).toThrow(/ainda não tem lista/);
    expect(() => service.delete(id, 1)).toThrow(/ainda não tem lista/);
  });

  it('jogo movido: o log dentro da pasta do jogo vai junto; fora dela, fica', async () => {
    const { service, addGame } = setup(tmp());
    const { id } = addGame(exe);
    await manualList(service, id);
    const moved = path.join(tmp(), 'Novo', 'port.exe');
    service.onGameMoved(id, exe, moved);
    expect(service.get(id)!.logPath).toBe(path.join(tmp(), 'Novo', 'user', 'last_run.log'));

    const outside = path.join(tmp(), 'logs', 'meu.log');
    await service.configureLog(id, outside);
    // Pasta mais funda: seguir o caminho relativo daria em outro arquivo.
    service.onGameMoved(id, moved, path.join(tmp(), 'Fundo', 'Mais', 'port.exe'));
    expect(service.get(id)!.logPath).toBe(outside);
  });

  it('log que aparece depois (primeira execução) é ligado sozinho; desligado pelo usuário fica', async () => {
    const { service, events, addGame } = setup(tmp());
    const other = path.join(tmp(), 'Outro', 'outro.exe');
    const a = addGame(other);
    const b = addGame(exe);
    await service.createManual(a.id);
    await service.createManual(b.id);
    await service.configureLog(b.id, null);
    expect(service.get(a.id)!.logPath).toBeNull();

    await fs.mkdir(path.join(tmp(), 'Outro', 'user'));
    await service.attachMissingLogs();
    expect(service.get(a.id)!.logPath).toBe(path.join(tmp(), 'Outro', 'user', 'last_run.log'));
    expect(service.get(b.id)!.logPath).toBeNull();
    expect(events.attached).toEqual([path.join(tmp(), 'Outro', 'user', 'last_run.log')]);
  });

  it('detecção "auto" sem a pasta user/ avisa para escolher o arquivo', async () => {
    const { service, addGame } = setup(tmp());
    const { id } = addGame(path.join(tmp(), 'Outro', 'outro.exe'));
    await service.createManual(id);
    await expect(service.configureLog(id, 'auto')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
