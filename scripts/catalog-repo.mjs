// Monta (ou atualiza) a pasta do repositório do catálogo online da Loja.
// Uso: npm run catalog:repo -- [pasta] [--force]
//   pasta   padrão: ../retrovault-catalog (ao lado do projeto)
//   --force sobrescreve o catalog.json (sem ele, um catalog.json que já existe nunca é tocado)
// Sempre atualiza as ferramentas: tools/validate.mjs (mesmas regras do app), o schema do editor,
// a verificação do GitHub, o guia de manutenção e o README (com a lista de ports e os créditos).
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const force = args.includes('--force');
const dest = path.resolve(root, args.find((a) => !a.startsWith('--')) ?? '../retrovault-catalog');
const template = path.join(root, 'scripts', 'catalog', 'template');

const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  alias: { '@shared': path.join(root, 'src', 'shared') },
  logLevel: 'warning',
};

mkdirSync(path.join(dest, 'tools'), { recursive: true });

// 1) Validador: o parseCatalog do app (com o zod) num arquivo só, sem npm install no repositório.
await build({
  ...common,
  entryPoints: [path.join(root, 'scripts', 'catalog', 'validate.ts')],
  outfile: path.join(dest, 'tools', 'validate.mjs'),
  banner: { js: '// Gerado pelo RetroVault (npm run catalog:repo). Não edite: as regras vêm do app.' },
});

/** Empacota um script TypeScript daqui e o importa (para usar o código do app sem compilar o projeto). */
const tmpDir = path.join(root, 'node_modules', '.cache', 'catalog-repo');
async function load(name) {
  mkdirSync(tmpDir, { recursive: true });
  const outfile = path.join(tmpDir, `${name}.mjs`);
  await build({ ...common, entryPoints: [path.join(root, 'scripts', 'catalog', `${name}.ts`)], outfile });
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
}

// 2) catalog.json a partir do catálogo embutido (só se ainda não existir, ou com --force).
const catalogFile = path.join(dest, 'catalog.json');
if (!existsSync(catalogFile) || force) {
  const { exportCatalog } = await load('export');
  writeFileSync(catalogFile, exportCatalog());
  console.log(`catalog.json ${force ? 'regerado' : 'criado'} a partir do catálogo embutido.`);
} else {
  console.log('catalog.json já existe: mantido (use --force para regerar a partir do app).');
}

// 3) Arquivos do modelo (README, schema do editor, verificação do GitHub, .gitignore).
function copyTree(from, to) {
  for (const name of readdirSync(from)) {
    const src = path.join(from, name);
    const target = path.join(to, name);
    if (statSync(src).isDirectory()) {
      mkdirSync(target, { recursive: true });
      copyTree(src, target);
    } else copyFileSync(src, target);
  }
}
copyTree(template, dest);

// 4) Confere o catálogo com o próprio validador gerado (antes do README, que precisa dele válido).
execFileSync(process.execPath, [path.join(dest, 'tools', 'validate.mjs'), catalogFile], { stdio: 'inherit' });

// 5) README: a lista de ports, com os créditos, sai do catalog.json da pasta (inclusive das edições feitas nele).
const readmeFile = path.join(dest, 'README.md');
const { renderReadme } = await load('readme');
writeFileSync(readmeFile, renderReadme(readFileSync(path.join(template, 'README.md'), 'utf8'), readFileSync(catalogFile, 'utf8')));
rmSync(tmpDir, { recursive: true, force: true });
console.log('README.md gerado com a lista de ports e os créditos.');
console.log(`\nPronto: ${dest}`);
