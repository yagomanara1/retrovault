import path from 'node:path';
import { consoleName, getConsole } from '@shared/consoles';
import type { Game } from '@shared/types';
import { parseArgs } from './fsUtils';

// Descobre a plataforma de um jogo para organizar as categorias sozinho.
// Do sinal mais forte para o mais fraco; sem sinal nenhum, devolve null (não chuta "PC": um port
// de PS4 também é um .exe, e errar a categoria é pior que deixar o usuário escolher).

/** Nomes canônicos (os mesmos que viram nome de categoria). */
export const PLATFORM = {
  ps1: 'PlayStation',
  ps2: 'PlayStation 2',
  ps3: 'PlayStation 3',
  ps4: 'PlayStation 4',
  psp: 'PlayStation Portable',
  vita: 'PlayStation Vita',
  ds: 'Nintendo DS',
  n3ds: 'Nintendo 3DS',
  gamecube: 'GameCube',
  wii: 'Wii',
  wiiu: 'Wii U',
  switch: 'Nintendo Switch',
  xbox: 'Xbox',
  x360: 'Xbox 360',
  pc: 'PC',
} as const;

/** Emuladores pelo nome do executável (ou citados nos argumentos). */
const EMULATORS: [RegExp, string][] = [
  [/^(rpcs3)/i, PLATFORM.ps3],
  [/^(shadps4)/i, PLATFORM.ps4], // ports de PS4 (gow3, bloodborne) são detectados pelos troféus
  [/^(pcsx2)/i, PLATFORM.ps2],
  [/^(duckstation|epsxe|pcsx-?r|swanstation)/i, PLATFORM.ps1],
  [/^(ppsspp)/i, PLATFORM.psp],
  [/^(vita3k)/i, PLATFORM.vita],
  [/^(citra|lime3ds|azahar|panda3ds)/i, PLATFORM.n3ds],
  [/^(melonds|desmume|nogba)/i, PLATFORM.ds],
  [/^(cemu)/i, PLATFORM.wiiu],
  [/^(yuzu|ryujinx|suyu|sudachi|citron|eden)/i, PLATFORM.switch],
  [/^(xenia)/i, PLATFORM.x360],
  [/^(xemu|cxbx)/i, PLATFORM.xbox],
];

/** Arquivos de jogo citados nos argumentos (ex.: citra.exe "C:\…\Pokemon X.3ds"). */
const FILE_TYPES: [RegExp, string][] = [
  [/\.(3ds|cia|cci|cxi|3dsx)$/i, PLATFORM.n3ds],
  [/\.(nds|dsi)$/i, PLATFORM.ds],
  [/\.(nsp|xci|nca|nro)$/i, PLATFORM.switch],
  [/\.(wud|wux|wua|rpx)$/i, PLATFORM.wiiu],
  [/\.(rvz|wbfs|gcz)$/i, PLATFORM.wii], // GameCube também usa .rvz/.gcz; Wii é o caso mais comum
  [/\.(vpk)$/i, PLATFORM.vita],
  [/\.(pkg)$/i, PLATFORM.ps3],
  [/\.(xex)$/i, PLATFORM.x360],
];

export interface PlatformHints {
  /** O jogo tem lista de troféus vinda de um dump de PS4. */
  hasPs4Trophies?: boolean;
  /** Nomes dos arquivos na pasta do executável (ex.: o .nds original ao lado de um port de DS). */
  siblingFiles?: readonly string[];
}

/** Plataforma de um arquivo de jogo pela extensão (tipos acima + extensões de console do catálogo). */
function platformOfFile(name: string): string | null {
  for (const [pattern, platform] of FILE_TYPES) if (pattern.test(name)) return platform;
  return null;
}

export function detectPlatform(game: Pick<Game, 'kind' | 'path' | 'launchArgs' | 'consoleId'>, hints: PlatformHints = {}): string | null {
  // 1) ROM do RetroArch: o console já é conhecido.
  if (game.kind === 'retroarch') return getConsole(game.consoleId) ? consoleName(game.consoleId) : null;

  // 2) Troféus de PS4 importados de um dump.
  if (hints.hasPs4Trophies) return PLATFORM.ps4;

  const exe = path.basename(game.path, path.extname(game.path));
  const args = parseArgs(game.launchArgs);

  // 3) Emulador (o executável ou um argumento que aponta para outro emulador).
  for (const candidate of [exe, ...args.map((a) => path.basename(a, path.extname(a)))]) {
    for (const [pattern, platform] of EMULATORS) if (pattern.test(candidate)) return platform;
  }

  // 4) Arquivo de jogo nos argumentos.
  for (const arg of args) {
    const platform = platformOfFile(arg);
    if (platform) return platform;
  }

  // 5) Pistas no caminho: estrutura de jogo de PS3 ou dump de PS4 (CUSA01623, PLAS…).
  const fullPath = [game.path, ...args].join(' ');
  if (/[\\/](PS3_GAME|USRDIR)[\\/]/i.test(fullPath) || /\bBL[EU]S\d{5}\b|\bNP[EU]B\d{5}\b/i.test(fullPath)) return PLATFORM.ps3;
  if (/\b(CUSA|PLAS)\d{5}\b/i.test(fullPath)) return PLATFORM.ps4;

  // 6) Arquivo de jogo ao lado do executável (Pokémon Platinum: main.exe + o .nds original).
  //    Só vale se apontar para UMA plataforma: pastas misturadas não decidem nada.
  const found = new Set((hints.siblingFiles ?? []).map(platformOfFile).filter((p): p is string => !!p));
  if (found.size === 1) return [...found][0]!;

  return null;
}
