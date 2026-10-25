import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isCategoryIconKey } from '@shared/categoryIcons';
import { CONSOLE_CATEGORIES, consoleCategoryByName, consoleOfPort } from '@shared/consoleCategories';
import type { StorePort } from '@shared/store';
import type { AutoOrganizeResult, Category, Game } from '@shared/types';
import type { CategoryRepository } from '../db/repositories/categoryRepository';
import { AppError } from '../errors';
import type { GameService } from './gameService';
import { detectPlatform } from './platform';

export interface CategoryServiceDeps {
  repo: CategoryRepository;
  games: GameService;
  /** O jogo tem troféus de um dump de PS4 (sinal forte de plataforma). */
  hasPs4Trophies: (gameId: number) => boolean;
}

const MAX_NAME = 40;

function cleanName(name: string): string {
  const cleaned = name.replace(/\s+/g, ' ').trim();
  if (!cleaned) throw new AppError('VALIDATION', 'Dê um nome para a categoria.');
  if (cleaned.length > MAX_NAME) throw new AppError('VALIDATION', `Use no máximo ${MAX_NAME} caracteres.`);
  return cleaned;
}

/** Categorias do usuário (PS4, Nintendo DS…) e organização automática por plataforma. */
export class CategoryService {
  constructor(private readonly deps: CategoryServiceDeps) {}

  list(): Category[] {
    return this.deps.repo.list();
  }

  create(name: string): Category {
    const clean = cleanName(name);
    if (this.deps.repo.findByName(clean)) throw new AppError('DUPLICATE', `Já existe a categoria "${clean}".`);
    return this.deps.repo.create(clean);
  }

  rename(id: number, name: string): Category {
    this.require(id);
    const clean = cleanName(name);
    const other = this.deps.repo.findByName(clean);
    if (other && other.id !== id) throw new AppError('DUPLICATE', `Já existe a categoria "${clean}".`);
    this.deps.repo.rename(id, clean);
    return this.deps.repo.get(id)!;
  }

  /** null volta ao ícone automático (pelo nome). */
  setIcon(id: number, icon: string | null): Category {
    this.require(id);
    if (icon !== null && !isCategoryIconKey(icon)) throw new AppError('VALIDATION', 'Ícone inválido.');
    this.deps.repo.setIcon(id, icon);
    return this.deps.repo.get(id)!;
  }

  /** Apaga só a categoria: os jogos continuam na biblioteca. */
  delete(id: number): void {
    this.require(id);
    this.deps.repo.delete(id);
  }

  move(id: number, direction: -1 | 1): Category[] {
    this.require(id);
    this.deps.repo.move(id, direction);
    return this.list();
  }

  setForGame(gameId: number, categoryIds: readonly number[]): Game {
    this.deps.games.get(gameId);
    const known = new Set(this.list().map((c) => c.id));
    const invalid = categoryIds.find((id) => !known.has(id));
    if (invalid !== undefined) throw new AppError('NOT_FOUND', 'Categoria não encontrada.');
    this.deps.repo.setForGame(gameId, categoryIds);
    return this.deps.games.get(gameId);
  }

  async platformOf(game: Game): Promise<string | null> {
    const siblingFiles =
      game.kind === 'executable' ? await fs.readdir(path.dirname(game.path)).catch(() => [] as string[]) : [];
    return detectPlatform(game, { hasPs4Trophies: this.deps.hasPs4Trophies(game.id), siblingFiles: siblingFiles.slice(0, 2000) });
  }

  /**
   * Uma categoria para cada console (shared/consoleCategories.ts), cada uma com o seu ícone.
   * Só oferece cada console uma vez: o que o usuário apagar não volta. Uma categoria que ele já
   * tinha com o nome ou apelido do console ("PS4") é ligada a ele em vez de duplicada.
   * Devolve quantas categorias foram criadas.
   */
  ensureConsoleCategories(): number {
    const { repo } = this.deps;
    return repo.transaction(() => {
      const seeded = repo.seededConsoles();
      const pending = CONSOLE_CATEGORIES.filter((c) => !seeded.has(c.key));
      if (pending.length === 0) return 0;
      const unlinked = repo.list().filter((c) => c.console === null);
      let created = 0;
      for (const def of pending) {
        if (repo.findByConsole(def.key)) continue;
        const existing = unlinked.find((c) => consoleCategoryByName(c.name)?.key === def.key);
        if (existing) repo.linkConsole(existing.id, def.key);
        else if (!repo.findByName(def.name)) {
          repo.create(def.name, def.key);
          created++;
        }
      }
      repo.markSeeded(pending.map((c) => c.key));
      return created;
    });
  }

  /** Categoria de uma plataforma detectada: a ligada ao console, senão a de mesmo nome. */
  private categoryForPlatform(platform: string): Category | null {
    const match = consoleCategoryByName(platform);
    return (match && this.deps.repo.findByConsole(match.key)) || this.deps.repo.findByName(platform);
  }

  /**
   * Jogo recém-adicionado entra na categoria da sua plataforma, se ela já existir
   * (não cria categorias sozinho: isso fica para "Organizar automaticamente").
   */
  async assignNewGame(gameId: number): Promise<boolean> {
    const game = this.deps.games.get(gameId);
    if (game.categoryIds.length > 0) return false;
    const platform = await this.platformOf(game);
    const category = platform ? this.categoryForPlatform(platform) : null;
    return category ? this.deps.repo.assign(gameId, category.id) : false;
  }

  /**
   * Port da Loja: o jogo entra na categoria do console original ("PlayStation 2" para o Fukami).
   * Respeita o que o usuário já organizou e não recria a categoria de um console apagado.
   */
  assignPortGame(gameId: number, original: Pick<StorePort['original'], 'platform' | 'system'>): boolean {
    const game = this.deps.games.get(gameId);
    if (game.categoryIds.length > 0) return false;
    const match = consoleOfPort(original);
    const category = match ? this.deps.repo.findByConsole(match.key) : null;
    return category ? this.deps.repo.assign(gameId, category.id) : false;
  }

  /**
   * Cria uma categoria por plataforma e coloca nela os jogos que ainda não têm categoria.
   * Jogos que o usuário já organizou ficam como estão.
   */
  async autoOrganize(): Promise<AutoOrganizeResult> {
    const result: AutoOrganizeResult = { categoriesCreated: [], gamesAssigned: 0, unknown: [] };
    for (const game of this.deps.games.list()) {
      if (game.categoryIds.length > 0) continue;
      const platform = await this.platformOf(game);
      if (!platform) {
        result.unknown.push(game.title);
        continue;
      }
      let category = this.categoryForPlatform(platform);
      if (!category) {
        category = this.deps.repo.create(platform, consoleCategoryByName(platform)?.key ?? null);
        result.categoriesCreated.push(platform);
      }
      if (this.deps.repo.assign(game.id, category.id)) result.gamesAssigned++;
    }
    return result;
  }

  private require(id: number): Category {
    const category = this.deps.repo.get(id);
    if (!category) throw new AppError('NOT_FOUND', 'Categoria não encontrada.');
    return category;
  }
}
