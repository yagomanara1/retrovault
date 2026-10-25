import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CONSOLES, getConsole } from '@shared/consoles';
import {
  DEFAULT_EMULATOR_CONFIG,
  EMULATORS,
  emulatorsForConsole,
  getEmulator,
  type ConsoleEmulatorStatus,
  type EmulatorChoice,
  type EmulatorConfig,
  type EmulatorDef,
  type EmulatorsOverview,
  type EmulatorStatus,
} from '@shared/emulators';
import type { Game } from '@shared/types';
import type { SettingsRepository } from '../db/repositories/settingsRepository';
import { AppError } from '../errors';
import type { LaunchSpec } from './retroarchService';

const CONFIG_KEY = 'emulators.config';
const DETECT_TTL_MS = 60_000;

const isFile = (p: string) => fs.stat(p).then((s) => s.isFile(), () => false);

interface EmulatorDeps {
  repo: SettingsRepository;
  /** Pastas-base de instalação (Arquivos de Programas, %LOCALAPPDATA%\Programs…). */
  installRoots: readonly string[];
  /** %USERPROFILE%: instalações pelo Scoop (scoop\apps\<id>\current). */
  homeDir: string;
  /** Nomes dos cores instalados no RetroArch (ex.: "pcsx2"), para o modo automático. */
  retroArchCores: () => Promise<readonly string[]>;
}

/**
 * Emuladores próprios por console. Sem escolha, o RetroArch abre tudo; o modo automático só troca para um
 * emulador próprio quando o RetroArch não tem core para o console e esse emulador está instalado.
 * Os emuladores são procurados só em pastas de instalação conhecidas (nunca varrendo o disco).
 */
export class EmulatorService {
  private detected: { at: number; paths: Map<string, string | null> } | null = null;

  constructor(private readonly deps: EmulatorDeps) {}

  config(): EmulatorConfig {
    const saved = this.deps.repo.get<Partial<EmulatorConfig>>(CONFIG_KEY, {});
    return { ...DEFAULT_EMULATOR_CONFIG, ...saved, paths: { ...saved.paths }, byConsole: { ...saved.byConsole } };
  }

  private save(config: EmulatorConfig): void {
    this.deps.repo.set(CONFIG_KEY, config);
  }

  /** Indica o .exe de um emulador (null volta para o encontrado sozinho). */
  async setPath(id: string, exePath: string | null): Promise<EmulatorsOverview> {
    const def = this.require(id);
    const config = this.config();
    if (exePath) {
      if (path.extname(exePath).toLowerCase() !== '.exe' || !(await isFile(exePath))) {
        throw new AppError('VALIDATION', `Escolha o executável do ${def.name} (${def.exeNames[0]}).`);
      }
      config.paths[id] = exePath;
    } else {
      delete config.paths[id];
    }
    this.save(config);
    return this.overview();
  }

  /** O que abre as ROMs do console: 'retroarch', um emulador do catálogo ou null (automático). */
  async setForConsole(consoleId: number, choice: EmulatorChoice | null): Promise<EmulatorsOverview> {
    if (!getConsole(consoleId)) throw new AppError('VALIDATION', 'Console desconhecido.');
    if (choice && choice !== 'retroarch' && !this.require(choice).consoles.includes(consoleId)) {
      throw new AppError('VALIDATION', `O ${this.require(choice).name} não roda jogos deste console.`);
    }
    const config = this.config();
    if (choice) config.byConsole[String(consoleId)] = choice;
    else delete config.byConsole[String(consoleId)];
    this.save(config);
    return this.overview();
  }

  async setFullscreen(fullscreen: boolean): Promise<EmulatorsOverview> {
    this.save({ ...this.config(), fullscreen });
    return this.overview();
  }

  /** Procura de novo nas pastas de instalação (ex.: o usuário acabou de instalar um emulador). */
  async refresh(): Promise<EmulatorsOverview> {
    this.detected = null;
    return this.overview();
  }

  async overview(): Promise<EmulatorsOverview> {
    const config = this.config();
    const detected = await this.detectAll();
    const emulators: EmulatorStatus[] = [];
    for (const def of EMULATORS) {
      const configuredPath = config.paths[def.id] ?? null;
      const detectedPath = detected.get(def.id) ?? null;
      const usable = configuredPath && (await isFile(configuredPath)) ? configuredPath : detectedPath;
      emulators.push({ id: def.id, name: def.name, consoles: def.consoles, retroAchievements: def.retroAchievements, site: def.site, configuredPath, detectedPath, path: usable });
    }
    const cores = new Set(await this.deps.retroArchCores().catch(() => [] as string[]));
    const consoles: ConsoleEmulatorStatus[] = CONSOLES.filter((c) => emulatorsForConsole(c.id).length > 0).map((c) => {
      const retroArchCore = c.cores.some((core) => cores.has(core));
      const choice = config.byConsole[String(c.id)] ?? null;
      return { consoleId: c.id, choice, effective: this.resolve(c.id, choice, retroArchCore, emulators), retroArchCore };
    });
    return { emulators, consoles, fullscreen: config.fullscreen };
  }

  /**
   * Como abrir esta ROM com um emulador próprio; null = vai pelo RetroArch. Lança erro se o emulador
   * escolhido para o console não estiver instalado (melhor avisar do que abrir em outro sem pedir).
   */
  async launchSpec(game: Game): Promise<LaunchSpec | null> {
    if (game.kind !== 'retroarch' || game.consoleId == null) return null;
    const overview = await this.overview();
    const consoleStatus = overview.consoles.find((c) => c.consoleId === game.consoleId);
    if (!consoleStatus || consoleStatus.effective === 'retroarch') return null;
    const def = this.require(consoleStatus.effective);
    const exe = overview.emulators.find((e) => e.id === def.id)?.path;
    if (!exe) {
      throw new AppError(
        'EMULATOR_NOT_FOUND',
        `O ${def.name} não foi encontrado. Indique o ${def.exeNames[0]} em Configurações → Emuladores, ou volte este console para o RetroArch.`,
      );
    }
    return { command: exe, args: def.args(game.path, overview.fullscreen), cwd: path.dirname(exe) };
  }

  /** Quem abre o console agora (para a página do jogo). */
  async effectiveFor(consoleId: number | null): Promise<EmulatorChoice> {
    if (consoleId == null) return 'retroarch';
    return (await this.overview()).consoles.find((c) => c.consoleId === consoleId)?.effective ?? 'retroarch';
  }

  private resolve(consoleId: number, choice: EmulatorChoice | null, retroArchCore: boolean, emulators: readonly EmulatorStatus[]): EmulatorChoice {
    if (choice) return choice;
    if (retroArchCore) return 'retroarch';
    // Automático sem core no RetroArch: o primeiro emulador próprio instalado para o console.
    const installed = emulatorsForConsole(consoleId).find((def) => emulators.find((e) => e.id === def.id)?.path);
    return installed?.id ?? 'retroarch';
  }

  private require(id: string): EmulatorDef {
    const def = getEmulator(id);
    if (!def) throw new AppError('VALIDATION', 'Emulador desconhecido.');
    return def;
  }

  /** Cada emulador nas pastas de instalação conhecidas e no Scoop (sem varrer o disco). */
  private async detectAll(): Promise<Map<string, string | null>> {
    if (this.detected && Date.now() - this.detected.at < DETECT_TTL_MS) return this.detected.paths;
    const paths = new Map<string, string | null>();
    for (const def of EMULATORS) {
      const dirs = [
        ...this.deps.installRoots.flatMap((root) => def.installDirs.map((d) => path.join(root, d))),
        path.join(this.deps.homeDir, 'scoop', 'apps', def.id, 'current'),
      ];
      let found: string | null = null;
      for (const dir of dirs) {
        for (const exe of def.exeNames) {
          if (await isFile(path.join(dir, exe))) {
            found = path.join(dir, exe);
            break;
          }
        }
        if (found) break;
      }
      paths.set(def.id, found);
    }
    this.detected = { at: Date.now(), paths };
    return paths;
  }
}
