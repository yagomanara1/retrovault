import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Game, GameSaves, SaveLocation, SaveSnapshot, SaveSnapshotReason } from '@shared/types';
import type { SavePathRepository } from '../../db/repositories/savePathRepository';
import { AppError } from '../../errors';
import type { GameService } from '../gameService';
import type { SaveLocator } from './saveLocator';
import type { Anchor, GameIdentity, SaveEntry, SaveVault } from './saveVault';

export interface SaveServiceDeps {
  games: GameService;
  repo: SavePathRepository;
  locator: SaveLocator;
  vault: SaveVault;
  /** Pasta do RetroArch, para guardar saves de ROMs relativos a ela. */
  retroarchDir: () => Promise<string | null>;
  isRunning: (gameId: number) => boolean;
}

const isInside = (child: string, parent: string) => {
  const rel = path.relative(parent, child);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
};

async function sizeOf(p: string): Promise<{ exists: boolean; isDirectory: boolean; size: number }> {
  const stat = await fs.stat(p).catch(() => null);
  if (!stat) return { exists: false, isDirectory: false, size: 0 };
  if (!stat.isDirectory()) return { exists: true, isDirectory: false, size: stat.size };
  let size = 0;
  const walk = async (dir: string) => {
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else size += (await fs.stat(full).catch(() => null))?.size ?? 0;
    }
  };
  await walk(p);
  return { exists: true, isDirectory: true, size };
}

/**
 * Cofre de saves por jogo: detecta onde está o save, guarda versões numa pasta separada do jogo
 * e restaura — inclusive num jogo readicionado depois de apagado (mesmo exe/título).
 */
export class SaveService {
  /** Uma operação por jogo de cada vez (backup em andamento × restauração). */
  private readonly locks = new Map<number, Promise<unknown>>();

  constructor(private readonly deps: SaveServiceDeps) {}

  async get(gameId: number): Promise<GameSaves> {
    const game = this.deps.games.get(gameId);
    const locations = await this.locations(game);
    const vaultDir = await this.deps.vault.findGameDir(this.identity(game));
    const snapshots = await this.deps.vault.list(vaultDir);
    return {
      locations,
      snapshots,
      vaultDir,
      fromPreviousInstall: snapshots.length > 0 && locations.every((l) => !l.exists),
    };
  }

  backup(gameId: number, reason: SaveSnapshotReason): Promise<SaveSnapshot | null> {
    return this.withLock(gameId, async () => {
      const game = this.deps.games.get(gameId);
      const entries = await this.entries(game);
      // Automáticos só gravam se o save mudou; o manual sempre grava (o usuário pediu).
      return this.deps.vault.snapshot(this.identity(game), entries, reason, reason !== 'manual');
    });
  }

  /** Verificação periódica / inicial de todos os jogos. Falhas de um jogo não param os outros. */
  async backupLibrary(reason: 'auto' | 'initial'): Promise<number> {
    let created = 0;
    for (const game of this.deps.games.list()) {
      try {
        if (await this.backup(game.id, reason)) created++;
      } catch (err) {
        console.warn(`[saves] backup de ${game.title} falhou`, err);
      }
    }
    return created;
  }

  restore(gameId: number, snapshotId: string): Promise<GameSaves> {
    return this.withLock(gameId, async () => {
      const game = this.deps.games.get(gameId);
      if (this.deps.isRunning(gameId)) throw new AppError('ALREADY_RUNNING', 'Feche o jogo antes de restaurar o save.');
      const vaultDir = await this.deps.vault.findGameDir(this.identity(game));
      if (!vaultDir) throw new AppError('NOT_FOUND', 'Nenhum backup de save para este jogo.');
      const items = await this.deps.vault.entriesOf(vaultDir, snapshotId);
      const targets = await Promise.all(items.map((e) => this.resolve(game, e.anchor, e.key)));

      // Rede de segurança: o save atual vira uma versão antes de ser substituído.
      const current = await this.entries(game);
      if (current.length > 0) await this.deps.vault.snapshot(this.identity(game), current, 'pre-restore', false);

      for (const [i, item] of items.entries()) {
        const target = targets[i]!;
        this.assertSafeTarget(game, target);
        if (item.isDirectory) {
          await fs.rm(target, { recursive: true, force: true });
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.cp(item.storedPath, target, { recursive: true, preserveTimestamps: true });
        } else {
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.copyFile(path.join(item.storedPath, path.basename(item.key)), target);
        }
      }
      console.info(`[saves] ${game.title}: versão ${snapshotId} restaurada`);
      return this.get(game.id);
    });
  }

  async addPath(gameId: number, filePath: string): Promise<GameSaves> {
    const game = this.deps.games.get(gameId);
    const resolved = path.resolve(filePath);
    const gameDir = path.dirname(game.path);
    // A pasta inteira do jogo (ou uma acima dela) não é "save": o backup copiaria o jogo todo.
    if (resolved === gameDir || isInside(gameDir, resolved)) {
      throw new AppError('VALIDATION', 'Escolha a pasta ou o arquivo de save, não a pasta inteira do jogo.');
    }
    if (!(await sizeOf(resolved)).exists) throw new AppError('FILE_MISSING', 'Local não encontrado.');
    this.deps.repo.set(gameId, resolved, 'manual');
    return this.get(gameId);
  }

  async removePath(gameId: number, filePath: string): Promise<GameSaves> {
    this.deps.games.get(gameId);
    const manual = this.deps.repo.list(gameId).find((p) => p.path === filePath && p.mode === 'manual');
    if (manual) this.deps.repo.remove(gameId, filePath);
    else this.deps.repo.set(gameId, filePath, 'ignored'); // detectado: passa a ser ignorado
    return this.get(gameId);
  }

  // ---------- Internos ----------

  private identity(game: Game): GameIdentity {
    return { title: game.title, file: path.basename(game.path).toLowerCase() };
  }

  private async locations(game: Game): Promise<SaveLocation[]> {
    const custom = this.deps.repo.list(game.id);
    const ignored = new Set(custom.filter((p) => p.mode === 'ignored').map((p) => p.path.toLowerCase()));
    const detected = (await this.deps.locator.detect(game)).filter((p) => !ignored.has(p.toLowerCase()));
    const manual = custom.filter((p) => p.mode === 'manual').map((p) => p.path);
    const all = [
      ...detected.map((p) => ({ path: p, source: 'auto' as const })),
      ...manual.filter((p) => !detected.some((d) => d.toLowerCase() === p.toLowerCase())).map((p) => ({ path: p, source: 'manual' as const })),
    ];
    return Promise.all(
      all.map(async (l) => {
        const s = await sizeOf(l.path);
        return { ...l, exists: s.exists, isDirectory: s.isDirectory, sizeBytes: s.size };
      }),
    );
  }

  private async entries(game: Game): Promise<SaveEntry[]> {
    const raDir = game.kind === 'retroarch' ? await this.deps.retroarchDir() : null;
    const gameDir = path.dirname(game.path);
    const out: SaveEntry[] = [];
    for (const l of await this.locations(game)) {
      if (!l.exists) continue;
      const [anchor, key]: [Anchor, string] = isInside(l.path, gameDir)
        ? ['game', path.relative(gameDir, l.path)]
        : raDir && isInside(l.path, raDir)
          ? ['retroarch', path.relative(raDir, l.path)]
          : ['abs', l.path];
      out.push({ anchor, key, isDirectory: l.isDirectory, source: l.path });
    }
    return out;
  }

  /** Destino da restauração: relativo à pasta ATUAL do jogo (reinstalado em outro lugar funciona). */
  private async resolve(game: Game, anchor: Anchor, key: string): Promise<string> {
    if (anchor === 'game') return path.join(path.dirname(game.path), key);
    if (anchor === 'abs') return key;
    const raDir = await this.deps.retroarchDir();
    if (!raDir) throw new AppError('RETROARCH_NOT_FOUND', 'O RetroArch não foi encontrado para restaurar este save.');
    return path.join(raDir, key);
  }

  /** Nunca apaga/sobrescreve a pasta do jogo nem algo acima dela, nem a raiz do disco. */
  private assertSafeTarget(game: Game, target: string): void {
    const gameDir = path.dirname(game.path);
    const resolved = path.resolve(target);
    if (resolved === gameDir || isInside(gameDir, resolved) || path.dirname(resolved) === resolved) {
      throw new AppError('VALIDATION', `Destino de restauração inseguro: ${resolved}`);
    }
  }

  private withLock<T>(gameId: number, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(gameId) ?? Promise.resolve();
    const next = previous.then(task, task);
    const settled = next.catch(() => undefined);
    this.locks.set(gameId, settled);
    void settled.then(() => {
      if (this.locks.get(gameId) === settled) this.locks.delete(gameId);
    });
    return next;
  }
}
