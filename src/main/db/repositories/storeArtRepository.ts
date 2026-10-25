import type { DB } from '../database';

/** Imagens da Loja já baixadas: endereço de origem → arte local (rv-media://). */
export class StoreArtRepository {
  constructor(private readonly db: DB) {}

  get(sourceUrl: string): string | null {
    return this.db.prepare<[string], { local_url: string }>('SELECT local_url FROM store_art WHERE source_url = ?').get(sourceUrl)?.local_url ?? null;
  }

  save(sourceUrl: string, localUrl: string): void {
    this.db
      .prepare(
        `INSERT INTO store_art (source_url, local_url, fetched_at) VALUES (?, ?, ?)
         ON CONFLICT (source_url) DO UPDATE SET local_url = excluded.local_url, fetched_at = excluded.fetched_at`,
      )
      .run(sourceUrl, localUrl, new Date().toISOString());
  }

  /** Para a limpeza de artes não apagar o que a Loja usa. */
  localUrls(): string[] {
    return this.db.prepare<[], { local_url: string }>('SELECT local_url FROM store_art').all().map((r) => r.local_url);
  }
}
