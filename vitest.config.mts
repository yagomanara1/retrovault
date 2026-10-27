import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Rodado por scripts/test.mjs dentro do Node do Electron: os testes de banco usam a mesma versão do
// Node e o mesmo binário do better-sqlite3 que vão para produção.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@': resolve('src/renderer/src'),
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    // Processo principal em Node; testes da interface declaram "// @vitest-environment jsdom" no topo.
    environment: 'node',
    // Processos filhos herdam ELECTRON_RUN_AS_NODE e carregam o módulo nativo sem problemas.
    pool: 'forks',
    testTimeout: 20_000,
    // Logs informativos do app ("[db] migration … aplicada") só poluem a saída dos testes.
    onConsoleLog: (log) => !/^\[(db|backup)\]/.test(log),
  },
});
