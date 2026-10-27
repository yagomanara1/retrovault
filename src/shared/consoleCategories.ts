// Uma categoria pronta para cada console, com o seu ícone. Os nomes são os mesmos que a detecção
// de plataforma devolve (consoleName do RetroArch e PLATFORM em main/services/platform.ts), para o
// jogo novo cair direto na categoria certa; os apelidos ligam a categoria que o usuário já tinha
// ("PS4") ao console em vez de criar outra igual.
import type { CategoryIconKey } from './categoryIcons';
import { foldDiacritics } from './text';

export interface ConsoleCategory {
  key: string;
  name: string;
  icon: CategoryIconKey;
  aliases: readonly string[];
}

export const CONSOLE_CATEGORIES: readonly ConsoleCategory[] = [
  // Sony
  { key: 'ps1', name: 'PlayStation', icon: 'playstation', aliases: ['PS1', 'PSX', 'PS One', 'PlayStation 1'] },
  { key: 'ps2', name: 'PlayStation 2', icon: 'ps2', aliases: ['PS2'] },
  { key: 'ps3', name: 'PlayStation 3', icon: 'ps3', aliases: ['PS3'] },
  { key: 'ps4', name: 'PlayStation 4', icon: 'ps4', aliases: ['PS4'] },
  { key: 'psp', name: 'PlayStation Portable', icon: 'psp', aliases: ['PSP'] },
  { key: 'vita', name: 'PlayStation Vita', icon: 'vita', aliases: ['PS Vita', 'Vita'] },
  // Nintendo
  { key: 'nes', name: 'NES / Famicom', icon: 'nes', aliases: ['NES', 'Famicom', 'Nintendinho'] },
  { key: 'snes', name: 'SNES / Super Famicom', icon: 'snes', aliases: ['SNES', 'Super Nintendo', 'Super Famicom'] },
  { key: 'n64', name: 'Nintendo 64', icon: 'n64', aliases: ['N64'] },
  { key: 'gamecube', name: 'GameCube', icon: 'gamecube', aliases: ['Nintendo GameCube', 'GC', 'NGC'] },
  { key: 'wii', name: 'Wii', icon: 'wii', aliases: ['Nintendo Wii'] },
  { key: 'wiiu', name: 'Wii U', icon: 'wiiu', aliases: ['WiiU', 'Nintendo Wii U'] },
  { key: 'switch', name: 'Nintendo Switch', icon: 'switch', aliases: ['Switch'] },
  { key: 'gb', name: 'Game Boy', icon: 'gameboy', aliases: ['GB'] },
  { key: 'gbc', name: 'Game Boy Color', icon: 'gbc', aliases: ['GBC'] },
  { key: 'gba', name: 'Game Boy Advance', icon: 'gba', aliases: ['GBA'] },
  { key: 'nds', name: 'Nintendo DS', icon: 'ds', aliases: ['DS', 'NDS'] },
  { key: 'n3ds', name: 'Nintendo 3DS', icon: 'n3ds', aliases: ['3DS'] },
  { key: 'virtualboy', name: 'Virtual Boy', icon: 'virtualboy', aliases: [] },
  { key: 'pokemini', name: 'Pokémon Mini', icon: 'pokemini', aliases: [] },
  // Microsoft
  { key: 'xbox', name: 'Xbox', icon: 'xbox', aliases: ['Xbox Clássico', 'Xbox Original'] },
  { key: 'xbox360', name: 'Xbox 360', icon: 'xbox360', aliases: ['X360'] },
  // Sega
  { key: 'genesis', name: 'Mega Drive / Genesis', icon: 'sega', aliases: ['Mega Drive', 'Genesis', 'Sega Genesis', 'Sega Mega Drive'] },
  { key: 'mastersystem', name: 'Master System', icon: 'mastersystem', aliases: ['Sega Master System'] },
  { key: 'gamegear', name: 'Game Gear', icon: 'gamegear', aliases: ['Sega Game Gear'] },
  { key: 'sg1000', name: 'SG-1000', icon: 'sg1000', aliases: [] },
  { key: 'sega32x', name: 'Sega 32X', icon: 'sega32x', aliases: ['32X'] },
  { key: 'segacd', name: 'Sega CD', icon: 'segacd', aliases: ['Mega CD'] },
  { key: 'saturn', name: 'Sega Saturn', icon: 'saturn', aliases: ['Saturn'] },
  { key: 'dreamcast', name: 'Dreamcast', icon: 'dreamcast', aliases: ['Sega Dreamcast'] },
  // Outros
  { key: 'pcengine', name: 'PC Engine / TurboGrafx-16', icon: 'pcengine', aliases: ['PC Engine', 'TurboGrafx-16', 'TurboGrafx'] },
  { key: 'pcenginecd', name: 'PC Engine CD', icon: 'pcenginecd', aliases: ['TurboGrafx-CD'] },
  { key: 'atari2600', name: 'Atari 2600', icon: 'atari2600', aliases: [] },
  { key: 'atari7800', name: 'Atari 7800', icon: 'atari7800', aliases: [] },
  { key: 'lynx', name: 'Atari Lynx', icon: 'lynx', aliases: ['Lynx'] },
  { key: 'ngp', name: 'Neo Geo Pocket (Color)', icon: 'ngp', aliases: ['Neo Geo Pocket', 'Neo Geo Pocket Color', 'NGP', 'NGPC'] },
  { key: 'wonderswan', name: 'WonderSwan (Color)', icon: 'wonderswan', aliases: ['WonderSwan', 'WonderSwan Color'] },
  { key: 'colecovision', name: 'ColecoVision', icon: 'colecovision', aliases: [] },
  { key: 'vectrex', name: 'Vectrex', icon: 'vectrex', aliases: [] },
  { key: 'msx', name: 'MSX', icon: 'msx', aliases: [] },
  { key: 'arcade', name: 'Arcade', icon: 'arcade', aliases: ['Fliperama', 'MAME'] },
  { key: 'pc', name: 'PC', icon: 'pc', aliases: ['Windows', 'Computador'] },
];

const normalize = (s: string) => foldDiacritics(s).replace(/\s+/g, ' ').trim();

const BY_KEY = new Map(CONSOLE_CATEGORIES.map((c) => [c.key, c]));
const BY_NAME = new Map(CONSOLE_CATEGORIES.flatMap((c) => [c.name, ...c.aliases].map((n) => [normalize(n), c] as const)));

export function getConsoleCategory(key: string | null | undefined): ConsoleCategory | undefined {
  return key ? BY_KEY.get(key) : undefined;
}

/** Console pelo nome exato ou por um apelido ("PS4", "playstation 4" → ps4); nome livre devolve undefined. */
export function consoleCategoryByName(name: string): ConsoleCategory | undefined {
  return BY_NAME.get(normalize(name));
}

/** Família de ícone do catálogo da Loja → console, quando o port não diz o sistema exato. */
const BY_STORE_PLATFORM: Partial<Record<CategoryIconKey, string>> = {
  playstation: 'ps1',
  psp: 'psp',
  vita: 'vita',
  ds: 'nds',
  n3ds: 'n3ds',
  switch: 'switch',
  wii: 'wii',
  wiiu: 'wiiu',
  gamecube: 'gamecube',
  n64: 'n64',
  snes: 'snes',
  nes: 'nes',
  gameboy: 'gb',
  gba: 'gba',
  xbox: 'xbox',
  xbox360: 'xbox360',
  sega: 'genesis',
  saturn: 'saturn',
  dreamcast: 'dreamcast',
  arcade: 'arcade',
  pc: 'pc',
};

/** Console do jogo original de um port da Loja ("PlayStation 2" no sistema vence a família). */
export function consoleOfPort(original: { platform: CategoryIconKey; system?: string }): ConsoleCategory | undefined {
  return (original.system && consoleCategoryByName(original.system)) || getConsoleCategory(BY_STORE_PLATFORM[original.platform]);
}
