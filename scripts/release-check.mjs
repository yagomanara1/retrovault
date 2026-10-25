// Confere os arquivos de uma versão antes de publicar (passo a passo em docs/PUBLICAR.md).
// Uso: npm run release:check
// Recusa se o latest.yml não for desta versão ou se o hash dele não for o do instalador:
// publicado assim, o app de quem já instalou baixaria e descartaria a atualização.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = path.join(root, 'release');
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const setup = `RetroVault-Setup-${version}.exe`;
const files = [setup, `${setup}.blockmap`, 'latest.yml'].map((name) => path.join(release, name));
for (const file of files) if (!existsSync(file)) fail(`falta ${path.basename(file)} em release/ (rode npm run dist)`);

// latest.yml é simples (gerado pelo electron-builder): basta ler os campos de primeiro nível.
// BOM e quebras de linha do Windows, se alguém abriu e salvou o arquivo num editor.
const yml = readFileSync(files[2], 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
const field = (name) => yml.match(new RegExp(`^${name}: '?([^'\\n]+)'?$`, 'm'))?.[1];
if (field('version') !== version) fail(`latest.yml é da versão ${field('version')}, mas o package.json diz ${version}`);
if (field('path') !== setup) fail(`latest.yml aponta para ${field('path')}, não para ${setup}`);
const sha512 = createHash('sha512').update(readFileSync(files[0])).digest('base64');
if (field('sha512') !== sha512) fail('o hash do latest.yml não é o do instalador (gere de novo com npm run dist)');
const size = Number(yml.match(/^\s+size: (\d+)$/m)?.[1]);
if (size !== statSync(files[0]).size) fail('o tamanho no latest.yml não é o do instalador');

// Ícone público na raiz do repositório (o Discord mostra quando o jogo não tem capa): igual ao do app.
const icon = path.join(root, 'icon.png');
if (!existsSync(icon) || !readFileSync(icon).equals(readFileSync(path.join(root, 'build', 'icon.png')))) {
  fail('icon.png da raiz não é igual a build/icon.png (copie o build/icon.png para a raiz)');
}

console.log(`✓ versão ${version} pronta para publicar (latest.yml confere com o instalador).`);
console.log(`\nNa Release "v${version}" (sem ponto depois do v), anexe estes 3 arquivos:`);
for (const file of files) console.log(`  ${file}  (${(statSync(file).size / 1e6).toFixed(1)} MB)`);
