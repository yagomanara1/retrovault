// Emuladores próprios (fora do RetroArch) que o RetroVault sabe abrir. Os parâmetros de linha de comando
// foram conferidos no código de cada um:
//   PCSX2 (pcsx2-qt/QtHost.cpp) e DuckStation (duckstation-qt/qthost.cpp): -batch (fecha junto com o jogo),
//     -fullscreen, "--" antes do arquivo;
//   Dolphin (UICommon/CommandLineParse.cpp): -b (batch), -e <arquivo>, -C <config>=<valor>;
//   PPSSPP (Core/CmdLine.cpp): --fullscreen, --escape-exit (Esc fecha o emulador);
//   melonDS (qt_sdl/CLI.cpp) e mGBA (feature/commandline.c): -f / --fullscreen e o arquivo.
// A lista veio da ideia do Taiga Launcher (GabrielTaiga, Apache-2.0); a escolha e os parâmetros são nossos.
import { ConsoleId } from './consoles';

export interface EmulatorDef {
  id: string;
  name: string;
  /** Consoles (ID do RetroAchievements) que ele roda. */
  consoles: readonly number[];
  /** Nomes do executável no Windows, do mais comum para o menos. */
  exeNames: readonly string[];
  /** Pastas de instalação conhecidas (dentro de Arquivos de Programas e de %LOCALAPPDATA%\Programs). */
  installDirs: readonly string[];
  /** Tem RetroAchievements próprio (a conta é configurada no emulador). */
  retroAchievements: boolean;
  site: string;
  /** Argumentos para abrir `rom`. */
  args(rom: string, fullscreen: boolean): string[];
}

export const EMULATORS: readonly EmulatorDef[] = [
  {
    id: 'duckstation',
    name: 'DuckStation',
    consoles: [ConsoleId.PlayStation],
    exeNames: ['duckstation-qt-x64-ReleaseLTCG.exe', 'duckstation-qt-x64-Release.exe', 'duckstation-qt.exe'],
    installDirs: ['DuckStation'],
    retroAchievements: true,
    site: 'https://www.duckstation.org',
    args: (rom, fullscreen) => ['-batch', ...(fullscreen ? ['-fullscreen'] : []), '--', rom],
  },
  {
    id: 'pcsx2',
    name: 'PCSX2',
    consoles: [ConsoleId.PS2],
    exeNames: ['pcsx2-qt.exe', 'pcsx2-qtx64-avx2.exe', 'pcsx2-qtx64.exe'],
    installDirs: ['PCSX2'],
    retroAchievements: true,
    site: 'https://pcsx2.net',
    args: (rom, fullscreen) => ['-batch', ...(fullscreen ? ['-fullscreen'] : []), '--', rom],
  },
  {
    id: 'ppsspp',
    name: 'PPSSPP',
    consoles: [ConsoleId.PSP],
    exeNames: ['PPSSPPWindows64.exe', 'PPSSPPWindows.exe'],
    installDirs: ['PPSSPP'],
    retroAchievements: true,
    site: 'https://www.ppsspp.org',
    args: (rom, fullscreen) => [...(fullscreen ? ['--fullscreen', '--escape-exit'] : []), rom],
  },
  {
    id: 'dolphin',
    name: 'Dolphin',
    consoles: [ConsoleId.GameCube, ConsoleId.Wii],
    exeNames: ['Dolphin.exe'],
    installDirs: ['Dolphin', 'Dolphin-x64'],
    retroAchievements: true,
    site: 'https://dolphin-emu.org',
    args: (rom, fullscreen) => ['-b', ...(fullscreen ? ['-C', 'Dolphin.Display.Fullscreen=True'] : []), '-e', rom],
  },
  {
    id: 'melonds',
    name: 'melonDS',
    consoles: [ConsoleId.NDS],
    exeNames: ['melonDS.exe'],
    installDirs: ['melonDS'],
    retroAchievements: false,
    site: 'https://melonds.kuribo64.net',
    args: (rom, fullscreen) => [...(fullscreen ? ['-f'] : []), rom],
  },
  {
    id: 'mgba',
    name: 'mGBA',
    consoles: [ConsoleId.GameBoy, ConsoleId.GBC, ConsoleId.GBA],
    exeNames: ['mGBA.exe'],
    installDirs: ['mGBA'],
    retroAchievements: false,
    site: 'https://mgba.io',
    args: (rom, fullscreen) => [...(fullscreen ? ['-f'] : []), rom],
  },
  {
    id: 'flycast',
    name: 'Flycast',
    consoles: [ConsoleId.Dreamcast],
    exeNames: ['flycast.exe'],
    installDirs: ['Flycast'],
    retroAchievements: true,
    site: 'https://github.com/flyinghead/flycast',
    args: (rom) => [rom],
  },
];

const BY_ID = new Map(EMULATORS.map((e) => [e.id, e]));

export function getEmulator(id: string | null | undefined): EmulatorDef | undefined {
  return id ? BY_ID.get(id) : undefined;
}

export function emulatorsForConsole(consoleId: number | null | undefined): EmulatorDef[] {
  return consoleId == null ? [] : EMULATORS.filter((e) => e.consoles.includes(consoleId));
}

/** O que abre as ROMs de um console: o RetroArch ou o id de um emulador do catálogo. */
export type EmulatorChoice = 'retroarch' | string;

/** Configuração guardada: caminhos indicados à mão, escolha por console e tela cheia. */
export interface EmulatorConfig {
  /** id do emulador → .exe escolhido pelo usuário (sem isso, vale o encontrado sozinho). */
  paths: Record<string, string>;
  /** ID do console (texto) → 'retroarch' ou id do emulador. Sem entrada: automático. */
  byConsole: Record<string, EmulatorChoice>;
  fullscreen: boolean;
}

export const DEFAULT_EMULATOR_CONFIG: EmulatorConfig = { paths: {}, byConsole: {}, fullscreen: true };

/** Estado de um emulador para a tela de Configurações. */
export interface EmulatorStatus {
  id: string;
  name: string;
  consoles: readonly number[];
  retroAchievements: boolean;
  site: string;
  /** Escolhido à mão (pode não existir mais). */
  configuredPath: string | null;
  /** Encontrado sozinho numa pasta de instalação conhecida. */
  detectedPath: string | null;
  /** O que será usado: o escolhido, se existir; senão o encontrado. */
  path: string | null;
}

/** Como as ROMs de um console estão sendo abertas. */
export interface ConsoleEmulatorStatus {
  consoleId: number;
  /** Escolha salva; null = automático. */
  choice: EmulatorChoice | null;
  /** O que vai abrir de fato (automático resolvido). */
  effective: EmulatorChoice;
  /** O RetroArch tem algum core para este console. */
  retroArchCore: boolean;
}

export interface EmulatorsOverview {
  emulators: EmulatorStatus[];
  consoles: ConsoleEmulatorStatus[];
  fullscreen: boolean;
}
