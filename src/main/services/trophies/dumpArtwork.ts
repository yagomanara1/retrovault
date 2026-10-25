import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Game } from '@shared/types';
import type { TrpLocator } from './trpLocator';

// Arte oficial que todo dump de PS4 traz em sce_sys/:
//   icon0.png  512×512   ícone do jogo no menu do PS4
//   pic1.png   1920×1080 fundo do jogo no menu do PS4
// O dump é encontrado pelo mesmo TrpLocator dos troféus (pasta do jogo, argumentos, launcher do port).
// Devolve só caminhos: quem aplica importa a imagem, então nada é gravado sem ser usado
// (senão a limpeza de arte apagaria e a próxima inicialização regravaria ~3 MB por jogo).

export interface DumpArtwork {
  iconPath: string | null;
  backgroundPath: string | null;
}

const isFile = (p: string) =>
  fs
    .stat(p)
    .then((s) => s.isFile())
    .catch(() => false);

export class DumpArtworkService {
  /** Por jogo: localizar o dump varre pastas e configs de launchers, não precisa se repetir. */
  private readonly cache = new Map<string, Promise<DumpArtwork | null>>();

  constructor(private readonly locator: TrpLocator) {}

  /** null = o jogo não tem dump de PS4 associado (ou o dump não tem arte). */
  find(game: Pick<Game, 'kind' | 'path' | 'launchArgs'>): Promise<DumpArtwork | null> {
    if (game.kind !== 'executable') return Promise.resolve(null);
    const key = `${game.path.toLowerCase()}|${game.launchArgs ?? ''}`;
    let pending = this.cache.get(key);
    if (!pending) {
      pending = this.load(game).catch((err) => {
        console.warn('[dump-artwork] falha ao localizar arte do dump', err);
        return null;
      });
      this.cache.set(key, pending);
      // Sem resultado: tenta de novo na próxima vez (o dump pode aparecer depois).
      void pending.then((result) => {
        if (!result) this.cache.delete(key);
      });
    }
    return pending;
  }

  private async load(game: Pick<Game, 'path' | 'launchArgs'>): Promise<DumpArtwork | null> {
    const location = await this.locator.locate(game);
    if (!location) return null;
    const sceSys = path.join(location.dumpDir, 'sce_sys');
    const icon = path.join(sceSys, 'icon0.png');
    const background = path.join(sceSys, 'pic1.png');
    const [hasIcon, hasBackground] = await Promise.all([isFile(icon), isFile(background)]);
    if (!hasIcon && !hasBackground) return null;
    return { iconPath: hasIcon ? icon : null, backgroundPath: hasBackground ? background : null };
  }
}
