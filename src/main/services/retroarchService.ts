import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { suggestCore } from '@shared/consoles';
import type { CoreInfo, Game, RetroArchStatus } from '@shared/types';
import { AppError } from '../errors';
import { isFile } from './fsUtils';
import type { SettingsService } from './settingsService';

const IS_WINDOWS = process.platform === 'win32';
const EXE_NAME = IS_WINDOWS ? 'retroarch.exe' : 'retroarch';
const CORE_SUFFIX = `_libretro${IS_WINDOWS ? '.dll' : process.platform === 'darwin' ? '.dylib' : '.so'}`;
const STATUS_TTL_MS = 10_000;

export interface LaunchSpec {
  command: string;
  args: string[];
  cwd: string;
}

function candidateDirs(): string[] {
  if (IS_WINDOWS) {
    const roots = ['C:', 'D:', 'E:', 'F:'];
    const relative = [
      'RetroArch-Win64',
      'RetroArch',
      'Games\\RetroArch',
      'Program Files\\RetroArch',
      'Program Files (x86)\\Steam\\steamapps\\common\\RetroArch',
      'Program Files\\Steam\\steamapps\\common\\RetroArch',
      'SteamLibrary\\steamapps\\common\\RetroArch',
    ];
    return [
      ...roots.flatMap((root) => relative.map((rel) => `${root}\\${rel}`)),
      path.join(process.env.APPDATA ?? '', 'RetroArch'),
    ];
  }
  return [
    '/usr/bin',
    '/usr/local/bin',
    path.join(os.homedir(), '.local/bin'),
    '/Applications/RetroArch.app/Contents/MacOS',
  ];
}

function configCandidates(exeDir: string): string[] {
  return [
    path.join(exeDir, 'retroarch.cfg'),
    path.join(process.env.APPDATA ?? '', 'RetroArch', 'retroarch.cfg'),
    path.join(os.homedir(), '.config', 'retroarch', 'retroarch.cfg'),
    path.join(os.homedir(), 'Library', 'Application Support', 'RetroArch', 'config', 'retroarch.cfg'),
  ];
}

/** Parser do formato `chave = "valor"` do retroarch.cfg. */
export function parseRetroArchConfig(text: string): Map<string, string> {
  const config = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9_]+)\s*=\s*"?(.*?)"?\s*$/.exec(line);
    if (match) config.set(match[1]!, match[2]!);
  }
  return config;
}

/** No RetroArch, caminhos iniciados por ":" são relativos à pasta do executável. */
function resolveRetroArchPath(value: string | undefined, exeDir: string): string | null {
  if (!value || value === 'default') return null;
  return value.startsWith(':') ? path.join(exeDir, value.slice(1)) : value;
}

export class RetroArchService {
  private statusCache: { value: RetroArchStatus; at: number } | null = null;

  constructor(
    private readonly settings: SettingsService,
    private readonly userDataDir: string,
  ) {
    settings.onChange((next, prev) => {
      if (next.retroarchPath !== prev.retroarchPath) this.statusCache = null;
    });
  }

  async locate(): Promise<string | null> {
    const configured = this.settings.get().retroarchPath;
    if (configured) return (await isFile(configured)) ? configured : null;
    for (const dir of candidateDirs()) {
      const exe = path.join(dir, EXE_NAME);
      if (await isFile(exe)) return exe;
    }
    return null;
  }

  async status(force = false): Promise<RetroArchStatus> {
    if (!force && this.statusCache && Date.now() - this.statusCache.at < STATUS_TTL_MS) {
      return this.statusCache.value;
    }
    const value = await this.computeStatus();
    this.statusCache = { value, at: Date.now() };
    return value;
  }

  /**
   * Onde o RetroArch grava saves (.srm) e save states (.state*): pastas da configuração, o padrão
   * <retroarch>\saves e \states, ou a pasta da própria ROM ("savefiles_in_content_dir").
   */
  async saveDirs(): Promise<{ exeDir: string; dirs: string[]; inContentDir: boolean } | null> {
    const exePath = await this.locate();
    if (!exePath) return null;
    const exeDir = path.dirname(exePath);
    const { config } = await this.readConfig(exeDir);
    const dirs = [
      resolveRetroArchPath(config.get('savefile_directory'), exeDir) ?? path.join(exeDir, 'saves'),
      resolveRetroArchPath(config.get('savestate_directory'), exeDir) ?? path.join(exeDir, 'states'),
    ];
    const inContentDir = config.get('savefiles_in_content_dir') === 'true' || config.get('savestates_in_content_dir') === 'true';
    return { exeDir, dirs: [...new Set(dirs)], inContentDir };
  }

  async buildLaunch(game: Game, hardcore: boolean): Promise<LaunchSpec> {
    const exePath = await this.locate();
    if (!exePath) {
      throw new AppError(
        'RETROARCH_NOT_FOUND',
        'RetroArch não encontrado. Informe o caminho do retroarch.exe em Configurações.',
      );
    }

    let corePath = game.corePath;
    if (!corePath) corePath = suggestCore(game.consoleId, (await this.status()).cores);
    if (!corePath || !(await isFile(corePath))) {
      throw new AppError(
        'CORE_MISSING',
        `Nenhum core válido para "${game.title}". Escolha um core nas propriedades do jogo (baixe-o pelo Online Updater do RetroArch se necessário).`,
      );
    }

    const overrideCfg = await this.writeOverrideConfig(hardcore);
    return {
      command: exePath,
      args: ['--appendconfig', overrideCfg, '-L', corePath, game.path],
      cwd: path.dirname(exePath),
    };
  }

  /**
   * Config anexada só nas execuções feitas pelo launcher: garante conquistas ligadas
   * sem alterar o retroarch.cfg do usuário. O login (token) continua sendo o do RetroArch.
   */
  private async writeOverrideConfig(hardcore: boolean): Promise<string> {
    const file = path.join(this.userDataDir, 'retroarch-override.cfg');
    const content = [
      'cheevos_enable = "true"',
      `cheevos_hardcore_mode_enable = "${hardcore ? 'true' : 'false'}"`,
      '',
    ].join('\n');
    await fs.writeFile(file, content, 'utf8');
    return file;
  }

  private async computeStatus(): Promise<RetroArchStatus> {
    const exePath = await this.locate();
    if (!exePath) {
      return { found: false, exePath: null, configPath: null, cheevosEnabled: false, loggedInAs: null, cores: [] };
    }
    const exeDir = path.dirname(exePath);
    const { config, configPath } = await this.readConfig(exeDir);
    const cores = await this.listCores(exeDir, config);
    const username = config.get('cheevos_username')?.trim() || null;
    const hasSession = Boolean(config.get('cheevos_token') || config.get('cheevos_password'));
    return {
      found: true,
      exePath,
      configPath,
      cheevosEnabled: config.get('cheevos_enable') === 'true',
      loggedInAs: username && hasSession ? username : null,
      cores,
    };
  }

  private async readConfig(exeDir: string): Promise<{ config: Map<string, string>; configPath: string | null }> {
    for (const candidate of configCandidates(exeDir)) {
      try {
        const text = await fs.readFile(candidate, 'utf8');
        return { config: parseRetroArchConfig(text), configPath: candidate };
      } catch {
        // tenta o próximo
      }
    }
    return { config: new Map(), configPath: null };
  }

  private async listCores(exeDir: string, config: Map<string, string>): Promise<CoreInfo[]> {
    const dirs = [
      resolveRetroArchPath(config.get('libretro_directory'), exeDir),
      path.join(exeDir, 'cores'),
      path.join(os.homedir(), '.config', 'retroarch', 'cores'),
    ].filter((d): d is string => Boolean(d));

    for (const dir of dirs) {
      try {
        const files = await fs.readdir(dir);
        const cores = files
          .filter((f) => f.endsWith(CORE_SUFFIX))
          .map((f) => ({ name: f.slice(0, -CORE_SUFFIX.length), path: path.join(dir, f) }))
          .sort((a, b) => a.name.localeCompare(b.name));
        if (cores.length > 0) return cores;
      } catch {
        // diretório inexistente
      }
    }
    return [];
  }
}
