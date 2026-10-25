import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Rodado por scripts/test.mjs dentro do Node do Electron: o better-sqlite3 é compilado para o
// ABI do Electron, então os testes de banco usam exatamente o binário que vai para produção.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@': resolve('src/renderer/src'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Processos filhos herdam ELECTRON_RUN_AS_NODE e carregam o módulo nativo sem problemas.
    pool: 'forks',
    testTimeout: 20_000,
    // Logs informativos do app ("[db] migration … aplicada") só poluem a saída dos testes.
    onConsoleLog: (log) => !/^\[(db|backup)\]/.test(log),
  },
});
