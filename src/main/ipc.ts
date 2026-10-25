import { promises as fs } from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { ROM_EXTENSIONS } from '@shared/consoles';
import type { FileDialogKind, IpcChannel, IpcInput, IpcOutput, IpcResult } from '@shared/ipc';
import type { Container } from './container';
import { AppError, toIpcError } from './errors';
import { IMAGE_EXTENSIONS } from './services/artworkService';
import { nearestExistingDir } from './services/relocationService';
import { mergeVaultInto, moveVaultRoot } from './services/saves/saveVault';
import { GITHUB_TOKEN_HINT, GITHUB_TOKEN_PATTERN } from '@shared/store';
import { toRawGitHubUrl } from './services/store/catalogSchema';

// ---------- Schemas de validação (toda entrada do renderer é não confiável) ----------

const id = z.number().int().positive();
const filePath = z.string().trim().min(1).max(4096);
const refresh = z.object({ force: z.boolean().optional() });
const optionalNullableId = id.nullable().optional();

const schemas = {
  inspect: z.object({ path: filePath, kind: z.enum(['retroarch', 'executable']) }),
  newGame: z.object({
    kind: z.enum(['retroarch', 'executable']),
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
  settings: z.object({
    retroarchPath: z.string().max(4096).nullable().optional(),
    raUsername: z.string().trim().max(64).regex(/^[A-Za-z0-9_.-]*$/, 'caracteres inválidos').nullable().optional(),
    raApiKey: z.string().trim().max(128).optional(),
    trophyKey: z
      .string()
      .trim()
      .regex(/^([0-9a-fA-F]{32})?$/, 'a trophy key tem 32 caracteres hexadecimais')
      .optional(),
    hardcoreMode: z.boolean().optional(),
    notifyAchievements: z.boolean().optional(),
    autoBackupSaves: z.boolean().optional(),
    notifyPortUpdates: z.boolean().optional(),
    discordPresence: z.boolean().optional(),
  }),
  fileDialog: z.object({ kind: z.enum(['rom', 'executable', 'retroarch']) }),
  relocate: z.object({ id, action: z.enum(['pick', 'auto']) }),
  addMany: z.object({
    items: z
      .array(
        z.object({
          kind: z.enum(['retroarch', 'executable']),
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
  cloudProvider: z.enum(['onedrive', 'googledrive', 'dropbox']),
  categoryName: z.string().max(200),
  categoryRename: z.object({ id, name: z.string().max(200) }),
  categoryIcon: z.object({ id, icon: z.string().max(32).nullable() }),
  categoryMove: z.object({ id, direction: z.union([z.literal(-1), z.literal(1)]) }),
  categorySetGame: z.object({ gameId: id, categoryIds: z.array(id).max(200) }),
  saveRestore: z.object({ gameId: id, snapshotId: z.string().regex(/^[\w-]{1,64}$/, 'versão inválida') }),
  saveAddPath: z.object({ gameId: id, kind: z.enum(['file', 'folder']) }),
  saveRemovePath: z.object({ gameId: id, path: filePath }),
  saveOpenFolder: z.object({ gameId: id.optional() }),
  backupName: z.string().regex(/^retrovault-[a-z-]+-\d{8}-\d{6}\.db$/, 'nome de backup inválido'),
  trophyInput: z.object({
    gameId: id,
    trophyId: z.number().int().min(0).optional(),
    name: z.string().trim().min(1).max(120),
    detail: z.string().trim().max(500),
    grade: z.enum(['P', 'G', 'S', 'B']),
    hidden: z.boolean(),
  }),
  trophyRef: z.object({ gameId: id, trophyId: z.number().int().min(0) }),
  trophyUnlock: z.object({ gameId: id, trophyId: z.number().int().min(0), unlocked: z.boolean() }),
  trophyLog: z.object({ gameId: id, action: z.enum(['pick', 'auto', 'clear']) }),
  setArtwork: z.object({
    id,
    slot: z.enum(['cover', 'background', 'icon']),
    action: z.enum(['pick', 'reset']),
  }),
  artSearch: z.object({ id, query: z.string().trim().max(100).optional(), sgdbGameId: id.optional() }),
  artApply: z.object({ id, slot: z.enum(['cover', 'background', 'icon']), url: z.string().url().max(500) }),
  // Imagem do editor de enquadramento: no máximo ~12 MB em base64 (a capa sai com uns 300 KB).
  artData: z.object({ id, slot: z.enum(['cover', 'background', 'icon']), data: z.string().min(16).max(16_000_000).regex(/^[A-Za-z0-9+/]+=*$/) }),
  gameProgress: z.object({ raGameId: id, force: z.boolean().optional() }),
  search: z.object({ consoleId: id, query: z.string().trim().min(1).max(100) }),
  githubToken: z.string().trim().regex(GITHUB_TOKEN_PATTERN, GITHUB_TOKEN_HINT),
  storeReleases: z.object({ portId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, 'port inválido'), force: z.boolean().optional() }),
  storeInstall: z.object({ portId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, 'port inválido'), tag: z.string().min(1).max(200).optional() }),
  portId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, 'port inválido'),
  repoInput: z.string().trim().min(3).max(300),
  modList: z.object({
    portId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/),
    page: z.number().int().min(1).max(500),
    sort: z.enum(['popular', 'newest', 'downloads']),
    query: z.string().trim().max(80).optional(),
  }),
  modRef: z.object({ portId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/), modId: z.number().int().positive() }),
  modInstall: z.object({ portId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/), modId: z.number().int().positive(), fileId: z.number().int().positive() }),
  customPort: z.object({
    repo: z.string().trim().min(3).max(300),
    name: z.string().trim().min(1, 'Dê um nome ao port.').max(80),
    originalTitle: z.string().trim().min(1, 'Informe o jogo original.').max(120),
    platform: z.string().min(1).max(30),
    system: z.string().trim().max(40).optional(),
    assetPattern: z.string().min(1).max(200),
    requiresKind: z.enum(['rom', 'game-files', 'none']),
    requiresLabel: z.string().trim().max(160),
  }),
  catalogUrl: z
    .string()
    .trim()
    .url('endereço inválido')
    .max(2000)
    .refine((u) => u.startsWith('https://'), 'o catálogo precisa estar num endereço https')
    .nullable(),
  sgdbKey: z.string().trim().regex(/^[A-Za-z0-9]{16,64}$/, 'isso não parece uma chave do SteamGridDB (letras e números, sem espaços)'),
  externalUrl: z
    .string()
    .url()
    .refine((u) => u.startsWith('https://'), 'apenas URLs https'),
  emulatorPath: z.object({ id: z.string().regex(/^[a-z0-9]{2,20}$/), path: z.literal('pick').nullable() }),
  emulatorConsole: z.object({
    consoleId: z.number().int().positive(),
    choice: z.string().regex(/^[a-z0-9]{2,20}$/).nullable(),
  }),
};

/** Assistente de ROM da Loja: o filtro do console do port (os outros veem tudo, conferido pelo hash). */
const ROM_FILTERS: Partial<Record<string, Electron.FileFilter>> = {
  n64: { name: 'ROMs de Nintendo 64', extensions: ['z64', 'n64', 'v64'] },
  ds: { name: 'ROMs de Nintendo DS', extensions: ['nds'] },
  snes: { name: 'ROMs de Super Nintendo', extensions: ['sfc', 'smc'] },
};

const FILE_FILTERS: Record<FileDialogKind, Electron.FileFilter[]> = {
  rom: [
    { name: 'ROMs', extensions: [...ROM_EXTENSIONS] },
    { name: 'Todos os arquivos', extensions: ['*'] },
  ],
  executable:
    process.platform === 'win32'
      ? [{ name: 'Executáveis', extensions: ['exe', 'bat', 'cmd', 'lnk'] }]
      : [{ name: 'Todos os arquivos', extensions: ['*'] }],
  retroarch:
    process.platform === 'win32'
      ? [{ name: 'RetroArch', extensions: ['exe'] }]
      : [{ name: 'Todos os arquivos', extensions: ['*'] }],
};

// ---------- Infra ----------

async function pickFile(
  event: IpcMainInvokeEvent,
  filters: Electron.FileFilter[],
  title?: string,
  defaultPath?: string | null,
): Promise<string | null> {
  const options: Electron.OpenDialogOptions = { properties: ['openFile'], filters, title, defaultPath: defaultPath ?? undefined };
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? '';
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  return url.startsWith('file://') || (!!devUrl && url.startsWith(devUrl));
}

function handle<C extends IpcChannel>(
  channel: C,
  schema: z.ZodType<IpcInput<C>, z.ZodTypeDef, unknown> | null,
  fn: (input: IpcInput<C>, event: IpcMainInvokeEvent) => IpcOutput<C> | Promise<IpcOutput<C>>,
): void {
  ipcMain.handle(channel, async (event, raw: unknown): Promise<IpcResult<IpcOutput<C>>> => {
    try {
      if (!isTrustedSender(event)) throw new AppError('FORBIDDEN', 'Origem não autorizada.');
      const input = (schema ? schema.parse(raw) : undefined) as IpcInput<C>;
      return { ok: true, data: await fn(input, event) };
    } catch (err) {
      return { ok: false, error: toIpcError(err) };
    }
  });
}

// ---------- Rotas ----------

export function registerIpc(c: Container): void {
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
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = { title: 'Escolher pasta de jogos', properties: ['openDirectory'] };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const folder = result.canceled ? null : result.filePaths[0];
    return folder ? c.libraryImport.scan(folder) : null;
  });
  handle('library:scan-cancel', null, () => c.libraryImport.cancelScan());
  handle('library:scan-stores', null, () => c.libraryImport.scanStores());
  handle('games:add-many', schemas.addMany, ({ items }) => c.libraryImport.addMany(items));
  handle('games:missing', null, () => c.relocation.missing());
  handle('games:relocate', schemas.relocate, async ({ id, action }, event) => {
    if (action === 'auto') return c.relocation.autoRelocate(id);
    const game = c.games.get(id);
    const filters = FILE_FILTERS[game.kind === 'retroarch' ? 'rom' : 'executable'];
    const file = await pickFile(event, filters, `Onde está "${game.title}" agora?`, await nearestExistingDir(game.path));
    return file ? c.relocation.relocate(id, file) : null;
  });
  handle('games:art-search', schemas.artSearch, ({ id: gameId, query, sgdbGameId }) => c.gameArt.search(gameId, query, sgdbGameId));
  handle('games:art-apply', schemas.artApply, ({ id: gameId, slot, url }) => c.gameArt.apply(gameId, slot, url));
  handle('games:art-fill-missing', null, () => c.gameArt.fillMissing());
  handle('games:set-artwork-data', schemas.artData, ({ id: gameId, slot, data }) => c.games.setArtworkFromData(gameId, slot, Buffer.from(data, 'base64')));
  handle('games:set-artwork', schemas.setArtwork, async ({ id, slot, action }, event) => {
    if (action === 'reset') return c.games.resetArtwork(id, slot);
    // O seletor roda no main: o renderer nunca escolhe caminhos arbitrários.
    const filters: Electron.FileFilter[] =
      slot === 'icon'
        ? [{ name: 'Imagens ou executáveis', extensions: [...IMAGE_EXTENSIONS, 'exe', 'dll'] }]
        : [{ name: 'Imagens', extensions: IMAGE_EXTENSIONS }];
    const titles = { cover: 'Escolher capa', background: 'Escolher imagem de fundo', icon: 'Escolher ícone' };
    const file = await pickFile(event, filters, titles[slot]);
    return file ? c.games.setArtworkFromFile(id, slot, file) : null;
  });

  // Troféus locais
  handle('trophies:get', id, (gameId) => c.trophies.get(gameId));
  handle('trophies:overview', null, () => c.trophies.overview());
  handle('trophies:import-trp', id, async (gameId, event) => {
    const file = await pickFile(
      event,
      [{ name: 'Troféus do PS4 (trophy00.trp)', extensions: ['trp'] }],
      'Escolher sce_sys/trophy/trophy00.trp do dump',
    );
    return file ? c.trophies.importTrp(gameId, file) : null;
  });
  handle('trophies:auto-import', id, (gameId) => c.trophies.autoImport(gameId));
  handle('trophies:create-manual', id, (gameId) => c.trophies.createManual(gameId));
  handle('trophies:delete-set', id, (gameId) => c.trophies.deleteSet(gameId));
  handle('trophies:upsert', schemas.trophyInput, (input) => c.trophies.upsert(input));
  handle('trophies:delete', schemas.trophyRef, ({ gameId, trophyId }) => c.trophies.delete(gameId, trophyId));
  handle('trophies:set-unlocked', schemas.trophyUnlock, ({ gameId, trophyId, unlocked }) =>
    c.trophies.setUnlocked(gameId, trophyId, unlocked),
  );
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

  // Cofre de saves
  handle('saves:get', id, (gameId) => c.saves.get(gameId));
  handle('saves:backup', id, (gameId) => c.saves.backup(gameId, 'manual'));
  handle('saves:restore', schemas.saveRestore, ({ gameId, snapshotId }) => c.saves.restore(gameId, snapshotId));
  handle('saves:add-path', schemas.saveAddPath, async ({ gameId, kind }, event) => {
    const game = c.games.get(gameId);
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: kind === 'folder' ? `Pasta de save de "${game.title}"` : `Arquivo de save de "${game.title}"`,
      defaultPath: path.dirname(game.path),
      properties: [kind === 'folder' ? 'openDirectory' : 'openFile'],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const chosen = result.canceled ? null : result.filePaths[0];
    return chosen ? c.saves.addPath(gameId, chosen) : null;
  });
  handle('saves:remove-path', schemas.saveRemovePath, ({ gameId, path: savePath }) => c.saves.removePath(gameId, savePath));
  handle('saves:open-folder', schemas.saveOpenFolder, async ({ gameId }) => {
    const dir = gameId ? (await c.saves.get(gameId)).vaultDir : null;
    const target = dir ?? c.settings.get().savesRoot;
    await fs.mkdir(target, { recursive: true });
    const error = await shell.openPath(target);
    if (error) throw new AppError('INTERNAL', error);
  });
  handle('saves:choose-root', null, async (_input, event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const current = c.settings.get().savesRoot;
    const options: Electron.OpenDialogOptions = {
      title: 'Pasta do cofre de saves (ex.: uma pasta do OneDrive)',
      defaultPath: path.dirname(current),
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const chosen = result.canceled ? null : result.filePaths[0];
    if (!chosen) return null;
    await moveVaultRoot(current, chosen);
    return c.settings.setSavesRoot(path.resolve(chosen));
  });

  // Nuvem (pelo app de sincronização instalado: OneDrive, Google Drive, Dropbox)
  handle('cloud:providers', null, () => c.cloud.providers(c.settings.get().savesRoot));
  handle('cloud:connect', schemas.cloudProvider, async (providerId) => {
    const current = c.settings.get().savesRoot;
    const target = await c.cloud.vaultFolderFor(providerId, current);
    const merged = await mergeVaultInto(current, target, true);
    const settings = c.settings.setSavesRoot(target);
    if (providerId === 'onedrive') await c.cloud.pinLocally(path.dirname(target));
    c.exportProgressNextToVault();
    return { settings, ...merged };
  });
  handle('cloud:disconnect', null, async () => {
    const local = c.settings.localSavesRoot;
    await mergeVaultInto(c.settings.get().savesRoot, local, false); // a cópia na nuvem fica
    return c.settings.setSavesRoot(local);
  });
  handle('cloud:start-client', schemas.cloudProvider, (providerId) => c.cloud.startClient(providerId));

  // Backup e progresso
  handle('backup:list', null, () => c.backups.list());
  handle('backup:create', null, () => c.backups.create('manual'));
  handle('backup:restore', schemas.backupName, async (name) => {
    await c.backups.scheduleRestore(name);
    // Responde antes de reiniciar; o banco é trocado no próximo início, antes de abrir.
    setTimeout(() => {
      app.relaunch();
      app.quit();
    }, 300);
  });
  handle('backup:open-folder', null, async () => {
    await fs.mkdir(c.backups.dir, { recursive: true });
    const error = await shell.openPath(c.backups.dir);
    if (error) throw new AppError('INTERNAL', error);
  });
  handle('progress:export', null, async (_input, event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.SaveDialogOptions = {
      title: 'Exportar progresso',
      defaultPath: path.join(app.getPath('documents'), `retrovault-progresso-${new Date().toISOString().slice(0, 10)}.json`),
      filters: [{ name: 'Progresso do RetroVault', extensions: ['json'] }],
    };
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    await c.progress.export(result.filePath);
    return result.filePath;
  });
  handle('progress:import', null, async (_input, event) => {
    const file = await pickFile(event, [{ name: 'Progresso do RetroVault', extensions: ['json'] }], 'Importar progresso');
    return file ? c.progress.import(file) : null;
  });

  // Loja de ports
  handle('store:catalog', refresh, ({ force }) => c.store.catalog(force));
  handle('store:releases', schemas.storeReleases, ({ portId, force }) => c.store.releases(portId, force));

  handle('store:installs', null, () => ({ installs: c.installs.list(), installing: c.installs.installing() }));
  handle('store:install', schemas.storeInstall, ({ portId, tag }) => c.installs.install(portId, tag));
  handle('store:cancel', schemas.portId, (portId) => c.installs.cancel(portId));
  handle('store:uninstall', schemas.portId, (portId) => c.installs.uninstall(portId));
  handle('store:rollback', schemas.portId, (portId) => c.installs.rollback(portId));
  handle('store:updates', null, () => c.installs.updates());
  handle('store:update-all', null, () => c.installs.updateAll());
  handle('mods:list', schemas.modList, ({ portId, page, sort, query }) => c.mods.list(portId, page, sort, query));
  handle('mods:details', schemas.modRef, ({ portId, modId }) => c.mods.details(portId, modId));
  handle('mods:installed', schemas.portId, (portId) => c.mods.installed(portId));
  handle('mods:install', schemas.modInstall, ({ portId, modId, fileId }) => c.mods.install(portId, modId, fileId));
  handle('mods:uninstall', schemas.modRef, ({ portId, modId }) => c.mods.uninstall(portId, modId));
  handle('store:custom-inspect', schemas.repoInput, (input) => c.customPorts.inspect(input));
  handle('store:custom-add', schemas.customPort, (input) => c.customPorts.add(input));
  handle('store:custom-remove', schemas.portId, (portId) => c.customPorts.remove(portId));
  handle('store:art', schemas.portId, async (portId) => c.storeArt.art(await c.store.port(portId)));
  handle('store:set-catalog-url', schemas.catalogUrl, async (url) => {
    if (!url) return { settings: c.settings.setStoreCatalogUrl(null), ports: 0, skipped: 0 };
    // Colou o endereço da página do arquivo no GitHub? Vira o do arquivo em si ("Raw").
    const raw = toRawGitHubUrl(url);
    const tested = await c.store.testRemote(raw); // só salva endereço que devolve um catálogo válido
    return { settings: c.settings.setStoreCatalogUrl(raw), ports: tested.ports, skipped: tested.skipped.length };
  });
  handle('store:export-catalog', null, async (_input, event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.SaveDialogOptions = {
      title: 'Exportar catálogo da Loja',
      defaultPath: path.join(app.getPath('documents'), 'catalog.json'),
      filters: [{ name: 'Catálogo da Loja', extensions: ['json'] }],
    };
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, await c.store.exportJson(), 'utf8');
    return result.filePath;
  });
  handle('sgdb:connect', schemas.sgdbKey, async (key) => {
    await c.storeArt.verifyKey(key); // só guarda chave que o SteamGridDB aceitou
    const settings = c.settings.setSgdbKey(key);
    void c.applyStoreArtToLibrary();
    return settings;
  });
  handle('sgdb:disconnect', null, () => c.settings.setSgdbKey(null));
  handle('store:open-folder', schemas.portId, async (portId) => {
    // O caminho vem do banco (instalação registrada), nunca do renderer.
    const install = c.installs.list().find((i) => i.portId === portId);
    if (!install) throw new AppError('NOT_FOUND', 'Este port não está instalado.');
    const error = await shell.openPath(install.installDir);
    if (error) throw new AppError('INTERNAL', error);
  });

  handle('store:rom-status', schemas.portId, (portId) => c.roms.status(portId));
  handle('store:rom-setup', schemas.portId, async (portId, event) => {
    const port = await c.store.port(portId);
    const file = await pickFile(
      event,
      [
        ROM_FILTERS[port.original.platform] ?? { name: 'ROMs', extensions: [...ROM_EXTENSIONS] },
        { name: 'Todos os arquivos', extensions: ['*'] },
      ],
      `Escolher a ${port.requires.label}`,
    );
    return file ? c.roms.setup(portId, file) : null;
  });
  handle('store:rom-show', schemas.portId, async (portId) => {
    const status = await c.roms.status(portId);
    if (!status?.fileToSelect) throw new AppError('NOT_FOUND', 'Nenhuma ROM preparada para este port.');
    shell.showItemInFolder(status.fileToSelect);
  });

  // Conta do GitHub (aumenta o limite de consultas da Loja de 60 para 5.000 por hora)
  handle('github:status', null, () => c.github.status(c.settings.get().githubLogin));
  handle('github:connect', schemas.githubToken, async (token) => {
    const login = await c.github.verifyToken(token); // só guarda token que o GitHub aceitou
    c.settings.setGitHubAccount({ login, token });
    return c.github.status(login);
  });
  handle('github:disconnect', null, () => {
    c.settings.setGitHubAccount(null);
    return c.github.status(null);
  });

  // Sistema
  handle('dialog:open-file', schemas.fileDialog, ({ kind }, event) => pickFile(event, FILE_FILTERS[kind]));
  handle('app:open-external', schemas.externalUrl, (url) => shell.openExternal(url));
  handle('app:update-status', null, () => c.appUpdate.status());
  handle('app:update-check', null, () => c.appUpdate.check());
  handle('app:update-install', null, () => c.appUpdate.install());

  // Emuladores próprios
  handle('emulators:overview', null, () => c.emulators.overview());
  handle('emulators:refresh', null, () => c.emulators.refresh());
  handle('emulators:set-path', schemas.emulatorPath, async ({ id, path: action }, event) => {
    if (action === null) return c.emulators.setPath(id, null);
    // O seletor roda no main: o renderer nunca escolhe caminhos arbitrários.
    const file = await pickFile(event, [{ name: 'Executável do emulador', extensions: ['exe'] }], 'Escolha o executável do emulador');
    return file ? c.emulators.setPath(id, file) : null;
  });
  handle('emulators:set-console', schemas.emulatorConsole, ({ consoleId, choice }) => c.emulators.setForConsole(consoleId, choice));
  handle('emulators:set-fullscreen', z.boolean(), (fullscreen) => c.emulators.setFullscreen(fullscreen));

  // Steam (atalhos não-Steam)
  const steamAccount = z.string().regex(/^\d{1,12}$/, 'conta inválida');
  handle('steam:shortcuts', z.object({ accountId: steamAccount.nullable() }), ({ accountId }) => c.steamShortcuts.overview(accountId));
  handle(
    'steam:shortcuts-apply',
    z.object({ accountId: steamAccount, gameIds: z.array(id).max(5000), includeLauncher: z.boolean() }),
    (input) => c.steamShortcuts.apply(input),
  );
  handle('steam:exit', null, () => c.openExternal('steam://exit'));

  // Configurações / RetroArch
  handle('settings:get', null, () => c.settings.get());
  handle('settings:update', schemas.settings, (patch) => c.settings.update(patch));
  handle('retroarch:status', null, () => c.retroarch.status(true));

  // RetroAchievements
  handle('ra:profile', refresh, ({ force }) => c.ra.getProfile(force));
  handle('ra:recent', refresh, ({ force }) => c.ra.getRecentAchievements(force));
  handle('ra:completion', refresh, ({ force }) => c.ra.getCompletionProgress(force));
  handle('ra:game-progress', schemas.gameProgress, ({ raGameId, force }) => c.ra.getGameProgress(raGameId, force));
  handle('ra:consoles', null, () => c.ra.getConsoles());
  handle('ra:search', schemas.search, ({ consoleId, query }) => c.ra.searchGames(consoleId, query));
}
