import { type Dirent, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Game } from '@shared/types';
import { AppError } from '../errors';
import { isFile } from './fsUtils';
import type { GameService } from './gameService';
import type { TrophyService } from './trophies/trophyService';

// Jogos movidos de pasta: em vez de readicionar (e perder tempo de jogo, troféus e arte),
// o RetroVault encontra o novo local e atualiza só o caminho.

export interface MoveCandidate {
  path: string;
  /** Quantas partes finais do caminho batem com o antigo (2 = pasta + arquivo). */
  score: number;
}

export interface RelocationHooks {
  onRelocated(game: Game, previousPath: string): void;
}

const MAX_DEPTH = 6;
const MAX_DIRS = 20_000;
const SEARCH_BUDGET_MS = 8_000;
/** Reparo automático exige pelo menos a pasta e o nome do arquivo iguais. */
const AUTO_MIN_SCORE = 2;
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'appdata', 'windows', '$recycle.bin', 'system volume information',
  '_internal', 'shader', 'shadercache', 'cache', 'savedata', 'savedata_backups',
]);

const segments = (p: string) => path.resolve(p).toLowerCase().split(/[\\/]+/).filter(Boolean);

/** Partes finais em comum: "...\Gow\gow3-windows\God of War III.exe" × o caminho antigo. */
export function suffixScore(candidate: string, previous: string): number {
  const a = segments(candidate);
  const b = segments(previous);
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

/** Pasta existente mais próxima do caminho antigo (abre o seletor "perto" de onde o jogo estava). */
export async function nearestExistingDir(p: string): Promise<string | null> {
  let dir = path.dirname(path.resolve(p));
  for (;;) {
    const ok = await fs.stat(dir).then((s) => s.isDirectory()).catch(() => false);
    if (ok) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Raízes de busca sem sobreposição: uma raiz dentro de outra seria varrida duas vezes. */
function dedupeRoots(roots: string[]): string[] {
  const sorted = [...new Set(roots.map((r) => path.resolve(r)))].sort((a, b) => a.length - b.length);
  const kept: string[] = [];
  for (const r of sorted) {
    if (!kept.some((k) => r.toLowerCase().startsWith(k.toLowerCase().replace(/[\\/]?$/, path.sep)))) kept.push(r);
  }
  return kept;
}

/**
 * Busca em largura por arquivos com o mesmo nome, com limites de profundidade, pastas e tempo.
 * Pastas rasas demais (C:\, a pasta do usuário) não viram raiz: varreriam o disco inteiro.
 */
export async function findMovedFile(previousPath: string, extraRoots: readonly string[]): Promise<MoveCandidate[]> {
  const target = path.basename(previousPath).toLowerCase();
  const home = path.resolve(os.homedir()).toLowerCase();
  const nearest = await nearestExistingDir(previousPath);
  const roots = dedupeRoots(
    [nearest, ...extraRoots].filter((r): r is string => {
      if (!r) return false;
      const resolved = path.resolve(r);
      return path.dirname(resolved) !== resolved && resolved.toLowerCase() !== home;
    }),
  );

  const found = new Map<string, MoveCandidate>();
  const deadline = Date.now() + SEARCH_BUDGET_MS;
  let visited = 0;
  const queue: { dir: string; depth: number }[] = roots.map((dir) => ({ dir, depth: 0 }));

  while (queue.length > 0 && visited < MAX_DIRS && Date.now() < deadline) {
    const { dir, depth } = queue.shift()!;
    visited++;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === target) {
        found.set(full.toLowerCase(), { path: full, score: suffixScore(full, previousPath) });
      } else if (entry.isDirectory() && depth < MAX_DEPTH && !SKIP_DIRS.has(entry.name.toLowerCase())) {
        queue.push({ dir: full, depth: depth + 1 });
      }
    }
  }
  return [...found.values()].sort((a, b) => b.score - a.score);
}

/** O melhor candidato, se for único na pontuação máxima. */
export function pickCandidate(candidates: readonly MoveCandidate[], minScore: number): MoveCandidate | null {
  const [best, second] = candidates;
  if (!best || best.score < minScore) return null;
  return second && second.score === best.score ? null : best;
}

export class RelocationService {
  constructor(
    private readonly games: GameService,
    private readonly trophies: TrophyService,
    private readonly hooks: RelocationHooks,
  ) {}

  /** Ids dos jogos cujo arquivo não existe mais. */
  async missing(): Promise<number[]> {
    const games = this.games.list();
    const exists = await Promise.all(games.map((g) => isFile(g.path)));
    return games.filter((_, i) => !exists[i]).map((g) => g.id);
  }

  /** Aponta o jogo para o novo arquivo mantendo tempo de jogo, troféus, arte e histórico. */
  async relocate(gameId: number, newPath: string): Promise<Game> {
    const previous = this.games.get(gameId);
    const game = await this.games.relocate(gameId, newPath);
    this.trophies.onGameMoved(gameId, previous.path, game.path);
    this.hooks.onRelocated(game, previous.path);
    return game;
  }

  /** Procura o novo local; usado pelo botão "Procurar automaticamente". */
  async autoRelocate(gameId: number): Promise<Game> {
    const game = this.games.get(gameId);
    if (await isFile(game.path)) return game;
    const candidates = await findMovedFile(game.path, this.libraryRoots(gameId));
    // A pedido do usuário aceita só o nome igual, desde que não haja empate.
    const best = pickCandidate(candidates, 1);
    if (!best) {
      throw new AppError(
        'NOT_FOUND',
        candidates.length > 1
          ? `Encontramos ${candidates.length} arquivos "${path.basename(game.path)}". Use "Localizar…" para escolher o certo.`
          : `Não encontramos "${path.basename(game.path)}" perto do local antigo nem nas pastas da biblioteca. Use "Localizar…".`,
      );
    }
    return this.relocate(gameId, best.path);
  }

  /** Na inicialização: repara só o que é inequívoco (pasta + arquivo iguais, candidato único). */
  async repairLibrary(): Promise<void> {
    for (const gameId of await this.missing()) {
      const game = this.games.list().find((g) => g.id === gameId);
      if (!game) continue;
      try {
        const best = pickCandidate(await findMovedFile(game.path, this.libraryRoots(gameId)), AUTO_MIN_SCORE);
        if (best) {
          await this.relocate(gameId, best.path);
          console.info(`[relocation] ${game.title}: ${game.path} → ${best.path}`);
        }
      } catch (err) {
        console.warn(`[relocation] falha ao procurar ${game.title}`, err);
      }
    }
  }

  /**
   * Pastas "da biblioteca": até 3 níveis acima de cada outro jogo, onde jogos movidos costumam parar
   * (Desktop\Jogos\Gow\gow3-windows\gow3-windows\God of War III.exe → …\Desktop\Jogos\Gow).
   * findMovedFile descarta a raiz do disco e a pasta do usuário e mantém só as raízes mais rasas.
   */
  private libraryRoots(exceptId: number): string[] {
    const roots: string[] = [];
    for (const g of this.games.list()) {
      if (g.id === exceptId) continue;
      let dir = path.dirname(g.path);
      for (let level = 0; level < 3; level++) {
        roots.push(dir);
        dir = path.dirname(dir);
      }
    }
    return roots;
  }
}
