import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Game, ProgressImportResult } from '@shared/types';
import type { GameRepository } from '../db/repositories/gameRepository';
import type { TrophyRepository } from '../db/repositories/trophyRepository';
import { AppError } from '../errors';

// Exporta/importa o progresso (tempo de jogo e troféus obtidos) num JSON portátil e legível,
// que sobrevive a reinstalar o Windows ou o RetroVault. A importação MESCLA: nunca apaga nada.

const FORMAT = 'retrovault-progress';
const VERSION = 1;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

const isoDate = z.string().max(40).refine((s) => !Number.isNaN(Date.parse(s)), 'data inválida');

const fileSchema = z.object({
  format: z.literal(FORMAT),
  version: z.number().int().min(1).max(VERSION),
  exportedAt: isoDate,
  games: z
    .array(
      z.object({
        title: z.string().max(200),
        path: z.string().max(4096),
        playtimeSeconds: z.number().int().min(0).max(1e9),
        lastPlayedAt: isoDate.nullable(),
        trophies: z
          .object({
            npCommId: z.string().max(32).nullable(),
            title: z.string().max(200).nullable(),
            unlocked: z
              .array(
                z.object({
                  id: z.number().int().min(0),
                  name: z.string().max(200),
                  unlockedAt: isoDate,
                  source: z.enum(['auto', 'manual']).nullable(),
                }),
              )
              .max(5000),
          })
          .nullable(),
      }),
    )
    .max(50_000),
});

type ProgressFile = z.infer<typeof fileSchema>;
type ExportedGame = ProgressFile['games'][number];

export class ProgressService {
  constructor(
    private readonly games: GameRepository,
    private readonly trophies: TrophyRepository,
  ) {}

  async export(file: string): Promise<void> {
    const data: ProgressFile = {
      format: FORMAT,
      version: VERSION,
      exportedAt: new Date().toISOString(),
      games: this.games.list().map((g) => {
        const set = this.trophies.getSet(g.id);
        return {
          title: g.title,
          path: g.path,
          playtimeSeconds: g.playtimeSeconds,
          lastPlayedAt: g.lastPlayedAt,
          trophies: set && {
            npCommId: set.npCommId,
            title: set.title,
            unlocked: set.trophies
              .filter((t) => t.unlockedAt)
              .map((t) => ({ id: t.id, name: t.name, unlockedAt: t.unlockedAt!, source: t.unlockSource })),
          },
        };
      }),
    };
    // Grava em .tmp e renomeia: um arquivo de progresso nunca fica pela metade.
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tmp, file);
  }

  async import(file: string): Promise<ProgressImportResult> {
    const stat = await fs.stat(file).catch(() => null);
    if (!stat?.isFile()) throw new AppError('FILE_MISSING', 'Arquivo não encontrado.');
    if (stat.size > MAX_FILE_BYTES) throw new AppError('VALIDATION', 'Arquivo grande demais.');

    let parsed: ProgressFile;
    try {
      parsed = fileSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
    } catch (err) {
      throw new AppError('VALIDATION', 'Este arquivo não é um progresso exportado pelo RetroVault (ou está corrompido).', {
        cause: err,
      });
    }

    const library = this.games.list();
    const result: ProgressImportResult = { gamesMatched: 0, trophiesRestored: 0, playtimeUpdated: 0, gamesNotFound: [] };
    const used = new Set<number>();
    // Índice montado uma vez: getSet carrega a lista inteira de troféus.
    const npIndex = new Map<string, number>();
    for (const g of library) {
      const np = this.trophies.getSet(g.id)?.npCommId;
      if (np && !npIndex.has(np)) npIndex.set(np, g.id);
    }

    for (const entry of parsed.games) {
      const game = this.match(entry, library, used, npIndex);
      if (!game) {
        result.gamesNotFound.push(entry.title);
        continue;
      }
      used.add(game.id);
      result.gamesMatched++;
      if (this.games.mergePlaytime(game.id, entry.playtimeSeconds, entry.lastPlayedAt)) result.playtimeUpdated++;
      result.trophiesRestored += this.restoreTrophies(game.id, entry);
    }
    return result;
  }

  /** Desbloqueia com a data original só os troféus que existem na lista local e ainda estão bloqueados. */
  private restoreTrophies(gameId: number, entry: ExportedGame): number {
    const set = this.trophies.getSet(gameId);
    if (!set || !entry.trophies) return 0;
    const known = new Set(set.trophies.map((t) => t.id));
    let restored = 0;
    for (const t of entry.trophies.unlocked) {
      if (!known.has(t.id)) continue;
      restored += this.trophies.unlock(gameId, [t.id], t.source ?? 'manual', t.unlockedAt).length;
    }
    return restored;
  }

  /**
   * Mesmo jogo, mesmo depois de mudar de pasta ou de reinstalar:
   * 1) NPCommID da lista de troféus  2) caminho  3) título (só se for único na biblioteca).
   */
  private match(entry: ExportedGame, library: Game[], used: Set<number>, npIndex: Map<string, number>): Game | null {
    const free = library.filter((g) => !used.has(g.id));
    const npGameId = entry.trophies?.npCommId ? npIndex.get(entry.trophies.npCommId) : undefined;
    const byNp = npGameId !== undefined ? free.find((g) => g.id === npGameId) : undefined;
    if (byNp) return byNp;
    const norm = (p: string) => path.resolve(p).toLowerCase();
    const byPath = free.find((g) => norm(g.path) === norm(entry.path));
    if (byPath) return byPath;
    const title = entry.title.trim().toLowerCase();
    const byTitle = free.filter((g) => g.title.trim().toLowerCase() === title);
    return byTitle.length === 1 ? byTitle[0]! : null;
  }
}
