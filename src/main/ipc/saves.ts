// Rotas de saves, nuvem, backups da biblioteca e progresso.
import path from 'node:path';
import { app } from 'electron';
import { z } from 'zod';
import type { Container } from '../container';
import { mergeVaultInto, moveVaultRoot } from '../services/saves/saveVault';
import { filePath, handle, id, openFolder, pickFile, showOpen, showSave } from './core';

const schemas = {
  cloudProvider: z.enum(['onedrive', 'googledrive', 'dropbox']),
  saveRestore: z.object({ gameId: id, snapshotId: z.string().regex(/^[\w-]{1,64}$/, 'versão inválida') }),
  saveAddPath: z.object({ gameId: id, kind: z.enum(['file', 'folder']) }),
  saveRemovePath: z.object({ gameId: id, path: filePath }),
  saveOpenFolder: z.object({ gameId: id.optional() }),
  backupName: z.string().regex(/^retrovault-[a-z-]+-\d{8}-\d{6}\.db$/, 'nome de backup inválido'),
};

const progressFilter = [{ name: 'Progresso do RetroVault', extensions: ['json'] }];

export function registerSaveRoutes(c: Container): void {
  // Cofre de saves
  handle('saves:get', id, (gameId) => c.saves.get(gameId));
  handle('saves:backup', id, (gameId) => c.saves.backup(gameId, 'manual'));
  handle('saves:restore', schemas.saveRestore, ({ gameId, snapshotId }) => c.saves.restore(gameId, snapshotId));
  handle('saves:add-path', schemas.saveAddPath, async ({ gameId, kind }, event) => {
    const game = c.games.get(gameId);
    const chosen = await showOpen(event, {
      title: kind === 'folder' ? `Pasta de save de "${game.title}"` : `Arquivo de save de "${game.title}"`,
      defaultPath: path.dirname(game.path),
      properties: [kind === 'folder' ? 'openDirectory' : 'openFile'],
    });
    return chosen ? c.saves.addPath(gameId, chosen) : null;
  });
  handle('saves:remove-path', schemas.saveRemovePath, ({ gameId, path: savePath }) => c.saves.removePath(gameId, savePath));
  handle('saves:open-folder', schemas.saveOpenFolder, async ({ gameId }) => {
    const dir = gameId ? (await c.saves.get(gameId)).vaultDir : null;
    await openFolder(dir ?? c.settings.get().savesRoot);
  });
  handle('saves:choose-root', null, async (_input, event) => {
    const current = c.settings.get().savesRoot;
    const chosen = await showOpen(event, {
      title: 'Pasta do cofre de saves (ex.: uma pasta do OneDrive)',
      defaultPath: path.dirname(current),
      properties: ['openDirectory', 'createDirectory'],
    });
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
  handle('backup:open-folder', null, () => openFolder(c.backups.dir));
  handle('progress:export', null, async (_input, event) => {
    const file = await showSave(event, {
      title: 'Exportar progresso',
      defaultPath: path.join(app.getPath('documents'), `retrovault-progresso-${new Date().toISOString().slice(0, 10)}.json`),
      filters: progressFilter,
    });
    if (!file) return null;
    await c.progress.export(file);
    return file;
  });
  handle('progress:import', null, async (_input, event) => {
    const file = await pickFile(event, progressFilter, 'Importar progresso');
    return file ? c.progress.import(file) : null;
  });
}
