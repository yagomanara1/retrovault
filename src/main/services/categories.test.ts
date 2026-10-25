import path from 'node:path';
import { categoryIconOf, isCategoryIconKey } from '@shared/categoryIcons';
import { CONSOLE_CATEGORIES, consoleCategoryByName, consoleOfPort } from '@shared/consoleCategories';
import { ConsoleId, CONSOLES } from '@shared/consoles';
import type { Game } from '@shared/types';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database';
import { CategoryRepository } from '../db/repositories/categoryRepository';
import { GameRepository } from '../db/repositories/gameRepository';
import { makeTree, useTempDir } from '../testing/tempDir';
import { CategoryService } from './categoryService';
import type { GameService } from './gameService';
import { detectPlatform, PLATFORM } from './platform';
import { SEED_CATALOG } from './store/seedCatalog';

const exe = (p: string, launchArgs: string | null = null) => ({ kind: 'executable' as const, path: p, launchArgs, consoleId: null });

describe('detectPlatform', () => {
  it('ROM: usa o console já identificado', () => {
    expect(detectPlatform({ kind: 'retroarch', path: 'x.nds', launchArgs: null, consoleId: ConsoleId.NDS })).toBe('Nintendo DS');
    expect(detectPlatform({ kind: 'retroarch', path: 'x.bin', launchArgs: null, consoleId: null })).toBeNull();
  });

  it('seus jogos: ports de PS4 pelos troféus; Pokémon pelo .nds ao lado do main.exe', () => {
    expect(detectPlatform(exe('C:\\J\\gow3-windows\\God of War III.exe'), { hasPs4Trophies: true })).toBe(PLATFORM.ps4);
    expect(detectPlatform(exe('C:\\J\\Pokemon Platinum\\main.exe'), { siblingFiles: ['main.exe', 'save.bin', 'Pokemon - Platinum Version (USA).nds', 'arm9.bin'] })).toBe(PLATFORM.ds);
  });

  it.each([
    ['C:\\Emu\\rpcs3.exe', null, PLATFORM.ps3],
    ['C:\\Emu\\citra-qt.exe', null, PLATFORM.n3ds],
    ['C:\\Emu\\Lime3DS.exe', null, PLATFORM.n3ds],
    ['C:\\Emu\\pcsx2-qt.exe', null, PLATFORM.ps2],
    ['C:\\Emu\\shadPS4.exe', '-g "D:\\PS4\\CUSA00207\\eboot.bin"', PLATFORM.ps4],
    ['C:\\Emu\\Ryujinx.exe', null, PLATFORM.switch],
    ['C:\\Emu\\launcher.bat', '"C:\\Emu\\citra.exe" "D:\\3DS\\Zelda.3ds"', PLATFORM.n3ds],
    ['C:\\Emu\\front.exe', '"D:\\Roms\\Pokemon X.cia"', PLATFORM.n3ds],
    ['D:\\PS3\\BLUS30001\\PS3_GAME\\USRDIR\\EBOOT.BIN', null, PLATFORM.ps3],
  ])('%s %s → %s', (p, args, expected) => {
    expect(detectPlatform(exe(p, args))).toBe(expected);
  });

  it('sem sinal não chuta (nem "PC"): melhor deixar o usuário escolher', () => {
    expect(detectPlatform(exe('C:\\Games\\Hollow Knight\\hollow_knight.exe'))).toBeNull();
    expect(detectPlatform(exe('C:\\Tools\\gow3-probe.exe'))).toBeNull(); // "-probe" não é sinal de PS4
  });

  it('pasta com arquivos de plataformas diferentes não decide nada', () => {
    expect(detectPlatform(exe('C:\\Mix\\app.exe'), { siblingFiles: ['a.nds', 'b.3ds'] })).toBeNull();
  });
});

describe('CategoryService', () => {
  const tmp = useTempDir('rv-cat-');

  function setup(ps4Ids: number[] = []) {
    const db = openDatabase(':memory:');
    const repo = new GameRepository(db);
    const games = { get: (id: number) => repo.get(id)!, list: () => repo.list() } as unknown as GameService;
    const service = new CategoryService({ repo: new CategoryRepository(db), games, hasPs4Trophies: (id) => ps4Ids.includes(id) });
    const add = (title: string, p: string, extra: Partial<Game> = {}) =>
      repo.create({ title, kind: extra.kind ?? 'executable', path: p, corePath: null, launchArgs: null, consoleId: extra.consoleId ?? null, raGameId: null, romHash: null, coverUrl: null, backgroundUrl: null, iconUrl: null });
    return { db, repo, service, add };
  }

  it('cria, recusa nome repetido (sem diferenciar maiúsculas) e valida o nome', () => {
    const { service } = setup();
    service.create('  PlayStation   4 ');
    expect(service.list().map((c) => c.name)).toEqual(['PlayStation 4']);
    expect(() => service.create('playstation 4')).toThrow(/Já existe/);
    expect(() => service.create('   ')).toThrow(/nome/);
    expect(() => service.create('x'.repeat(41))).toThrow(/40/);
  });

  it('um jogo em várias categorias; contagens; apagar a categoria não apaga o jogo', () => {
    const { service, add, repo } = setup();
    const g = add('GoW', 'C:\\g.exe');
    const ps4 = service.create('PS4');
    const fav = service.create('Ação');
    expect(service.setForGame(g.id, [ps4.id, fav.id]).categoryIds.sort()).toEqual([ps4.id, fav.id].sort());
    expect(service.list().map((c) => c.gameCount)).toEqual([1, 1]);
    service.delete(ps4.id);
    expect(repo.get(g.id)!.categoryIds).toEqual([fav.id]);
    expect(() => service.setForGame(g.id, [999])).toThrow(/não encontrada/);
  });

  it('reordena trocando com a vizinha', () => {
    const { service } = setup();
    const [a, b, c] = ['A', 'B', 'C'].map((n) => service.create(n));
    expect(service.move(c!.id, -1).map((x) => x.name)).toEqual(['A', 'C', 'B']);
    expect(service.move(a!.id, -1).map((x) => x.name)).toEqual(['A', 'C', 'B']); // já é o primeiro
    void b;
  });

  it('organizar automaticamente: cria por plataforma, só mexe em quem não tem categoria e lista os desconhecidos', async () => {
    await makeTree(tmp(), { 'Poke/main.exe': 'x', 'Poke/jogo.nds': 'x', 'HK/hollow.exe': 'x' });
    const { service, add, repo } = setup([1, 2]);
    add('God of War III', 'C:\\gow.exe'); // id 1: troféus de PS4
    add('Bloodborne', 'C:\\bb.exe'); // id 2: troféus de PS4
    add('Pokemon Platinum', path.join(tmp(), 'Poke/main.exe'));
    add('Hollow Knight', path.join(tmp(), 'HK/hollow.exe'));
    const chrono = add('Chrono Trigger', 'C:\\roms\\ct.sfc', { kind: 'retroarch', consoleId: ConsoleId.SNES });
    const mine = service.create('Favoritos');
    service.setForGame(chrono.id, [mine.id]); // já organizado pelo usuário: não muda

    const r = await service.autoOrganize();
    expect(r.categoriesCreated.sort()).toEqual(['Nintendo DS', 'PlayStation 4']);
    expect(r.gamesAssigned).toBe(3);
    expect(r.unknown).toEqual(['Hollow Knight']);
    expect(repo.get(chrono.id)!.categoryIds).toEqual([mine.id]);

    // Rodar de novo não duplica nada.
    expect(await service.autoOrganize()).toMatchObject({ categoriesCreated: [], gamesAssigned: 0 });
  });

  it('jogo novo entra na categoria da plataforma só se ela já existir', async () => {
    const { service, add, repo } = setup([1]);
    const g = add('GoW', 'C:\\gow.exe');
    expect(await service.assignNewGame(g.id)).toBe(false); // não existe "PlayStation 4" ainda
    service.create('PlayStation 4');
    expect(await service.assignNewGame(g.id)).toBe(true);
    expect(repo.get(g.id)!.categoryIds).toHaveLength(1);
  });
});

describe('categorias de console', () => {
  function setup() {
    const db = openDatabase(':memory:');
    const games = new GameRepository(db);
    const gameService = { get: (id: number) => games.get(id)!, list: () => games.list() } as unknown as GameService;
    const service = new CategoryService({ repo: new CategoryRepository(db), games: gameService, hasPs4Trophies: () => false });
    const add = (title: string, p: string) =>
      games.create({ title, kind: 'executable', path: p, corePath: null, launchArgs: null, consoleId: null, raGameId: null, romHash: null, coverUrl: null, backgroundUrl: null, iconUrl: null });
    return { service, games, add };
  }
  const byConsole = (service: CategoryService, key: string) => service.list().find((c) => c.console === key);

  it('cria uma categoria para cada console, com o console ligado (o ícone vem dele)', () => {
    const { service } = setup();
    expect(service.ensureConsoleCategories()).toBe(CONSOLE_CATEGORIES.length);
    const list = service.list();
    expect(list.map((c) => c.console)).toEqual(CONSOLE_CATEGORIES.map((c) => c.key));
    expect(categoryIconOf(byConsole(service, 'ps2')!)).toBe('ps2');
    expect(categoryIconOf(byConsole(service, 'xbox360')!)).toBe('xbox360');
    expect(service.ensureConsoleCategories()).toBe(0); // rodar de novo não duplica
  });

  it('liga a categoria que o usuário já tinha ("PS4") em vez de criar outra; o nome dele fica', () => {
    const { service } = setup();
    const mine = service.create('PS4');
    service.ensureConsoleCategories();
    expect(byConsole(service, 'ps4')).toMatchObject({ id: mine.id, name: 'PS4' });
    expect(service.list().filter((c) => /playstation 4|ps4/i.test(c.name))).toHaveLength(1);
  });

  it('o console apagado pelo usuário não volta na próxima abertura', () => {
    const { service } = setup();
    service.ensureConsoleCategories();
    service.delete(byConsole(service, 'msx')!.id);
    service.ensureConsoleCategories();
    expect(byConsole(service, 'msx')).toBeUndefined();
  });

  it('port da Loja entra na categoria do console original; sistema exato vence a família', () => {
    const { service, games, add } = setup();
    service.ensureConsoleCategories();
    const fukami = add('Fukami', 'C:\\Ports\\fukami\\Fukami.exe');
    expect(service.assignPortGame(fukami.id, { platform: 'playstation', system: 'PlayStation 2' })).toBe(true);
    expect(games.get(fukami.id)!.categoryIds).toEqual([byConsole(service, 'ps2')!.id]);
    const sotn = add('SymphonyRecomp', 'C:\\Ports\\sotn\\sotn.exe');
    service.assignPortGame(sotn.id, { platform: 'playstation' });
    expect(games.get(sotn.id)!.categoryIds).toEqual([byConsole(service, 'ps1')!.id]);
    // Já organizado pelo usuário: não mexe.
    expect(service.assignPortGame(fukami.id, { platform: 'n64' })).toBe(false);
  });

  it('jogo detectado como "Xbox 360" cai na categoria ligada ao console, mesmo renomeada', async () => {
    const { service, games, add } = setup();
    service.ensureConsoleCategories();
    const x360 = byConsole(service, 'xbox360')!;
    service.rename(x360.id, 'Meus jogos de 360');
    const g = add('Jogo', 'C:\\Emu\\xenia_canary.exe');
    expect(await service.assignNewGame(g.id)).toBe(true);
    expect(games.get(g.id)!.categoryIds).toEqual([x360.id]);
  });
});

describe('catálogo de consoles', () => {
  it('todo nome que a detecção de plataforma devolve tem o seu console', () => {
    const names = [...Object.values(PLATFORM), ...CONSOLES.map((c) => c.name)];
    for (const name of names) expect(consoleCategoryByName(name)?.name, name).toBe(name);
  });

  it('chaves e apelidos não se repetem entre consoles', () => {
    const keys = CONSOLE_CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of CONSOLE_CATEGORIES) {
      for (const alias of c.aliases) expect(consoleCategoryByName(alias)?.key, alias).toBe(c.key);
      expect(isCategoryIconKey(c.icon), c.key).toBe(true);
    }
  });

  it('todo port do catálogo embutido tem um console', () => {
    for (const p of SEED_CATALOG.ports) expect(consoleOfPort(p.original as Parameters<typeof consoleOfPort>[0]), p.id).toBeDefined();
  });
});
