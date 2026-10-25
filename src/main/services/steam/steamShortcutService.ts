// Leva jogos do RetroVault para a Steam como "jogo não-Steam" (Big Picture, Steam Input, overlay).
// Regras: a Steam precisa estar fechada (ela regrava o arquivo ao sair); o shortcuts.vdf anterior é copiado
// antes de gravar; só os atalhos criados pelo RetroVault (ids registrados por conta) são trocados ou
// removidos — os do usuário ficam intactos, campo por campo.
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  Game,
  SteamAccount,
  SteamShortcutsInput,
  SteamShortcutsOverview,
  SteamShortcutsResult,
} from '@shared/types';
import type { SettingsRepository } from '../../db/repositories/settingsRepository';
import { AppError } from '../../errors';
import type { LaunchSpec } from '../retroarchService';
import { BinaryVdfError, parseBinaryVdf, serializeBinaryVdf, type BinNode } from './binaryVdf';
import { parseVdf, vdfGet } from './steamLibrary';
import {
  joinCommandLine,
  listShortcuts,
  replaceShortcuts,
  samePath,
  shortcutAppId,
  type ExistingShortcut,
  type ShortcutSpec,
} from './steamShortcuts';

const run = promisify(execFile);
const MANAGED_KEY = 'steam.shortcuts';
const STEAM_ID64_BASE = 76561197960265728n;
const MAX_BACKUPS = 10;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/** Por conta: jogo → id do atalho criado, e o atalho do próprio RetroVault. */
type Managed = Record<string, { games: Record<string, number>; launcher: number | null }>;

export interface ImageData {
  data: Buffer;
  ext: string;
}

export interface SteamShortcutDeps {
  steamRoot(): Promise<string | null>;
  /** A Steam desta pasta está aberta? */
  steamRunning(root: string): Promise<boolean>;
  games: { list(): Game[] };
  launchSpecFor(game: Game): Promise<LaunchSpec>;
  /** Arquivo local de uma arte rv-media:// (null se não for do cofre). */
  artworkFile(url: string): string | null;
  /** Baixa uma arte remota (capa do RetroAchievements); null se falhar. */
  downloadImage(url: string): Promise<ImageData | null>;
  repo: Pick<SettingsRepository, 'get' | 'set'>;
  /** Onde guardar as cópias do shortcuts.vdf anterior. */
  backupDir: string;
  /** O executável do RetroVault, quando empacotado (null em desenvolvimento). */
  launcherExe: string | null;
  now?: () => Date;
}

// Só PNG e JPG: são os formatos que a Steam garante em artes personalizadas e ícones (WEBP fica de fora).
const IMAGE_SIGNATURES: [string, (b: Buffer) => boolean][] = [
  ['png', (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))],
  ['jpg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
];

/** A steam.exe desta pasta está rodando? (Compara pela pasta: outra instalação não conta.) */
export async function isSteamRunning(root: string): Promise<boolean> {
  try {
    const { stdout } = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', '(Get-Process steam -ErrorAction SilentlyContinue).Path'],
      { windowsHide: true, timeout: 15_000 },
    );
    const target = path.normalize(root).toLowerCase().replace(/[\\/]+$/, '');
    return stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .some((exe) => path.dirname(path.normalize(exe)).toLowerCase() === target);
  } catch {
    return false;
  }
}

/** Extensão pela assinatura do conteúdo (null = não é imagem que a Steam mostre). */
export function imageExtension(data: Buffer): string | null {
  return IMAGE_SIGNATURES.find(([, test]) => test(data))?.[0] ?? null;
}

/** Download de arte (só https, com limite de tamanho e conferência de assinatura). */
export async function fetchImage(url: string): Promise<ImageData | null> {
  if (!/^https:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const data = Buffer.from(await res.arrayBuffer());
    const ext = data.length <= MAX_IMAGE_BYTES ? imageExtension(data) : null;
    return ext ? { data, ext } : null;
  } catch {
    return null;
  }
}

export class SteamShortcutService {
  constructor(private readonly deps: SteamShortcutDeps) {}

  // ---------- Leitura ----------

  /** Contas com pasta em userdata; nomes do loginusers.vdf (nunca enviados para fora do PC). */
  async accounts(root: string): Promise<SteamAccount[]> {
    const dirs = (await fs.readdir(path.join(root, 'userdata'), { withFileTypes: true }).catch(() => []))
      .filter((d) => d.isDirectory() && /^\d+$/.test(d.name) && d.name !== '0')
      .map((d) => d.name);
    const text = await fs.readFile(path.join(root, 'config', 'loginusers.vdf'), 'utf8').catch(() => '');
    const users = vdfGet(parseVdf(text), 'users');
    const info = new Map<string, { name: string; recent: number }>();
    if (users && typeof users === 'object') {
      for (const [id64, u] of Object.entries(users)) {
        if (!/^\d{17}$/.test(id64) || typeof u !== 'object') continue;
        const account = (BigInt(id64) - STEAM_ID64_BASE).toString();
        const name = vdfGet(u, 'PersonaName');
        const mostRecent = vdfGet(u, 'MostRecent') === '1';
        const timestamp = Number(vdfGet(u, 'Timestamp') ?? 0) || 0;
        info.set(account, { name: typeof name === 'string' && name ? name : account, recent: mostRecent ? Infinity : timestamp });
      }
    }
    const list = dirs.map((id) => ({ id, name: info.get(id)?.name ?? `Conta ${id}`, recent: info.get(id)?.recent ?? -1 }));
    const top = list.reduce((best, a) => (a.recent > best ? a.recent : best), -Infinity);
    return list
      .sort((a, b) => b.recent - a.recent || a.name.localeCompare(b.name))
      .map((a) => ({ id: a.id, name: a.name, mostRecent: a.recent === top && top >= 0 }));
  }

  async overview(accountId?: string | null): Promise<SteamShortcutsOverview> {
    const launcherAvailable = !!this.deps.launcherExe;
    const root = await this.deps.steamRoot();
    if (!root) {
      return { steamFound: false, steamRunning: false, accounts: [], accountId: null, games: [], launcherInSteam: false, launcherAvailable, otherShortcuts: 0 };
    }
    const [accounts, steamRunning] = await Promise.all([this.accounts(root), this.deps.steamRunning(root)]);
    const account = accounts.find((a) => a.id === accountId) ?? accounts[0] ?? null;
    if (!account) {
      return { steamFound: true, steamRunning, accounts, accountId: null, games: [], launcherInSteam: false, launcherAvailable, otherShortcuts: 0 };
    }

    const existing = listShortcuts(await this.readShortcuts(root, account.id).catch(() => []));
    const mine = this.managed()[account.id] ?? { games: {}, launcher: null };
    const managedIds = new Set([...Object.values(mine.games), ...(mine.launcher ? [mine.launcher] : [])]);
    const present = new Set(existing.map((s) => s.appId));
    const others = existing.filter((s) => !managedIds.has(s.appId));

    return {
      steamFound: true,
      steamRunning,
      accounts,
      accountId: account.id,
      games: this.deps.games.list().map((g) => {
        const id = mine.games[String(g.id)];
        return { gameId: g.id, title: g.title, inSteam: id !== undefined && present.has(id), blocked: this.blockedReason(g, others) };
      }),
      launcherInSteam: mine.launcher !== null && present.has(mine.launcher),
      launcherAvailable,
      otherShortcuts: others.length,
    };
  }

  /** Jogo da própria Steam, ou que o usuário já pôs na Steam à mão (o atalho dele não é mexido). */
  private blockedReason(game: Game, others: readonly ExistingShortcut[], command?: string): string | null {
    // Também o adicionado como executável comum, mas instalado pela Steam: viraria um atalho duplicado.
    if (game.steamAppId || (game.kind === 'executable' && /[\\/]steamapps[\\/]common[\\/]/i.test(game.path))) return 'Já é um jogo da Steam';
    const exe = command ?? (game.kind === 'executable' ? game.path : null);
    if (game.kind === 'executable' && exe && others.some((o) => samePath(o.exe, exe))) return 'Você já adicionou este jogo à Steam';
    return null;
  }

  // ---------- Gravação ----------

  /**
   * Deixa na Steam exatamente os jogos escolhidos (e o RetroVault, se pedido): adiciona os novos, atualiza
   * os que já estavam (caminho, argumentos, artes) e tira os desmarcados. Atalhos do usuário não mudam.
   */
  async apply(input: SteamShortcutsInput): Promise<SteamShortcutsResult> {
    const root = await this.deps.steamRoot();
    if (!root) throw new AppError('NOT_FOUND', 'A Steam não foi encontrada neste PC.');
    if (!(await this.accounts(root)).some((a) => a.id === input.accountId)) throw new AppError('NOT_FOUND', 'Conta da Steam não encontrada.');
    if (await this.deps.steamRunning(root)) {
      throw new AppError('STEAM_RUNNING', 'Feche a Steam antes de salvar: aberta, ela desfaz a mudança quando sai.');
    }

    const file = this.shortcutsFile(root, input.accountId);
    const original = await fs.readFile(file).catch(() => null);
    const nodes = original ? this.parseExact(original) : [];
    const existing = listShortcuts(nodes);

    const managed = this.managed();
    const before = managed[input.accountId] ?? { games: {}, launcher: null };
    const beforeIds = new Set([...Object.values(before.games), ...(before.launcher ? [before.launcher] : [])]);
    const others = existing.filter((s) => !beforeIds.has(s.appId));
    const otherIds = new Set(others.map((s) => s.appId));

    const specs: ShortcutSpec[] = [];
    const art = new Map<number, Game>();
    const nextGames: Record<string, number> = {};
    const skipped: SteamShortcutsResult['skipped'] = [];
    const byId = new Map(this.deps.games.list().map((g) => [g.id, g]));
    const gridDir = path.join(path.dirname(file), 'grid');

    for (const gameId of [...new Set(input.gameIds)]) {
      const game = byId.get(gameId);
      if (!game) continue;
      let spec: LaunchSpec;
      try {
        spec = await this.deps.launchSpecFor(game);
      } catch (err) {
        skipped.push({ title: game.title, reason: err instanceof Error ? err.message : String(err) });
        continue;
      }
      const blocked = this.blockedReason(game, others, spec.command);
      const appId = shortcutAppId(`game:${game.id}`);
      if (blocked || otherIds.has(appId)) {
        skipped.push({ title: game.title, reason: blocked ?? 'Conflito com um atalho existente' });
        continue;
      }
      specs.push({ appId, appName: game.title, exe: spec.command, startDir: spec.cwd, launchOptions: joinCommandLine(spec.args), icon: '' });
      art.set(appId, game);
      nextGames[String(game.id)] = appId;
    }

    let launcher: number | null = null;
    if (input.includeLauncher && this.deps.launcherExe) {
      launcher = shortcutAppId('launcher');
      const exe = this.deps.launcherExe;
      specs.push({ appId: launcher, appName: 'RetroVault', exe, startDir: path.dirname(exe), launchOptions: '', icon: '' });
    }

    // Ícones primeiro (o atalho aponta para o arquivo em grid\).
    await fs.mkdir(gridDir, { recursive: true });
    const nextIds = new Set(specs.map((s) => s.appId));
    for (const id of beforeIds) if (!nextIds.has(id)) await this.removeGridArt(gridDir, id);
    for (const s of specs) {
      const game = art.get(s.appId);
      if (game) s.icon = (await this.writeGridArt(gridDir, s.appId, game)) ?? '';
    }

    const backupPath = original ? await this.backup(input.accountId, original) : null;
    replaceShortcuts(nodes, beforeIds, specs);
    await this.writeAtomic(file, serializeBinaryVdf(nodes));

    managed[input.accountId] = { games: nextGames, launcher };
    this.deps.repo.set(MANAGED_KEY, managed);

    return {
      added: [...nextIds].filter((id) => !beforeIds.has(id)).length,
      updated: [...nextIds].filter((id) => beforeIds.has(id)).length,
      removed: [...beforeIds].filter((id) => !nextIds.has(id)).length,
      skipped,
      backupPath,
    };
  }

  // ---------- Auxiliares ----------

  private managed(): Managed {
    return { ...this.deps.repo.get<Managed>(MANAGED_KEY, {}) };
  }

  private shortcutsFile(root: string, accountId: string): string {
    return path.join(root, 'userdata', accountId, 'config', 'shortcuts.vdf');
  }

  private async readShortcuts(root: string, accountId: string): Promise<BinNode[]> {
    const data = await fs.readFile(this.shortcutsFile(root, accountId)).catch(() => null);
    return data ? this.parseExact(data) : [];
  }

  /** Só segue se o arquivo regravado sem mudanças for idêntico ao original (formato 100% entendido). */
  private parseExact(data: Buffer): BinNode[] {
    try {
      const nodes = parseBinaryVdf(data);
      if (serializeBinaryVdf(nodes).equals(data)) return nodes;
    } catch (err) {
      if (!(err instanceof BinaryVdfError)) throw err;
    }
    throw new AppError('VALIDATION', 'O arquivo de atalhos da Steam está num formato que o RetroVault não reconhece. Nada foi alterado.');
  }

  private async backup(accountId: string, data: Buffer): Promise<string> {
    const dir = path.join(this.deps.backupDir, accountId);
    await fs.mkdir(dir, { recursive: true });
    const stamp = (this.deps.now?.() ?? new Date()).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const file = path.join(dir, `shortcuts-${stamp}.vdf`);
    await fs.writeFile(file, data);
    const old = (await fs.readdir(dir)).filter((n) => /^shortcuts-\d{8}-\d{6}\.vdf$/.test(n)).sort().reverse().slice(MAX_BACKUPS);
    for (const name of old) await fs.rm(path.join(dir, name), { force: true });
    return file;
  }

  /** Grava num temporário e troca: uma falha no meio não deixa o arquivo da Steam pela metade. */
  private async writeAtomic(file: string, data: Buffer): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.retrovault-tmp`;
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, file);
  }

  /** Capa vertical (<id>p), fundo (<id>_hero) e ícone (<id>_icon); devolve o caminho do ícone. */
  private async writeGridArt(gridDir: string, appId: number, game: Game): Promise<string | null> {
    await this.removeGridArt(gridDir, appId);
    const write = async (url: string | null, suffix: string) => {
      const image = url ? await this.loadImage(url) : null;
      if (!image) return null;
      const file = path.join(gridDir, `${appId}${suffix}.${image.ext}`);
      await fs.writeFile(file, image.data);
      return file;
    };
    await write(game.coverUrl, 'p');
    await write(game.backgroundUrl, '_hero');
    return write(game.iconUrl, '_icon');
  }

  private async removeGridArt(gridDir: string, appId: number): Promise<void> {
    const pattern = new RegExp(`^${appId}(p|_hero|_icon)\\.(png|jpe?g)$`, 'i');
    for (const name of await fs.readdir(gridDir).catch(() => [] as string[])) {
      if (pattern.test(name)) await fs.rm(path.join(gridDir, name), { force: true });
    }
  }

  private async loadImage(url: string): Promise<ImageData | null> {
    const local = this.deps.artworkFile(url);
    if (local) {
      const data = await fs.readFile(local).catch(() => null);
      const ext = data ? imageExtension(data) : null;
      return data && ext ? { data, ext } : null;
    }
    return /^https:\/\//i.test(url) ? this.deps.downloadImage(url) : null;
  }
}
