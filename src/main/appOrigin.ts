import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Página do renderer empacotado (todo o main vira out/main/index.js; o renderer fica em out/renderer). */
export const RENDERER_INDEX = path.join(__dirname, '../renderer/index.html');

export interface AppOriginOptions {
  indexFile: string;
  /** Servidor do electron-vite em desenvolvimento; ignorado no app empacotado. */
  devUrl: string | null;
}

/**
 * A URL é a página do próprio app? Vale só o index.html do renderer (com qualquer #rota ou ?parâmetro) ou,
 * em desenvolvimento, a mesma origem do servidor do electron-vite. Qualquer outro arquivo local ou site fica
 * de fora: não navega na janela nem fala com o IPC.
 */
export function isAppUrl(url: string, { indexFile, devUrl }: AppOriginOptions): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (devUrl) {
    try {
      return parsed.origin === new URL(devUrl).origin;
    } catch {
      return false;
    }
  }
  if (parsed.protocol !== 'file:') return false;
  try {
    // Windows não diferencia maiúsculas no caminho.
    return path.normalize(fileURLToPath(parsed)).toLowerCase() === path.normalize(indexFile).toLowerCase();
  } catch {
    return false;
  }
}
