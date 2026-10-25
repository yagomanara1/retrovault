// Roda o Vitest dentro do runtime Node do Electron (ELECTRON_RUN_AS_NODE=1).
// Motivo: o better-sqlite3 é recompilado para o ABI do Electron no postinstall e não carrega no
// Node do sistema. Uso: `npm test` (uma vez) ou `npm run test:watch`.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const electron = require('electron'); // no Node puro, o pacote exporta o caminho do executável
const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const args = process.argv.slice(2);
// `npm test -- arquivo.test.ts` roda uma vez: sem subcomando explícito, o Vitest entraria em modo watch.
const SUBCOMMANDS = new Set(['run', 'watch', 'related', 'bench', 'list']);
const vitestArgs = SUBCOMMANDS.has(args[0] ?? '') ? args : ['run', ...args];

const child = spawn(electron, [vitest, ...vitestArgs], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
child.on('exit', (code) => process.exit(code ?? 1));
