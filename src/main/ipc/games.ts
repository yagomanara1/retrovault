// Rotas da biblioteca: jogos, importação, arte, troféus locais e categorias.
import { z } from 'zod';
import type { Container } from '../container';
import { IMAGE_EXTENSIONS } from '../services/artworkService';
import { nearestExistingDir } from '../services/relocationService';
import { FILE_FILTERS, filePath, handle, id, optionalNullableId, pickFile, showOpen } from './core';

const gameKind = z.enum(['retroarch', 'executable']);
const artSlot = z.enum(['cover', 'background', 'icon']);
const trophyId = z.number().int().min(0);

const schemas = {
  inspect: z.object({ path: filePath, kind: gameKind }),
  newGame: z.object({
    kind: gameKind,
    path: filePath,
    title: z.string().max(200).optional(),
    corePath: filePath.nullable().optional(),
    launchArgs: z.string().max(2000).nullable().optional(),
    consoleId: optionalNullableId,
    raGameId: optionalNullableId,
  }),
  updateGame: z.object({
    id,
    title: z.string().max(200).optional(),
    corePath: filePath.nullable().optional(),
    launchArgs: z.string().max(2000).nullable().optional(),
    consoleId: optionalNullableId,
    raGameId: optionalNullableId,
    favorite: z.boolean().optional(),
  }),
  relocate: z.object({ id, action: z.enum(['pick', 'auto']) }),
  addMany: z.object({
    items: z
      .array(
        z.object({
          kind: gameKind,
          path: filePath,
          title: z.string().trim().min(1).max(200),
          consoleId: id.nullable(),
          // Só um número: vira steam://rungameid/<id> ao abrir.
          steamAppId: id.max(0xffffffff).nullable().optional(),
        }),
      )
      .min(1)
      .max(5000),
  }),
  setArtwork: z.object({ id, slot: artSlot, action: z.enum(['pick', 'reset']) }),
  artSearch: z.object({ id, query: z.string().trim().max(100).optional(), sgdbGameId: id.optional() }),
  artApply: z.object({ id, slot: artSlot, url: z.string().url().max(500) }),
  // Imagem do editor de enquadramento: no máximo ~12 MB em base64 (a capa sai com uns 300 KB).
  artData: z.object({ id, slot: artSlot, data: z.string().min(16).max(16_000_000).regex(/^[A-Za-z0-9+/]+=*$/) }),
  trophyInput: z.object({
    gameId: id,
    trophyId: trophyId.optional(),
    name: z.string().trim().min(1).max(120),
    detail: z.string().trim().max(500),
    grade: z.enum(['P', 'G', 'S', 'B']),
    hidden: z.boolean(),
  }),
  trophyRef: z.object({ gameId: id, trophyId }),
  trophyUnlock: z.object({ gameId: id, trophyId, unlocked: z.boolean() }),
  trophyLog: z.object({ gameId: id, action: z.enum(['pick', 'auto', 'clear']) }),
  categoryName: z.string().max(200),
  categoryRename: z.object({ id, name: z.string().max(200) }),
  categoryIcon: z.object({ id, icon: z.string().max(32).nullable() }),
  categoryMove: z.object({ id, direction: z.union([z.literal(-1), z.literal(1)]) }),
  categorySetGame: z.object({ gameId: id, categoryIds: z.array(id).max(200) }),
};

export function registerGameRoutes(c: Container): void {
  // Jogos
  handle('games:list', null, () => c.games.list());
  handle('games:inspect', schemas.inspect, ({ path, kind }) => c.games.inspect(path, kind));
  handle('games:add', schemas.newGame, async (input) => {
    const result = await c.games.add(input);
    // Troféus, arte do dump e categoria em segundo plano: o diálogo fecha na hora e eventos avisam o renderer.
    c.maintenance.gameAdded(result.game.id);
    return result;
  });
  handle('games:update', schemas.updateGame, async (input) => {
    const game = await c.games.update(input);
    // Novos argumentos podem apontar para o dump (ex.: shadPS4.exe -g "…\eboot.bin").
    if (input.launchArgs !== undefined) c.maintenance.gameChanged(game.id);
    return game;
  });
  handle('games:remove', id, (gameId) => c.games.remove(gameId));
  handle('games:rematch', id, (gameId) => c.games.rematch(gameId));
  handle('games:launch', id, (gameId) => c.launcher.launch(gameId));
  handle('games:running', null, () => c.launcher.runningGameIds());
  handle('library:scan', null, async (_input, event) => {
    const folder = await showOpen(event, { title: 'Escolher pasta de jogos', properties: ['openDirectory'] });
    return folder ? c.libraryImport.scan(folder) : null;
  });
  handle('library:scan-cancel', null, () => c.libraryImport.cancelScan());
  handle('library:scan-stores', null, () => c.libraryImport.scanStores());
  handle('games:add-many', schemas.addMany, ({ items }) => c.libraryImport.addMany(items));
  handle('games:missing', null, () => c.relocation.missing());
  handle('games:relocate', schemas.relocate, async ({ id: gameId, action }, event) => {
    if (action === 'auto') return c.relocation.autoRelocate(gameId);
    const game = c.games.get(gameId);
    const filters = FILE_FILTERS[game.kind === 'retroarch' ? 'rom' : 'executable'];
    const file = await pickFile(event, filters, `Onde está "${game.title}" agora?`, await nearestExistingDir(game.path));
    return file ? c.relocation.relocate(gameId, file) : null;
  });
  handle('games:art-search', schemas.artSearch, ({ id: gameId, query, sgdbGameId }) => c.gameArt.search(gameId, query, sgdbGameId));
  handle('games:art-apply', schemas.artApply, ({ id: gameId, slot, url }) => c.gameArt.apply(gameId, slot, url));
  handle('games:art-fill-missing', null, () => c.gameArt.fillMissing());
  handle('games:set-artwork-data', schemas.artData, ({ id: gameId, slot, data }) => c.games.setArtworkFromData(gameId, slot, Buffer.from(data, 'base64')));
  handle('games:set-artwork', schemas.setArtwork, async ({ id: gameId, slot, action }, event) => {
    if (action === 'reset') return c.games.resetArtwork(gameId, slot);
    const filters: Electron.FileFilter[] =
      slot === 'icon'
        ? [{ name: 'Imagens ou executáveis', extensions: [...IMAGE_EXTENSIONS, 'exe', 'dll'] }]
        : [{ name: 'Imagens', extensions: IMAGE_EXTENSIONS }];
    const titles = { cover: 'Escolher capa', background: 'Escolher imagem de fundo', icon: 'Escolher ícone' };
    const file = await pickFile(event, filters, titles[slot]);
    return file ? c.games.setArtworkFromFile(gameId, slot, file) : null;
  });

  // Troféus locais
  handle('trophies:get', id, (gameId) => c.trophies.get(gameId));
  handle('trophies:overview', null, () => c.trophies.overview());
  handle('trophies:import-trp', id, async (gameId, event) => {
    const file = await pickFile(event, [{ name: 'Troféus do PS4 (trophy00.trp)', extensions: ['trp'] }], 'Escolher sce_sys/trophy/trophy00.trp do dump');
    return file ? c.trophies.importTrp(gameId, file) : null;
  });
  handle('trophies:auto-import', id, (gameId) => c.trophies.autoImport(gameId));
  handle('trophies:create-manual', id, (gameId) => c.trophies.createManual(gameId));
  handle('trophies:delete-set', id, (gameId) => c.trophies.deleteSet(gameId));
  handle('trophies:upsert', schemas.trophyInput, (input) => c.trophies.upsert(input));
  handle('trophies:delete', schemas.trophyRef, ({ gameId, trophyId: tid }) => c.trophies.delete(gameId, tid));
  handle('trophies:set-unlocked', schemas.trophyUnlock, ({ gameId, trophyId: tid, unlocked }) => c.trophies.setUnlocked(gameId, tid, unlocked));
  handle('trophies:configure-log', schemas.trophyLog, async ({ gameId, action }, event) => {
    if (action === 'clear') return c.trophies.configureLog(gameId, null);
    if (action === 'auto') return c.trophies.configureLog(gameId, 'auto');
    const file = await pickFile(event, [{ name: 'Logs', extensions: ['log', 'txt'] }, { name: 'Todos', extensions: ['*'] }], 'Escolher o log do jogo');
    return file ? c.trophies.configureLog(gameId, file) : null;
  });

  // Categorias
  handle('categories:list', null, () => c.categories.list());
  handle('categories:create', schemas.categoryName, (name) => c.categories.create(name));
  handle('categories:rename', schemas.categoryRename, ({ id: categoryId, name }) => c.categories.rename(categoryId, name));
  handle('categories:delete', id, (categoryId) => c.categories.delete(categoryId));
  handle('categories:set-icon', schemas.categoryIcon, ({ id: categoryId, icon }) => c.categories.setIcon(categoryId, icon));
  handle('categories:move', schemas.categoryMove, ({ id: categoryId, direction }) => c.categories.move(categoryId, direction));
  handle('categories:set-game', schemas.categorySetGame, ({ gameId, categoryIds }) => c.categories.setForGame(gameId, categoryIds));
  handle('categories:auto-organize', null, () => c.categories.autoOrganize());
}
