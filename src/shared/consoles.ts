// Catálogo de consoles do RetroAchievements suportados pelo launcher.
// IDs = ConsoleID oficial do RetroAchievements.

import type { CoreInfo } from './types';

/**
 * Como o RetroAchievements identifica o jogo (o mesmo hash do rcheevos, usado pelo RetroArch):
 * file      → MD5 do conteúdo, com a normalização do console (também dentro de um .zip)
 * filename  → MD5 do nome do arquivo sem extensão (Arcade)
 * nds       → cabeçalho + código ARM9/ARM7 + ícone (Nintendo DS)
 * ps1 / ps2 → executável apontado pelo SYSTEM.CNF do disco
 * psp       → PARAM.SFO + EBOOT.BIN do disco
 * sega-disc → cabeçalho do setor 0 (Sega CD e Saturn)
 * none      → ainda não suportado (ex.: Dreamcast); vinculação manual
 */
export type HashMethod = 'file' | 'filename' | 'nds' | 'ps1' | 'ps2' | 'psp' | 'sega-disc' | 'none';

/** Imagens de disco que o launcher lê para identificar o jogo (CHD e PBP, compactados, não). */
export const DISC_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['iso', 'bin', 'img', 'cue', 'cso', 'm3u']);
const DISC_METHODS: ReadonlySet<HashMethod> = new Set(['ps1', 'ps2', 'psp', 'sega-disc']);
/** Compactados que o launcher não abre para identificar (o .zip abre). */
const UNREADABLE_ARCHIVES: ReadonlySet<string> = new Set(['7z', 'rar']);

export interface ConsoleDef {
  id: number;
  name: string;
  extensions: readonly string[];
  hashMethod: HashMethod;
  /** Cores preferidos em ordem (nome do arquivo sem `_libretro.dll`). */
  cores: readonly string[];
}

export const ConsoleId = {
  Genesis: 1,
  N64: 2,
  SNES: 3,
  GameBoy: 4,
  GBA: 5,
  GBC: 6,
  NES: 7,
  PCEngine: 8,
  SegaCD: 9,
  Sega32X: 10,
  MasterSystem: 11,
  PlayStation: 12,
  Lynx: 13,
  NeoGeoPocket: 14,
  GameGear: 15,
  GameCube: 16,
  NDS: 18,
  Wii: 19,
  PS2: 21,
  PokemonMini: 24,
  Atari2600: 25,
  Arcade: 27,
  VirtualBoy: 28,
  MSX: 29,
  SG1000: 33,
  Saturn: 39,
  Dreamcast: 40,
  PSP: 41,
  ColecoVision: 44,
  Vectrex: 46,
  Atari7800: 51,
  WonderSwan: 53,
  PCEngineCD: 76,
} as const;

const GB_CORES = ['gambatte', 'sameboy', 'gearboy', 'mgba'] as const;
const SEGA_8BIT_CORES = ['genesis_plus_gx', 'picodrive', 'gearsystem'] as const;

export const CONSOLES: readonly ConsoleDef[] = [
  { id: ConsoleId.NES, name: 'NES / Famicom', extensions: ['nes', 'fds', 'unf', 'unif'], hashMethod: 'file', cores: ['mesen', 'fceumm', 'nestopia'] },
  { id: ConsoleId.SNES, name: 'SNES / Super Famicom', extensions: ['sfc', 'smc', 'swc', 'fig'], hashMethod: 'file', cores: ['snes9x', 'bsnes', 'bsnes_hd_beta'] },
  { id: ConsoleId.GameBoy, name: 'Game Boy', extensions: ['gb'], hashMethod: 'file', cores: GB_CORES },
  { id: ConsoleId.GBC, name: 'Game Boy Color', extensions: ['gbc'], hashMethod: 'file', cores: GB_CORES },
  { id: ConsoleId.GBA, name: 'Game Boy Advance', extensions: ['gba'], hashMethod: 'file', cores: ['mgba', 'vba_next', 'gpsp'] },
  { id: ConsoleId.N64, name: 'Nintendo 64', extensions: ['n64', 'z64', 'v64'], hashMethod: 'file', cores: ['mupen64plus_next', 'parallel_n64'] },
  { id: ConsoleId.NDS, name: 'Nintendo DS', extensions: ['nds'], hashMethod: 'nds', cores: ['melondsds', 'melonds', 'desmume'] },
  // GameCube e Wii: .rvz/.ciso/.iso servem aos dois (o .iso é reconhecido pela assinatura do disco).
  { id: ConsoleId.GameCube, name: 'GameCube', extensions: ['gcm', 'gcz'], hashMethod: 'none', cores: ['dolphin'] },
  { id: ConsoleId.Wii, name: 'Wii', extensions: ['wbfs', 'wad'], hashMethod: 'none', cores: ['dolphin'] },
  { id: ConsoleId.VirtualBoy, name: 'Virtual Boy', extensions: ['vb', 'vboy'], hashMethod: 'file', cores: ['mednafen_vb'] },
  { id: ConsoleId.PokemonMini, name: 'Pokémon Mini', extensions: ['min'], hashMethod: 'file', cores: ['pokemini'] },
  { id: ConsoleId.Genesis, name: 'Mega Drive / Genesis', extensions: ['md', 'gen'], hashMethod: 'file', cores: ['genesis_plus_gx', 'picodrive', 'blastem'] },
  { id: ConsoleId.MasterSystem, name: 'Master System', extensions: ['sms'], hashMethod: 'file', cores: SEGA_8BIT_CORES },
  { id: ConsoleId.GameGear, name: 'Game Gear', extensions: ['gg'], hashMethod: 'file', cores: SEGA_8BIT_CORES },
  { id: ConsoleId.SG1000, name: 'SG-1000', extensions: ['sg'], hashMethod: 'file', cores: SEGA_8BIT_CORES },
  { id: ConsoleId.Sega32X, name: 'Sega 32X', extensions: ['32x'], hashMethod: 'file', cores: ['picodrive'] },
  { id: ConsoleId.SegaCD, name: 'Sega CD', extensions: [], hashMethod: 'sega-disc', cores: ['genesis_plus_gx', 'picodrive'] },
  { id: ConsoleId.Saturn, name: 'Sega Saturn', extensions: [], hashMethod: 'sega-disc', cores: ['mednafen_saturn', 'yabasanshiro', 'kronos'] },
  { id: ConsoleId.Dreamcast, name: 'Dreamcast', extensions: ['cdi', 'gdi'], hashMethod: 'none', cores: ['flycast'] },
  { id: ConsoleId.PCEngine, name: 'PC Engine / TurboGrafx-16', extensions: ['pce', 'sgx'], hashMethod: 'file', cores: ['mednafen_pce_fast', 'mednafen_pce', 'mednafen_supergrafx'] },
  { id: ConsoleId.PCEngineCD, name: 'PC Engine CD', extensions: [], hashMethod: 'none', cores: ['mednafen_pce_fast', 'mednafen_pce'] },
  { id: ConsoleId.PlayStation, name: 'PlayStation', extensions: ['pbp'], hashMethod: 'ps1', cores: ['swanstation', 'mednafen_psx_hw', 'pcsx_rearmed'] },
  { id: ConsoleId.PS2, name: 'PlayStation 2', extensions: [], hashMethod: 'ps2', cores: ['pcsx2', 'play'] },
  { id: ConsoleId.PSP, name: 'PlayStation Portable', extensions: ['cso'], hashMethod: 'psp', cores: ['ppsspp'] },
  { id: ConsoleId.Atari2600, name: 'Atari 2600', extensions: ['a26'], hashMethod: 'file', cores: ['stella', 'stella2014'] },
  { id: ConsoleId.Atari7800, name: 'Atari 7800', extensions: ['a78'], hashMethod: 'file', cores: ['prosystem'] },
  { id: ConsoleId.Lynx, name: 'Atari Lynx', extensions: ['lnx'], hashMethod: 'file', cores: ['handy', 'mednafen_lynx'] },
  { id: ConsoleId.NeoGeoPocket, name: 'Neo Geo Pocket (Color)', extensions: ['ngp', 'ngc'], hashMethod: 'file', cores: ['mednafen_ngp', 'race'] },
  { id: ConsoleId.WonderSwan, name: 'WonderSwan (Color)', extensions: ['ws', 'wsc'], hashMethod: 'file', cores: ['mednafen_wswan'] },
  { id: ConsoleId.ColecoVision, name: 'ColecoVision', extensions: ['col'], hashMethod: 'file', cores: ['gearcoleco', 'bluemsx'] },
  { id: ConsoleId.Vectrex, name: 'Vectrex', extensions: ['vec'], hashMethod: 'file', cores: ['vecx'] },
  { id: ConsoleId.MSX, name: 'MSX', extensions: ['mx1', 'mx2'], hashMethod: 'file', cores: ['bluemsx', 'fmsx'] },
  { id: ConsoleId.Arcade, name: 'Arcade', extensions: [], hashMethod: 'filename', cores: ['fbneo', 'mame2003_plus', 'mame'] },
];

/** Extensões comuns que não identificam um console sozinhas. */
const GENERIC_ROM_EXTENSIONS = ['zip', '7z', 'bin', 'rom', 'cue', 'chd', 'iso', 'm3u', 'ccd', 'img', 'rvz', 'ciso'];

export const ROM_EXTENSIONS: readonly string[] = [
  ...new Set([...CONSOLES.flatMap((c) => c.extensions), ...GENERIC_ROM_EXTENSIONS]),
];

const BY_ID = new Map(CONSOLES.map((c) => [c.id, c]));

export function getConsole(id: number | null | undefined): ConsoleDef | undefined {
  return id == null ? undefined : BY_ID.get(id);
}

/**
 * Dá para identificar automaticamente este arquivo neste console? Só pela extensão; é a mesma regra no
 * main (antes de calcular o hash) e na tela de adicionar jogo (para avisar antes).
 */
export function canIdentifyFormat(consoleId: number | null | undefined, extension: string): boolean {
  const def = getConsole(consoleId);
  if (!def) return false;
  const ext = extension.replace(/^\./, '').toLowerCase();
  if (def.hashMethod === 'filename') return true;
  if (def.hashMethod === 'file') return !UNREADABLE_ARCHIVES.has(ext); // .bin de Mega Drive é ROM de cartucho
  if (def.hashMethod === 'nds') return ext === 'nds' || ext === 'zip';
  // CSO e PBP só no PSP (o PBP de PS1 é outro formato, ainda não lido).
  if (def.hashMethod === 'psp') return DISC_IMAGE_EXTENSIONS.has(ext) || ext === 'pbp';
  if (DISC_METHODS.has(def.hashMethod)) return DISC_IMAGE_EXTENSIONS.has(ext) && ext !== 'cso';
  return false;
}

export function consoleName(id: number | null | undefined): string {
  if (id == null) return 'Desconhecido';
  return getConsole(id)?.name ?? `Console #${id}`;
}

export const CONSOLES_BY_NAME: readonly ConsoleDef[] = [...CONSOLES].sort((a, b) =>
  a.name.localeCompare(b.name, 'pt-BR'),
);

export function suggestCore(
  consoleId: number | null | undefined,
  cores: readonly CoreInfo[],
): string | null {
  const def = getConsole(consoleId);
  if (!def) return null;
  for (const preferred of def.cores) {
    const hit = cores.find((c) => c.name === preferred);
    if (hit) return hit.path;
  }
  return null;
}
