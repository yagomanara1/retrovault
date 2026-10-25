import { describe, expect, it } from 'vitest';
import type { ArtworkSlot, Game } from '@shared/types';
import { AppError } from '../errors';
import { GameArtService, type GameArtDeps } from './gameArtService';
import type { SgdbImage, SgdbKind } from './store/steamGridDb';

const CDN = 'https://cdn2.steamgriddb.com';

function game(over: Partial<Game> = {}): Game {
  return {
    id: 1,
    title: 'Pokemon Brilliant Diamond',
    kind: 'executable',
    path: 'C:\\Jogos\\bd.exe',
    corePath: null,
    launchArgs: null,
    consoleId: null,
    raGameId: null,
    romHash: null,
    coverUrl: null,
    backgroundUrl: null,
    iconUrl: 'rv-media://artwork/exe.png',
    favorite: false,
    playtimeSeconds: 0,
    lastPlayedAt: null,
    createdAt: '',
    categoryIds: [],
    ...over,
  } as Game;
}

function img(kind: SgdbKind, n: number): SgdbImage {
  return { url: `${CDN}/${kind}/${n}.png`, thumb: `${CDN}/thumb/${kind}/${n}.png`, width: 600, height: 900 };
}

function setup(opts: { key?: string | null; games?: Game[]; defaultIcon?: boolean; noResults?: boolean } = {}) {
  const library = new Map((opts.games ?? [game()]).map((g) => [g.id, { ...g }]));
  const imported: string[] = [];
  const sgdbCalls: string[] = [];
  const deps: GameArtDeps = {
    games: {
      get: (id) => {
        const g = library.get(id);
        if (!g) throw new AppError('NOT_FOUND', 'x');
        return g;
      },
      list: () => [...library.values()],
      setArtworkUrl: (id, slot: ArtworkSlot, url) => {
        const g = library.get(id)!;
        if (slot === 'cover') g.coverUrl = url;
        if (slot === 'background') g.backgroundUrl = url;
        if (slot === 'icon') g.iconUrl = url;
        return g;
      },
      hasDefaultIcon: async (g) => (opts.defaultIcon ?? true) && g.iconUrl === 'rv-media://artwork/exe.png',
    },
    sgdb: {
      search: async (title) => {
        sgdbCalls.push(`search:${title}`);
        return opts.noResults ? [] : [{ id: 7, name: 'Pokémon Brilliant Diamond' }, { id: 8, name: 'Pokémon Shining Pearl' }];
      },
      bestMatch: async (title) => {
        sgdbCalls.push(`best:${title}`);
        return opts.noResults ? null : { id: 7, name: 'Pokémon Brilliant Diamond' };
      },
      images: async (gameId, kind) => {
        sgdbCalls.push(`images:${gameId}:${kind}`);
        return [img(kind, 1), img(kind, 2)];
      },
      firstOfEach: async () => ({ cover: img('cover', 1).url, hero: img('hero', 1).url, icon: img('icon', 1).url }),
    },
    importRemote: async (url) => {
      imported.push(url);
      return `rv-media://artwork/${encodeURIComponent(url).replace(/%/g, '').slice(-32)}.png`;
    },
    sgdbKey: () => (opts.key === undefined ? 'chave' : opts.key),
  };
  return { service: new GameArtService(deps), library, imported, sgdbCalls };
}

describe('GameArtService', () => {
  it('sem chave: a busca explica como conectar; o automático não faz nada', async () => {
    const { service } = setup({ key: null });
    await expect(service.search(1)).rejects.toMatchObject({ code: 'VALIDATION', message: expect.stringMatching(/SteamGridDB/) });
    expect(await service.autoFill(1)).toBeNull();
  });

  it('busca: escolhe o jogo de nome igual (sem acento), devolve opções com miniaturas locais e não busca de novo', async () => {
    const { service, sgdbCalls } = setup();
    const r = await service.search(1);
    expect(r.selectedGameId).toBe(7);
    expect(r.games.map((g) => g.id)).toEqual([7, 8]);
    expect(r.cover).toHaveLength(2);
    expect(r.cover[0]).toMatchObject({ url: `${CDN}/cover/1.png`, thumb: expect.stringMatching(/^rv-media:\/\//) });
    expect(r.background[0]!.url).toContain('/hero/');
    expect(sgdbCalls.filter((c) => c.startsWith('search')).length).toBe(1);
    // Trocar de jogo na lista.
    expect((await service.search(1, undefined, 8)).selectedGameId).toBe(8);
  });

  it('aplicar: só imagens do CDN do SteamGridDB', async () => {
    const { service, library } = setup();
    await expect(service.apply(1, 'cover', 'https://raw.githubusercontent.com/x/y/z.png')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await service.apply(1, 'cover', `${CDN}/cover/2.png`);
    expect(library.get(1)!.coverUrl).toMatch(/^rv-media:\/\//);
  });

  it('automático: preenche capa, fundo e o ícone padrão do .exe, sem tocar no que o usuário escolheu', async () => {
    const { service, library } = setup({ games: [game({ backgroundUrl: 'rv-media://artwork/meu-fundo.jpg' })] });
    expect(await service.autoFill(1)).not.toBeNull();
    const g = library.get(1)!;
    expect(g.coverUrl).toMatch(/^rv-media:\/\//);
    expect(g.backgroundUrl).toBe('rv-media://artwork/meu-fundo.jpg');
    expect(g.iconUrl).not.toBe('rv-media://artwork/exe.png');
  });

  it('automático: ícone escolhido pelo usuário fica; ROM (RetroArch) fica com a arte do RetroAchievements', async () => {
    const custom = setup({ defaultIcon: false });
    await custom.service.autoFill(1);
    expect(custom.library.get(1)!.iconUrl).toBe('rv-media://artwork/exe.png');
    const rom = setup({ games: [game({ kind: 'retroarch', iconUrl: null })] });
    expect(await rom.service.autoFill(1)).toBeNull();
    expect(rom.imported).toEqual([]);
  });

  it('buscar artes que faltam: conta os atualizados e lista os sem resultado', async () => {
    const found = setup({ games: [game({ id: 1 }), game({ id: 2, title: 'Outro', coverUrl: 'rv-media://artwork/ja-tem.jpg' })] });
    expect(await found.service.fillMissing()).toEqual({ updated: 1, notFound: [] });
    const none = setup({ noResults: true });
    expect(await none.service.fillMissing()).toEqual({ updated: 0, notFound: ['Pokemon Brilliant Diamond'] });
  });
});
