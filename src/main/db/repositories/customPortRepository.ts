import type { DB } from '../database';

/** Ports adicionados pelo usuário (JSON de um item do catálogo; quem lê valida). */
export class CustomPortRepository {
  constructor(private readonly db: DB) {}

  list(): { id: string; json: string }[] {
    return this.db.prepare<[], { id: string; json: string }>('SELECT id, json FROM custom_ports ORDER BY created_at').all();
  }

  has(id: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM custom_ports WHERE id = ?').get(id);
  }

  save(id: string, json: string): void {
    this.db.prepare('INSERT INTO custom_ports (id, json, created_at) VALUES (?, ?, ?)').run(id, json, new Date().toISOString());
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM custom_ports WHERE id = ?').run(id);
  }
}
