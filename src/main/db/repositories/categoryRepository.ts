import type { Category } from '@shared/types';
import type { DB } from '../database';

/** Categorias do usuário e a ligação N:N com os jogos. */
export class CategoryRepository {
  constructor(private readonly db: DB) {}

  list(): Category[] {
    return this.db
      .prepare<[], Category>(
        `SELECT c.id, c.name, c.icon, c.console, (SELECT COUNT(*) FROM game_categories gc WHERE gc.category_id = c.id) AS gameCount
         FROM categories c ORDER BY c.sort_order, c.name COLLATE NOCASE`,
      )
      .all();
  }

  get(id: number): Category | null {
    return this.list().find((c) => c.id === id) ?? null;
  }

  findByName(name: string): Category | null {
    const row = this.db.prepare<[string], { id: number }>('SELECT id FROM categories WHERE name = ? COLLATE NOCASE').get(name);
    return row ? this.get(row.id) : null;
  }

  findByConsole(console: string): Category | null {
    const row = this.db.prepare<[string], { id: number }>('SELECT id FROM categories WHERE console = ?').get(console);
    return row ? this.get(row.id) : null;
  }

  /** Nova categoria vai para o fim da lista. Nome repetido (sem diferenciar maiúsculas) viola UNIQUE. */
  create(name: string, console: string | null = null): Category {
    const next = this.db.prepare<[], number>('SELECT COALESCE(MAX(sort_order), -1) + 1 FROM categories').pluck().get()!;
    const id = Number(
      this.db
        .prepare('INSERT INTO categories (name, sort_order, created_at, console) VALUES (?, ?, ?, ?)')
        .run(name, next, new Date().toISOString(), console).lastInsertRowid,
    );
    return this.get(id)!;
  }

  /** Liga uma categoria que já existia (ex.: "PS4" criada pelo usuário) a um console. */
  linkConsole(id: number, console: string): void {
    this.db.prepare('UPDATE categories SET console = ? WHERE id = ?').run(console, id);
  }

  /** Consoles que já foram oferecidos como categoria (criados ou ligados), mesmo que apagados depois. */
  seededConsoles(): Set<string> {
    return new Set(this.db.prepare<[], string>('SELECT console FROM console_categories_seeded').pluck().all());
  }

  markSeeded(consoles: readonly string[]): void {
    const insert = this.db.prepare('INSERT OR IGNORE INTO console_categories_seeded (console) VALUES (?)');
    for (const c of consoles) insert.run(c);
  }

  /** Várias operações de uma vez (a semeadura dos consoles é tudo ou nada). */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  rename(id: number, name: string): void {
    this.db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, id);
  }

  setIcon(id: number, icon: string | null): void {
    this.db.prepare('UPDATE categories SET icon = ? WHERE id = ?').run(icon, id);
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  }

  /** Troca de posição com a vizinha (para cima = -1, para baixo = +1). */
  move(id: number, direction: -1 | 1): void {
    const ordered = this.list().map((c) => c.id);
    const from = ordered.indexOf(id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= ordered.length) return;
    [ordered[from], ordered[to]] = [ordered[to]!, ordered[from]!];
    const update = this.db.prepare('UPDATE categories SET sort_order = ? WHERE id = ?');
    this.db.transaction(() => ordered.forEach((cid, i) => update.run(i, cid)))();
  }

  /** Substitui as categorias do jogo pelas informadas. */
  setForGame(gameId: number, categoryIds: readonly number[]): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM game_categories WHERE game_id = ?').run(gameId);
      const insert = this.db.prepare('INSERT OR IGNORE INTO game_categories (game_id, category_id) VALUES (?, ?)');
      for (const cid of new Set(categoryIds)) insert.run(gameId, cid);
    })();
  }

  /** Adiciona sem tirar o jogo das outras categorias. */
  assign(gameId: number, categoryId: number): boolean {
    return this.db.prepare('INSERT OR IGNORE INTO game_categories (game_id, category_id) VALUES (?, ?)').run(gameId, categoryId).changes > 0;
  }
}
