// Gera o catalog.json a partir do catálogo embutido no app (seedCatalog.ts), no formato do catálogo online.
import { CATALOG_SCHEMA_VERSION, parseCatalog } from '../../src/main/services/store/catalogSchema';
import { SEED_CATALOG } from '../../src/main/services/store/seedCatalog';

export function exportCatalog(): string {
  const { ports, skipped } = parseCatalog(SEED_CATALOG);
  if (skipped.length) throw new Error(`catálogo embutido com problemas: ${skipped.join('; ')}`);
  // $schema: o VS Code (e outros editores) usa para sugerir campos e apontar erros enquanto se edita.
  return `${JSON.stringify({ $schema: './catalog.schema.json', schemaVersion: CATALOG_SCHEMA_VERSION, ports }, null, 2)}\n`;
}
