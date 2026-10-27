import type { Game } from '@shared/types';
import { findSteamApp, steamArtwork, steamPlaytime } from './steamLibrary';

interface SteamGameDataDeps {
  games: {
    get(id: number): Game;
    applySteamData(
      id: number,
      data: { coverPath: string | null; backgroundPath: string | null; playtime: { seconds: number; lastPlayedAt: string | null } | null },
    ): Promise<Game | null>;
  };
  steamRoot(): Promise<string | null>;
}

/** Jogo da Steam: capa, fundo e tempo de jogo que ela já tem no PC (antes do SteamGridDB completar). */
export async function applySteamGameData({ games, steamRoot }: SteamGameDataDeps, gameId: number): Promise<Game | null> {
  const game = games.get(gameId);
  if (!game.steamAppId) return null;
  const root = await steamRoot();
  if (!root) return null;
  const [art, app] = await Promise.all([steamArtwork(root, game.steamAppId), findSteamApp(root, game.steamAppId)]);
  return games.applySteamData(gameId, {
    coverPath: art.cover,
    backgroundPath: art.background,
    playtime: app ? await steamPlaytime(root, app) : null,
  });
}
