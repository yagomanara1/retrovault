// Base das rotas IPC: validação de toda entrada (o renderer não é confiável), origem conferida e erros
// convertidos para um formato seguro. As rotas ficam nos arquivos por assunto (games.ts, store.ts…).
import { promises as fs } from 'node:fs';
import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { ROM_EXTENSIONS } from '@shared/consoles';
import type { FileDialogKind, IpcChannel, IpcInput, IpcOutput, IpcResult } from '@shared/ipc';
import { isAppUrl, RENDERER_INDEX } from '../appOrigin';
import { AppError, toIpcError } from '../errors';

// ---------- Schemas básicos ----------

export const id = z.number().int().positive();
export const filePath = z.string().trim().min(1).max(4096);
export const refresh = z.object({ force: z.boolean().optional() });
export const optionalNullableId = id.nullable().optional();
/** Identificador de port da Loja (o mesmo formato do catálogo). */
export const portId = z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, 'port inválido');

// ---------- Registro ----------

/** Só a página do próprio app fala com o IPC (a mesma regra que impede navegar para fora dela). */
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const devUrl = app.isPackaged ? null : (process.env.ELECTRON_RENDERER_URL ?? null);
  return isAppUrl(event.senderFrame?.url ?? '', { indexFile: RENDERER_INDEX, devUrl });
}

export function handle<C extends IpcChannel>(
  channel: C,
  schema: z.ZodType<IpcInput<C>, unknown> | null,
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

// ---------- Diálogos e pastas (sempre no main: o renderer nunca escolhe caminhos arbitrários) ----------

const windowOf = (event: IpcMainInvokeEvent) => BrowserWindow.fromWebContents(event.sender);

/** Diálogo de abrir, preso à janela que pediu; o primeiro caminho escolhido ou null se cancelado. */
export async function showOpen(event: IpcMainInvokeEvent, options: Electron.OpenDialogOptions): Promise<string | null> {
  const win = windowOf(event);
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

/** Diálogo de salvar, preso à janela que pediu; o caminho escolhido ou null se cancelado. */
export async function showSave(event: IpcMainInvokeEvent, options: Electron.SaveDialogOptions): Promise<string | null> {
  const win = windowOf(event);
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
  return result.canceled || !result.filePath ? null : result.filePath;
}

export function pickFile(event: IpcMainInvokeEvent, filters: Electron.FileFilter[], title?: string, defaultPath?: string | null): Promise<string | null> {
  return showOpen(event, { properties: ['openFile'], filters, title, defaultPath: defaultPath ?? undefined });
}

/** Abre a pasta no Explorer (criando-a se preciso); erro do sistema vira erro da tela. */
export async function openFolder(target: string, create = true): Promise<void> {
  if (create) await fs.mkdir(target, { recursive: true });
  const error = await shell.openPath(target);
  if (error) throw new AppError('INTERNAL', error);
}

export const FILE_FILTERS: Record<FileDialogKind, Electron.FileFilter[]> = {
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
