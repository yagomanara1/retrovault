import { type Dirent, promises as fs } from 'node:fs';
import path from 'node:path';
import type { Game } from '@shared/types';
import { pathExists } from '../fsUtils';

// Descobre onde um jogo guarda o save. Só devolve caminhos que existem.
//  - Ports de PS4 (gow3_pc, bloodborne_pc…): <pasta do exe>\user\savedata
//  - Pasta do jogo: arquivos "save*.bin", "*.sav"… e pastas "saves", "SaveGames"…  (Pokémon: save.bin)
//  - Pastas padrão do Windows: Documentos\My Games\<jogo>, Saved Games\<jogo>, Unreal (LocalAppData\<jogo>\Saved\SaveGames)
//  - ROMs: .srm e .state* com o mesmo nome da ROM nas pastas do RetroArch (ou ao lado da ROM)

// Sem "game*.bin": em pastas de jogos é quase sempre dado, não save.
const SAVE_FILE = /^(save|savegame|savedata)[\w-]*\.(bin|sav|dat|json)$|\.(sav|srm)$/i;
const SAVE_DIR = /^(save|saves|savegame|savegames|savedata|saved ?games|savefiles)$/i;
const MAX_ROOT_ENTRIES = 2000;

export interface RetroArchSaveDirs {
  exeDir: string;
  dirs: string[];
  inContentDir: boolean;
}

export interface KnownFolders {
  documents: string;
  savedGames: string;
  localAppData: string;
}

async function readDirSafe(dir: string): Promise<Dirent[]> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).slice(0, MAX_ROOT_ENTRIES);
  } catch {
    return [];
  }
}

const stem = (file: string) => path.basename(file, path.extname(file));

/** "God of War III.exe" + título → nomes candidatos de pastas de save do Windows. */
function gameNames(game: Pick<Game, 'title' | 'path'>): string[] {
  return [...new Set([game.title.trim(), stem(game.path)].filter((n) => n.length >= 2))];
}

export class SaveLocator {
  constructor(
    private readonly folders: KnownFolders,
    private readonly retroarch: () => Promise<RetroArchSaveDirs | null>,
  ) {}

  async detect(game: Pick<Game, 'kind' | 'path' | 'title'>): Promise<string[]> {
    const found = game.kind === 'retroarch' ? await this.romSaves(game.path) : await this.pcSaves(game);
    return [...new Set(found.map((p) => path.resolve(p)))];
  }

  private async pcSaves(game: Pick<Game, 'path' | 'title'>): Promise<string[]> {
    const exeDir = path.dirname(game.path);
    const found: string[] = [];

    const ps4 = path.join(exeDir, 'user', 'savedata');
    if (await pathExists(ps4)) found.push(ps4);

    for (const entry of await readDirSafe(exeDir)) {
      if (entry.isFile() && SAVE_FILE.test(entry.name)) found.push(path.join(exeDir, entry.name));
      if (entry.isDirectory() && SAVE_DIR.test(entry.name)) found.push(path.join(exeDir, entry.name));
    }

    for (const name of gameNames(game)) {
      for (const dir of [
        path.join(this.folders.documents, 'My Games', name),
        path.join(this.folders.savedGames, name),
        path.join(this.folders.localAppData, name, 'Saved', 'SaveGames'),
      ]) {
        if (await pathExists(dir)) found.push(dir);
      }
    }
    return found;
  }

  private async romSaves(romPath: string): Promise<string[]> {
    const romStem = stem(romPath).toLowerCase();
    const ra = await this.retroarch();
    const dirs = [...(ra?.dirs ?? [])];
    if (!ra || ra.inContentDir) dirs.push(path.dirname(romPath));

    const found: string[] = [];
    const matches = (name: string) => {
      const lower = name.toLowerCase();
      // "Jogo.srm", "Jogo.state", "Jogo.state1", "Jogo.state.auto" (a ROM em si não conta).
      return (lower.startsWith(`${romStem}.`) && /\.(srm|sav|rtc|state\d*|state\.auto|ss\d)$/.test(lower));
    };
    for (const dir of dirs) {
      for (const entry of await readDirSafe(dir)) {
        if (entry.isFile() && matches(entry.name)) found.push(path.join(dir, entry.name));
        // Com "organizar por core", o RetroArch usa uma subpasta por core.
        if (entry.isDirectory()) {
          for (const inner of await readDirSafe(path.join(dir, entry.name))) {
            if (inner.isFile() && matches(inner.name)) found.push(path.join(dir, entry.name, inner.name));
          }
        }
      }
    }
    return found;
  }
}
