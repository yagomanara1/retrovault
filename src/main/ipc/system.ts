// Rotas do sistema: diálogos, links externos, atualização do app, emuladores, Steam, configurações e RetroAchievements.
import { shell } from 'electron';
import { z } from 'zod';
import type { Container } from '../container';
import { FILE_FILTERS, handle, id, pickFile, refresh } from './core';

const emulatorChoice = z.string().regex(/^[a-z0-9]{2,20}$/);
const steamAccount = z.string().regex(/^\d{1,12}$/, 'conta inválida');

const schemas = {
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
  externalUrl: z
    .string()
    .url()
    .refine((u) => u.startsWith('https://'), 'apenas URLs https'),
  emulatorPath: z.object({ id: emulatorChoice, path: z.literal('pick').nullable() }),
  emulatorConsole: z.object({ consoleId: z.number().int().positive(), choice: emulatorChoice.nullable() }),
  steamShortcuts: z.object({ accountId: steamAccount.nullable() }),
  steamApply: z.object({ accountId: steamAccount, gameIds: z.array(id).max(5000), includeLauncher: z.boolean() }),
  gameProgress: z.object({ raGameId: id, force: z.boolean().optional() }),
  search: z.object({ consoleId: id, query: z.string().trim().min(1).max(100) }),
};

export function registerSystemRoutes(c: Container): void {
  // Sistema
  handle('dialog:open-file', schemas.fileDialog, ({ kind }, event) => pickFile(event, FILE_FILTERS[kind]));
  handle('app:open-external', schemas.externalUrl, (url) => shell.openExternal(url));
  handle('app:update-status', null, () => c.appUpdate.status());
  handle('app:update-check', null, () => c.appUpdate.check());
  handle('app:update-install', null, () => c.appUpdate.install());

  // Emuladores próprios
  handle('emulators:overview', null, () => c.emulators.overview());
  handle('emulators:refresh', null, () => c.emulators.refresh());
  handle('emulators:set-path', schemas.emulatorPath, async ({ id: emulatorId, path: action }, event) => {
    if (action === null) return c.emulators.setPath(emulatorId, null);
    const file = await pickFile(event, [{ name: 'Executável do emulador', extensions: ['exe'] }], 'Escolha o executável do emulador');
    return file ? c.emulators.setPath(emulatorId, file) : null;
  });
  handle('emulators:set-console', schemas.emulatorConsole, ({ consoleId, choice }) => c.emulators.setForConsole(consoleId, choice));
  handle('emulators:set-fullscreen', z.boolean(), (fullscreen) => c.emulators.setFullscreen(fullscreen));

  // Steam (atalhos não-Steam)
  handle('steam:shortcuts', schemas.steamShortcuts, ({ accountId }) => c.steamShortcuts.overview(accountId));
  handle('steam:shortcuts-apply', schemas.steamApply, (input) => c.steamShortcuts.apply(input));
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
