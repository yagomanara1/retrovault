// Rotas da Loja de ports: catálogo, instalações, mods, arte (SteamGridDB), ROMs e conta do GitHub.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { app, shell } from 'electron';
import { z } from 'zod';
import { ROM_EXTENSIONS } from '@shared/consoles';
import { GITHUB_TOKEN_HINT, GITHUB_TOKEN_PATTERN } from '@shared/store';
import type { Container } from '../container';
import { AppError } from '../errors';
import { toRawGitHubUrl } from '../services/store/catalogSchema';
import { handle, openFolder, pickFile, portId, refresh, showSave } from './core';

const modId = z.number().int().positive();

const schemas = {
  githubToken: z.string().trim().regex(GITHUB_TOKEN_PATTERN, GITHUB_TOKEN_HINT),
  storeReleases: z.object({ portId, force: z.boolean().optional() }),
  storeInstall: z.object({ portId, tag: z.string().min(1).max(200).optional() }),
  repoInput: z.string().trim().min(3).max(300),
  modList: z.object({
    portId,
    page: z.number().int().min(1).max(500),
    sort: z.enum(['popular', 'newest', 'downloads']),
    query: z.string().trim().max(80).optional(),
  }),
  modRef: z.object({ portId, modId }),
  modInstall: z.object({ portId, modId, fileId: z.number().int().positive() }),
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
};

/** Assistente de ROM da Loja: o filtro do console do port (os outros veem tudo, conferido pelo hash). */
const ROM_FILTERS: Partial<Record<string, Electron.FileFilter>> = {
  n64: { name: 'ROMs de Nintendo 64', extensions: ['z64', 'n64', 'v64'] },
  ds: { name: 'ROMs de Nintendo DS', extensions: ['nds'] },
  snes: { name: 'ROMs de Super Nintendo', extensions: ['sfc', 'smc'] },
};

export function registerStoreRoutes(c: Container): void {
  // Loja de ports
  handle('store:catalog', refresh, ({ force }) => c.store.catalog(force));
  handle('store:releases', schemas.storeReleases, ({ portId: id, force }) => c.store.releases(id, force));
  handle('store:installs', null, () => ({ installs: c.installs.list(), installing: c.installs.installing() }));
  handle('store:install', schemas.storeInstall, ({ portId: id, tag }) => c.installs.install(id, tag));
  handle('store:cancel', portId, (id) => c.installs.cancel(id));
  handle('store:uninstall', portId, (id) => c.installs.uninstall(id));
  handle('store:rollback', portId, (id) => c.installs.rollback(id));
  handle('store:updates', null, () => c.installs.updates());
  handle('store:update-all', null, () => c.installs.updateAll());
  handle('mods:list', schemas.modList, ({ portId: id, page, sort, query }) => c.mods.list(id, page, sort, query));
  handle('mods:details', schemas.modRef, ({ portId: id, modId: mod }) => c.mods.details(id, mod));
  handle('mods:installed', portId, (id) => c.mods.installed(id));
  handle('mods:install', schemas.modInstall, ({ portId: id, modId: mod, fileId }) => c.mods.install(id, mod, fileId));
  handle('mods:uninstall', schemas.modRef, ({ portId: id, modId: mod }) => c.mods.uninstall(id, mod));
  handle('store:custom-inspect', schemas.repoInput, (input) => c.customPorts.inspect(input));
  handle('store:custom-add', schemas.customPort, (input) => c.customPorts.add(input));
  handle('store:custom-remove', portId, (id) => c.customPorts.remove(id));
  handle('store:art', portId, async (id) => c.storeArt.art(await c.store.port(id)));
  handle('store:set-catalog-url', schemas.catalogUrl, async (url) => {
    if (!url) return { settings: c.settings.setStoreCatalogUrl(null), ports: 0, skipped: 0 };
    // Colou o endereço da página do arquivo no GitHub? Vira o do arquivo em si ("Raw").
    const raw = toRawGitHubUrl(url);
    const tested = await c.store.testRemote(raw); // só salva endereço que devolve um catálogo válido
    return { settings: c.settings.setStoreCatalogUrl(raw), ports: tested.ports, skipped: tested.skipped.length };
  });
  handle('store:export-catalog', null, async (_input, event) => {
    const file = await showSave(event, {
      title: 'Exportar catálogo da Loja',
      defaultPath: path.join(app.getPath('documents'), 'catalog.json'),
      filters: [{ name: 'Catálogo da Loja', extensions: ['json'] }],
    });
    if (!file) return null;
    await fs.writeFile(file, await c.store.exportJson(), 'utf8');
    return file;
  });
  handle('sgdb:connect', schemas.sgdbKey, async (key) => {
    await c.storeArt.verifyKey(key); // só guarda chave que o SteamGridDB aceitou
    const settings = c.settings.setSgdbKey(key);
    void c.ports.applyArtToLibrary();
    return settings;
  });
  handle('sgdb:disconnect', null, () => c.settings.setSgdbKey(null));
  handle('store:open-folder', portId, async (id) => {
    // O caminho vem do banco (instalação registrada), nunca do renderer.
    const install = c.installs.list().find((i) => i.portId === id);
    if (!install) throw new AppError('NOT_FOUND', 'Este port não está instalado.');
    await openFolder(install.installDir, false);
  });

  handle('store:rom-status', portId, (id) => c.roms.status(id));
  handle('store:rom-setup', portId, async (id, event) => {
    const port = await c.store.port(id);
    const file = await pickFile(
      event,
      [ROM_FILTERS[port.original.platform] ?? { name: 'ROMs', extensions: [...ROM_EXTENSIONS] }, { name: 'Todos os arquivos', extensions: ['*'] }],
      `Escolher a ${port.requires.label}`,
    );
    return file ? c.roms.setup(id, file) : null;
  });
  handle('store:rom-show', portId, async (id) => {
    const status = await c.roms.status(id);
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
}
