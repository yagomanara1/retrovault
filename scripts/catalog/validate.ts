// Validador do catalog.json do repositório do catálogo. É empacotado (esbuild) num arquivo só,
// tools/validate.mjs, com as MESMAS regras que o RetroVault usa ao ler o catálogo online
// (parseCatalog): o que passa aqui é o que aparece na Loja. Uso: node tools/validate.mjs catalog.json
import { readFileSync } from 'node:fs';
import { CATALOG_SCHEMA_VERSION, parseCatalog } from '../../src/main/services/store/catalogSchema';

const MAX_CATALOG_BYTES = 2 * 1024 * 1024;

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const file = process.argv[2] ?? 'catalog.json';
let text: string;
try {
  text = readFileSync(file, 'utf8');
} catch {
  fail(`não encontrei ${file}`);
}
if (Buffer.byteLength(text) > MAX_CATALOG_BYTES) fail('catálogo grande demais (o app aceita até 2 MB)');

let raw: unknown;
try {
  // Editores do Windows às vezes gravam a marca BOM no começo; o app a ignora, então aqui também.
  raw = JSON.parse(text.replace(/^\uFEFF/, ''));
} catch (err) {
  fail(`JSON inválido: ${(err as Error).message}`);
}

let parsed: ReturnType<typeof parseCatalog>;
try {
  parsed = parseCatalog(raw);
} catch (err) {
  fail((err as Error).message);
}

const problems = [...parsed.skipped];
// Regras do repositório (o app só ignoraria em silêncio, ou mostraria duas vezes).
const repos = new Map<string, string>();
for (const port of parsed.ports) {
  const repo = port.source.repo.toLowerCase();
  const other = repos.get(repo);
  if (other) problems.push(`"${port.id}": mesmo repositório que "${other}" (${port.source.repo})`);
  else repos.set(repo, port.id);
}
const total = Array.isArray((raw as { ports?: unknown }).ports) ? (raw as { ports: unknown[] }).ports.length : 0;

if (problems.length) {
  console.error(`✗ ${problems.length} problema(s) em ${file}:`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error(`\nO app leria ${parsed.ports.length} de ${total} ports. Corrija antes de publicar.`);
  process.exit(1);
}
console.log(`✓ ${file}: ${parsed.ports.length} ports válidos (formato ${CATALOG_SCHEMA_VERSION}).`);
