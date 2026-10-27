// Regras de quem pode trocar a arte de um jogo. A escolha do usuário (arte guardada no cofre, rv-media://)
// nunca é sobrescrita pela arte automática do RetroAchievements; o ícone extraído do executável também fica.
import type { ArtworkSlot, Game, GameProgress } from '@shared/types';
import type { GamePatch } from '../db/repositories/gameRepository';
import { isLocalArtwork } from './artworkService';

const SLOT_FIELD = { cover: 'coverUrl', background: 'backgroundUrl', icon: 'iconUrl' } as const;

/** Patch que troca só um lugar da arte. */
export function slotPatch(slot: ArtworkSlot, url: string | null): GamePatch {
  return { [SLOT_FIELD[slot]]: url };
}

/** Capa oficial do RA: a da caixa e, sem ela, a tela de título. */
export function raCover(progress: Pick<GameProgress, 'boxArtUrl' | 'titleImageUrl'> | null): string | null {
  return progress?.boxArtUrl ?? progress?.titleImageUrl ?? null;
}

/** Ícone que a arte automática não troca: personalizado, ou o do executável. */
function keepsIcon(game: Game): boolean {
  return isLocalArtwork(game.iconUrl) || (game.kind === 'executable' && !!game.iconUrl);
}

/** Ao vincular ao RA: capa e ícone de lá, onde o usuário não escolheu outra. */
export function linkRaArtwork(game: Game, progress: GameProgress): GamePatch {
  return {
    coverUrl: isLocalArtwork(game.coverUrl) ? undefined : raCover(progress),
    iconUrl: keepsIcon(game) ? undefined : progress.iconUrl,
  };
}

/** Ao desvincular do RA: sai só a arte que veio de lá (a personalizada e o ícone do executável ficam). */
export function unlinkRaArtwork(game: Game): GamePatch {
  return {
    coverUrl: isLocalArtwork(game.coverUrl) ? undefined : null,
    iconUrl: isLocalArtwork(game.iconUrl) || game.kind === 'executable' ? undefined : null,
  };
}
