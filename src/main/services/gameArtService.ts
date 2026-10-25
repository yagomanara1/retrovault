import type { ArtCandidate, ArtFillResult, ArtSearchResult, ArtworkSlot, Game } from '@shared/types';
import { AppError } from '../errors';
import type { GameService } from './gameService';
import { isAllowedArtUrl } from './store/catalogSchema';
import { normalizeTitle, type SgdbImage, type SgdbKind, type SteamGridDbClient } from './store/steamGridDb';

/** Arte do jogo → tipo no SteamGridDB (o "fundo" é o hero, o banner largo). */
const KIND: Record<ArtworkSlot, SgdbKind> = { cover: 'cover', background: 'hero', icon: 'icon' };
/** Quantas opções mostrar de cada tipo (as miniaturas são baixadas pelo main). */
const OPTIONS = 10;
const MAX_MATCHES = 8;

export interface GameArtDeps {
  games: Pick<GameService, 'get' | 'list' | 'setArtworkUrl' | 'hasDefaultIcon'>;
  sgdb: Pick<SteamGridDbClient, 'search' | 'bestMatch' | 'images' | 'firstOfEach'>;
  /** Baixa uma imagem de host permitido para o cofre (rv-media://). */
  importRemote(url: string, opts: { photo: boolean; remember: false }): Promise<string>;
  /** Chave do SteamGridDB (decifrada no main); null = não conectada. */
  sgdbKey(): string | null;
}

/**
 * Arte dos jogos da biblioteca vinda do SteamGridDB: busca com várias opções para escolher,
 * aplicação da escolhida e preenchimento automático dos jogos de PC sem capa.
 * As imagens são baixadas pelo main para o cofre: a tela nunca carrega imagem da internet.
 * Nada aqui fica registrado em store_art: o que não for usado sai na limpeza de artes da inicialização.
 */
export class GameArtService {
  constructor(private readonly deps: GameArtDeps) {}

  private key(): string {
    const key = this.deps.sgdbKey();
    if (!key) {
      throw new AppError('VALIDATION', 'Conecte a sua chave gratuita do SteamGridDB em Configurações → Loja para buscar artes online.');
    }
    return key;
  }

  async search(gameId: number, query?: string, sgdbGameId?: number): Promise<ArtSearchResult> {
    const key = this.key();
    const game = this.deps.games.get(gameId);
    const title = query?.trim() || game.title;
    const games = (await this.deps.sgdb.search(title, key)).slice(0, MAX_MATCHES).map((g) => ({ id: g.id, name: g.name }));
    const wanted = normalizeTitle(title);
    const selected =
      sgdbGameId && games.some((g) => g.id === sgdbGameId)
        ? sgdbGameId
        : (games.find((g) => normalizeTitle(g.name) === wanted) ?? games[0])?.id ?? null;
    const empty: ArtSearchResult = { query: title, games, selectedGameId: selected, cover: [], background: [], icon: [] };
    if (!selected) return empty;
    const [cover, background, icon] = await Promise.all(
      (['cover', 'background', 'icon'] as const).map((slot) =>
        this.deps.sgdb
          .images(selected, KIND[slot], key, OPTIONS)
          .then((list) => this.withThumbs(list, slot !== 'icon'))
          .catch(() => [] as ArtCandidate[]),
      ),
    );
    return { ...empty, cover, background, icon };
  }

  /** Aplica uma imagem escolhida na busca (só do SteamGridDB). */
  async apply(gameId: number, slot: ArtworkSlot, url: string): Promise<Game> {
    if (!isSgdbImage(url)) throw new AppError('FORBIDDEN', 'Imagem fora dos endereços permitidos.');
    const local = await this.deps.importRemote(url, { photo: slot !== 'icon', remember: false });
    return this.deps.games.setArtworkUrl(gameId, slot, local);
  }

  /**
   * Preenche sozinho a arte de um jogo de PC: capa e fundo onde estiverem vazios, e o ícone se for
   * o padrão do .exe. O que o usuário escolheu nunca é trocado. ROMs ficam com a arte do RetroAchievements.
   * @returns o jogo atualizado, ou null se nada mudou (sem chave, sem resultado ou nada a preencher).
   */
  async autoFill(gameId: number): Promise<Game | null> {
    const key = this.deps.sgdbKey();
    if (!key) return null;
    let game = this.deps.games.get(gameId);
    if (game.kind !== 'executable') return null;
    const wantsIcon = await this.deps.games.hasDefaultIcon(game);
    if (game.coverUrl && game.backgroundUrl && !wantsIcon) return null;
    const match = await this.deps.sgdb.bestMatch(game.title, key);
    if (!match) return null;
    const urls = await this.deps.sgdb.firstOfEach(match.id, key);
    const plan: [ArtworkSlot, string | undefined][] = [
      ['cover', game.coverUrl ? undefined : urls.cover],
      ['background', game.backgroundUrl ? undefined : urls.hero],
      ['icon', wantsIcon ? urls.icon : undefined],
    ];
    let changed = false;
    for (const [slot, url] of plan) {
      if (!url) continue;
      try {
        game = await this.apply(gameId, slot, url);
        changed = true;
      } catch (err) {
        console.warn('[art] arte automática falhou', game.title, slot, err);
      }
    }
    return changed ? game : null;
  }

  /** "Buscar artes que faltam": os jogos de PC sem capa, um de cada vez (respeita o limite da API). */
  async fillMissing(): Promise<ArtFillResult> {
    this.key();
    const result: ArtFillResult = { updated: 0, notFound: [] };
    for (const game of this.deps.games.list()) {
      if (game.kind !== 'executable' || game.coverUrl) continue;
      const updated = await this.autoFill(game.id).catch(() => null);
      if (updated) result.updated++;
      else result.notFound.push(game.title);
    }
    return result;
  }

  /** Baixa as miniaturas para o cofre (em paralelo); as que falharem saem da lista. */
  private async withThumbs(list: SgdbImage[], photo: boolean): Promise<ArtCandidate[]> {
    const thumbs = await Promise.all(list.map((i) => this.deps.importRemote(i.thumb, { photo, remember: false }).catch(() => null)));
    return list.flatMap((i, n) => (thumbs[n] ? [{ url: i.url, thumb: thumbs[n]!, width: i.width, height: i.height }] : []));
  }
}

/** Só imagens do CDN do SteamGridDB podem ser aplicadas por aqui. */
function isSgdbImage(url: string): boolean {
  return isAllowedArtUrl(url) && new URL(url).hostname === 'cdn2.steamgriddb.com';
}
