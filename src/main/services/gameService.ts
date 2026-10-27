import path from 'node:path';
import { suggestCore } from '@shared/consoles';
import type {
  AddGameResult,
  ArtworkSlot,
  Game,
  GameInspection,
  GameKind,
  GameProgress,
  MatchResult,
  NewGameInput,
  UpdateGameInput,
} from '@shared/types';
import type { GamePatch, GameRepository } from '../db/repositories/gameRepository';
import { AppError } from '../errors';
import { linkRaArtwork, raCover, slotPatch, unlinkRaArtwork } from './artworkPolicy';
import { type ArtworkService, hasImageSignature, isLocalArtwork } from './artworkService';
import { assertFile, titleFromPath } from './fsUtils';
import type { RetroAchievementsClient } from './retroachievements/client';
import type { RetroArchService } from './retroarchService';
import { canAutoMatch, detectConsole, hashRom } from './romHasher';
import type { DumpArtworkService } from './trophies/dumpArtwork';

const EXECUTABLE_EXTENSIONS = new Set(['.exe', '.bat', '.cmd', '.lnk']);

function noMatch(reason: MatchResult['reason'], hash: string | null = null): MatchResult {
  return { matched: false, reason, hash, raGameId: null, raTitle: null };
}

/** Jogo "executável" no Windows: só o que o sistema abre direto. */
function assertExecutable(filePath: string): void {
  if (process.platform === 'win32' && !EXECUTABLE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    throw new AppError('VALIDATION', 'Selecione um arquivo .exe, .bat, .cmd ou atalho (.lnk).');
  }
}

export class GameService {
  constructor(
    private readonly repo: GameRepository,
    private readonly ra: RetroAchievementsClient,
    private readonly retroarch: RetroArchService,
    private readonly artwork: ArtworkService,
    private readonly dumpArt: DumpArtworkService,
  ) {}

  list(): Game[] {
    return this.repo.list();
  }

  get(id: number): Game {
    return this.found(this.repo.get(id));
  }

  async inspect(filePath: string, kind: GameKind): Promise<GameInspection> {
    await assertFile(filePath);
    const suggestedTitle = titleFromPath(filePath);
    if (kind === 'executable') {
      return { suggestedTitle, consoleId: null, suggestedCorePath: null, autoMatchSupported: false };
    }
    const consoleId = await detectConsole(filePath);
    const { cores } = await this.retroarch.status();
    return {
      suggestedTitle,
      consoleId,
      suggestedCorePath: suggestCore(consoleId, cores),
      autoMatchSupported: canAutoMatch(filePath, consoleId),
    };
  }

  async add(input: NewGameInput): Promise<AddGameResult> {
    const filePath = path.resolve(input.path);
    await assertFile(filePath);

    let consoleId: number | null = null;
    let corePath: string | null = null;
    let iconUrl: string | null = null;
    let match: MatchResult | null = null;

    if (input.kind === 'retroarch') {
      consoleId = input.consoleId ?? (await detectConsole(filePath));
      corePath = input.corePath ?? suggestCore(consoleId, (await this.retroarch.status()).cores);
      if (input.raGameId == null) match = await this.identify(filePath, consoleId);
    } else {
      assertExecutable(filePath);
      iconUrl = await this.artwork.extractExecutableIcon(filePath);
    }

    const raGameId = input.raGameId ?? match?.raGameId ?? null;
    const game = this.repo.create({
      title: input.title?.trim() || match?.raTitle || titleFromPath(filePath),
      kind: input.kind,
      path: filePath,
      corePath,
      launchArgs: input.launchArgs?.trim() || null,
      consoleId,
      raGameId,
      romHash: match?.hash ?? null,
      steamAppId: input.kind === 'executable' ? (input.steamAppId ?? null) : null,
      coverUrl: null,
      backgroundUrl: null,
      iconUrl,
    });

    return { game: raGameId ? await this.syncArtwork(game, raGameId) : game, match };
  }

  async update(input: UpdateGameInput): Promise<Game> {
    const current = this.get(input.id);
    const { id, ...patch } = input;
    const game = this.save(id, { ...patch, title: patch.title?.trim() || undefined });
    if (input.raGameId === undefined || input.raGameId === current.raGameId) return game;
    return input.raGameId ? this.syncArtwork(game, input.raGameId) : this.save(id, unlinkRaArtwork(current));
  }

  async rematch(id: number): Promise<AddGameResult> {
    const game = this.get(id);
    if (game.kind !== 'retroarch') {
      throw new AppError('VALIDATION', 'A identificação automática funciona apenas para ROMs do RetroArch.');
    }
    const match = await this.identify(game.path, game.consoleId);
    let updated = this.save(id, { romHash: match.hash });
    if (match.raGameId) {
      updated = await this.update({ id, raGameId: match.raGameId });
    }
    return { game: updated, match };
  }

  remove(id: number): void {
    this.get(id);
    this.repo.remove(id);
  }

  /** Aponta o jogo para outro arquivo do mesmo tipo (jogo movido de pasta). */
  async relocate(id: number, newPath: string): Promise<Game> {
    const game = this.get(id);
    const filePath = path.resolve(newPath);
    await assertFile(filePath);
    if (game.kind === 'executable') assertExecutable(filePath);
    const other = this.repo.list().find((g) => g.id !== id && g.path.toLowerCase() === filePath.toLowerCase());
    if (other) throw new AppError('DUPLICATE', `Este arquivo já pertence a "${other.title}" na biblioteca.`);
    return this.found(this.repo.updatePath(id, filePath));
  }

  // ---------- Arte (capa, fundo, ícone) ----------

  async setArtworkFromFile(id: number, slot: ArtworkSlot, sourcePath: string): Promise<Game> {
    this.get(id);
    return this.save(id, slotPatch(slot, await this.artwork.importImage(sourcePath)));
  }

  /** Arte já guardada no cofre (rv-media://), ex.: escolhida na busca online. */
  setArtworkUrl(id: number, slot: ArtworkSlot, url: string): Game {
    this.get(id);
    if (!isLocalArtwork(url)) throw new AppError('VALIDATION', 'Arte inválida.');
    return this.save(id, slotPatch(slot, url));
  }

  /**
   * Imagem montada no editor de enquadramento (PNG ou JPEG em bytes). Conferida pela assinatura e
   * guardada leve: capa e fundo como foto (JPEG reduzido), ícone mantendo a transparência.
   */
  async setArtworkFromData(id: number, slot: ArtworkSlot, data: Buffer): Promise<Game> {
    this.get(id);
    const format = (['png', 'jpg'] as const).find((f) => hasImageSignature(data, f));
    if (!format) throw new AppError('VALIDATION', 'A imagem do editor não é PNG nem JPEG.');
    const url = slot === 'icon' ? await this.artwork.saveGraphic(data, format) : await this.artwork.savePhoto(data, format, 1200);
    return this.setArtworkUrl(id, slot, url);
  }

  /** O ícone é o padrão extraído do .exe (ou não há ícone)? Arte automática só troca esse. */
  async hasDefaultIcon(game: Game): Promise<boolean> {
    if (!game.iconUrl) return true;
    return game.kind === 'executable' && game.iconUrl === (await this.artwork.extractExecutableIcon(game.path));
  }

  /** Volta ao padrão: arte do dump de PS4, do RetroAchievements ou o ícone extraído do executável. */
  async resetArtwork(id: number, slot: ArtworkSlot): Promise<Game> {
    const game = this.get(id);
    switch (slot) {
      case 'background': {
        const dump = await this.dumpArt.find(game);
        return this.save(id, { backgroundUrl: await this.importOrNull(dump?.backgroundPath) });
      }
      case 'cover': {
        return this.save(id, { coverUrl: raCover(await this.progressOrNull(game.raGameId)) });
      }
      case 'icon': {
        const iconUrl =
          game.kind === 'executable'
            ? ((await this.importOrNull((await this.dumpArt.find(game))?.iconPath)) ??
              (await this.artwork.extractExecutableIcon(game.path)))
            : ((await this.progressOrNull(game.raGameId))?.iconUrl ?? null);
        return this.save(id, { iconUrl });
      }
    }
  }

  /**
   * Arte oficial do dump de PS4 (icon0.png / pic1.png) sem sobrescrever escolhas do usuário:
   * o fundo só é preenchido se estiver vazio; o ícone só substitui o extraído do .exe.
   * Como a arte é endereçada pelo hash do conteúdo, "é o ícone do .exe" é uma comparação de URL.
   * @returns o jogo atualizado, ou null se nada mudou.
   */
  async applyDumpArtwork(id: number): Promise<Game | null> {
    const game = this.get(id);
    if (game.kind !== 'executable') return null;
    const dump = await this.dumpArt.find(game);
    if (!dump) return null;

    const patch: GamePatch = {};
    if (!game.backgroundUrl && dump.backgroundPath) {
      patch.backgroundUrl = (await this.importOrNull(dump.backgroundPath)) ?? undefined;
    }
    if (dump.iconPath && (await this.hasDefaultIcon(game))) {
      const iconUrl = await this.importOrNull(dump.iconPath);
      if (iconUrl && iconUrl !== game.iconUrl) patch.iconUrl = iconUrl;
    }
    return Object.values(patch).some((v) => v !== undefined) ? this.save(id, patch) : null;
  }

  /** Importa uma imagem do dump; falhas (arquivo corrompido, removido) viram null. */
  private async importOrNull(file: string | null | undefined): Promise<string | null> {
    if (!file) return null;
    try {
      return await this.artwork.importImage(file);
    } catch (err) {
      console.warn('[artwork] imagem do dump ignorada', file, err);
      return null;
    }
  }

  /** Aplica a arte de dump a todos os executáveis da biblioteca; devolve os jogos alterados. */
  async applyDumpArtworkToLibrary(): Promise<Game[]> {
    const changed: Game[] = [];
    for (const game of this.repo.list()) {
      if (game.kind !== 'executable') continue;
      try {
        const updated = await this.applyDumpArtwork(game.id);
        if (updated) changed.push(updated);
      } catch (err) {
        console.warn(`[artwork] arte do dump falhou para ${game.title}`, err);
      }
    }
    return changed;
  }

  /**
   * Substitui ícones antigos (data URL 32×32) pelo ícone em alta resolução do executável. Só esses: jogo
   * sem ícone (o .exe não tem, ou sumiu) não é tentado de novo a cada abertura. Até 4 extrações por vez.
   */
  async upgradeLegacyIcons(): Promise<number> {
    const legacy = this.repo.list().filter((g) => g.kind === 'executable' && g.iconUrl?.startsWith('data:'));
    let upgraded = 0;
    let next = 0;
    const worker = async () => {
      while (next < legacy.length) {
        const game = legacy[next++]!;
        const iconUrl = await this.artwork.extractExecutableIcon(game.path);
        if (iconUrl) {
          this.repo.update(game.id, { iconUrl });
          upgraded++;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, legacy.length) }, worker));
    return upgraded;
  }

  /**
   * Arte vinda de fora (ex.: a Loja) só onde o jogo ainda não tem nenhuma: a capa e o fundo
   * escolhidos pelo usuário nunca são trocados. Retorna o jogo se algo mudou.
   */
  applyArtworkIfMissing(id: number, art: { cover?: string | null; background?: string | null }): Game | null {
    const game = this.get(id);
    const patch: GamePatch = {};
    if (!game.coverUrl && art.cover) patch.coverUrl = art.cover;
    if (!game.backgroundUrl && art.background) patch.backgroundUrl = art.background;
    return Object.keys(patch).length ? this.save(id, patch) : null;
  }

  /**
   * Jogo da Steam: capa e fundo do cache local dela (só onde ainda não há arte) e o tempo de jogo que
   * ela registrou (fica o maior, como na importação de progresso). Retorna o jogo se algo mudou.
   */
  async applySteamData(
    id: number,
    data: { coverPath: string | null; backgroundPath: string | null; playtime: { seconds: number; lastPlayedAt: string | null } | null },
  ): Promise<Game | null> {
    const game = this.get(id);
    const art = this.applyArtworkIfMissing(id, {
      cover: game.coverUrl ? null : await this.importOrNull(data.coverPath),
      background: game.backgroundUrl ? null : await this.importOrNull(data.backgroundPath),
    });
    const played = data.playtime ? this.repo.mergePlaytime(id, data.playtime.seconds, data.playtime.lastPlayedAt) : false;
    return art || played ? this.get(id) : null;
  }

  referencedArtwork(): (string | null)[] {
    return this.repo.list().flatMap((g) => [g.coverUrl, g.backgroundUrl, g.iconUrl]);
  }

  private async progressOrNull(raGameId: number | null): Promise<GameProgress | null> {
    if (!raGameId) return null;
    try {
      return await this.ra.getGameProgress(raGameId);
    } catch (err) {
      console.warn('[games] não foi possível obter arte do RetroAchievements', err);
      return null;
    }
  }

  private async identify(filePath: string, consoleId: number | null): Promise<MatchResult> {
    if (consoleId == null) return noMatch('no-console');
    if (!canAutoMatch(filePath, consoleId)) return noMatch('unsupported-format');

    let hash: string | null;
    try {
      hash = await hashRom(filePath, consoleId);
    } catch (err) {
      console.error('[games] falha ao calcular hash', err);
      return noMatch('error');
    }
    if (!hash) return noMatch('unsupported-format');
    if (!this.ra.hasCredentials()) return noMatch('no-credentials', hash);

    try {
      const entry = await this.ra.findGameByHash(consoleId, hash);
      return entry
        ? { matched: true, reason: 'matched', hash, raGameId: entry.id, raTitle: entry.title }
        : noMatch('not-found', hash);
    } catch (err) {
      console.error('[games] falha ao consultar RetroAchievements', err);
      return noMatch('error', hash);
    }
  }

  /**
   * Busca capa/ícone oficiais no RetroAchievements sem sobrescrever arte personalizada
   * nem o ícone extraído de executáveis. Falhas não impedem o vínculo.
   */
  private async syncArtwork(game: Game, raGameId: number): Promise<Game> {
    const progress = await this.progressOrNull(raGameId);
    return progress ? this.save(game.id, linkRaArtwork(game, progress)) : this.get(game.id);
  }

  /** Grava e devolve o jogo; se ele sumiu no meio do caminho (removido em outra janela), NOT_FOUND. */
  private save(id: number, patch: GamePatch): Game {
    return this.found(this.repo.update(id, patch));
  }

  private found(game: Game | null): Game {
    if (!game) throw new AppError('NOT_FOUND', 'Jogo não encontrado na biblioteca.');
    return game;
  }
}
