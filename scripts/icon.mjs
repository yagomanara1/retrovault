// Gera build/icon.png a partir de build/icon.svg (o electron-builder faz o .ico do instalador e do .exe).
// Uso: npm run icon
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electron = createRequire(import.meta.url)('electron'); // caminho do electron.exe
const svg = path.join(root, 'build', 'icon.svg');
const png = path.join(root, 'build', 'icon.png');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // com ela, o electron.exe vira Node e não abre janela
execFileSync(electron, [path.join(root, 'scripts', 'icon', 'render.cjs'), svg, png], { env, stdio: 'inherit' });
console.log(`build/icon.png gerado (${statSync(png).size} bytes)`);
