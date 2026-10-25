import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach } from 'vitest';

// Utilitários só para testes: pastas temporárias com árvores de arquivos descritas em objeto.

/** Cria uma pasta temporária nova por teste e a apaga no fim. Retorna um getter do caminho. */
export function useTempDir(prefix = 'rv-test-'): () => string {
  let dir = '';
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return () => dir;
}

/** `{ 'a/b.txt': 'conteúdo', 'c/': null }` → arquivos e pastas (null = pasta vazia). */
export async function makeTree(root: string, tree: Record<string, string | Buffer | null>): Promise<void> {
  for (const [rel, content] of Object.entries(tree)) {
    const full = path.join(root, rel);
    if (content === null) {
      await fs.mkdir(full, { recursive: true });
      continue;
    }
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content);
  }
}
