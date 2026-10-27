// Rotas IPC: o contrato está em @shared/ipc; cada assunto registra as suas (toda entrada validada com zod).
import type { Container } from '../container';
import { registerGameRoutes } from './games';
import { registerSaveRoutes } from './saves';
import { registerStoreRoutes } from './store';
import { registerSystemRoutes } from './system';

export function registerIpc(c: Container): void {
  registerGameRoutes(c);
  registerSaveRoutes(c);
  registerStoreRoutes(c);
  registerSystemRoutes(c);
}
