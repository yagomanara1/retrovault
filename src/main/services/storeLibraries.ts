// "Importar das lojas instaladas": jogos que outras lojas instalaram neste PC. Só leitura dos registros
// locais de cada uma (sem login, sem escrever nada): manifestos da Steam e da Epic, registro do Windows
// (GOG, Ubisoft) e os bancos locais da Amazon e do itch.io (abertos somente para leitura).
// Ideia trazida do Taiga Launcher (GabrielTaiga, Apache-2.0), que se inspirou no BoilR; código escrito do zero.
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import type { ScanCandidate } from '@shared/types';
import { pathExists } from './fsUtils';
import { isHelperExecutable, rankExecutables, type ExeInfo } from './libraryScanner';
import { pickSteamRoot, steamApps } from './steam/steamLibrary';

const run = promisify(execFile);

export type StoreName = 'Steam' | 'Epic Games' | 'GOG' | 'Ubisoft Connect' | 'Amazon Games' | 'itch.io';

/** Um jogo instalado por uma loja: o executável (ou a pasta, para escolher o executável). */
export interface StoreGame {
  store: StoreName;
  title: string;
  /** Executável indicado pela própria loja (Epic, GOG, Amazon). */
  exe?: string;
  /** Pasta do jogo, quando a loja não diz o executável (Steam, Ubisoft, itch.io) ou como alternativa. */
  dir: string;
  /** Jogo da Steam: abre por ela. */
  steamAppId?: number;
}

/** Chave do registro (com subchaves) → valores de cada uma. */
export type RegistryTree = Map<string, Record<string, string>>;

export interface StoreLibraryDeps {
  /** %ProgramData% (manifestos da Epic). */
  programData: string;
  /** %LOCALAPPDATA% (Amazon Games). */
  localAppData: string;
  /** %APPDATA% (itch.io). */
  appData: string;
  /** Pasta temporária (o reg export grava num arquivo, apagado logo depois). */
  tempDir: string;
  /** Leitura de uma chave do registro com as subchaves: injetada nos testes. Vazio se a chave não existir. */
  readRegistry?: (key: string) => Promise<RegistryTree>;
  /** Onde procurar a Steam se o registro não disser (ex.: C:\Program Files (x86)\Steam). */
  steamFallbackDirs?: readonly string[];
  /** Pasta da Steam fixada (testes numa cópia, RETROVAULT_STEAM_DIR): o registro não é consultado. */
  steamDir?: string | null;
}

/**
 * Lê a chave com o `reg export` (UTF-16, preserva acentos como em "Pokémon"; o `reg query` sai no código
 * de página antigo do console). Só leitura do registro: o arquivo exportado é temporário.
 */
export async function exportRegistry(key: string, tempDir: string): Promise<RegistryTree> {
  const file = path.join(tempDir, `retrovault-reg-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.reg`);
  try {
    await run('reg', ['export', key, file, '/y'], { windowsHide: true });
    return parseRegExport(await fs.readFile(file, 'utf16le'));
  } catch {
    return new Map(); // chave inexistente ou reg indisponível
  } finally {
    await fs.rm(file, { force: true }).catch(() => undefined);
  }
}

/** Texto de um .reg exportado → chave → valores de texto (os DWORD como número em texto). */
export function parseRegExport(text: string): RegistryTree {
  const out: RegistryTree = new Map();
  let current: Record<string, string> | null = null;
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    const section = line.match(/^\[(.+)\]$/);
    if (section) {
      current = {};
      out.set(section[1]!.replace(/^HKEY_LOCAL_MACHINE\\/i, 'HKLM\\').replace(/^HKEY_CURRENT_USER\\/i, 'HKCU\\'), current);
      continue;
    }
    if (!current) continue;
    const str = line.match(/^"((?:[^"\\]|\\.)*)"="((?:[^"\\]|\\.)*)"$/);
    if (str) {
      current[str[1]!.replace(/\\(.)/g, '$1')] = str[2]!.replace(/\\(.)/g, '$1');
      continue;
    }
    const dword = line.match(/^"((?:[^"\\]|\\.)*)"=dword:([0-9a-f]{8})$/i);
    if (dword) current[dword[1]!.replace(/\\(.)/g, '$1')] = String(parseInt(dword[2]!, 16));
  }
  return out;
}

/** Chaves de 32 e 64 bits (as lojas gravam numa ou noutra). */
const regRoots = (sub: string) => [`HKLM\\SOFTWARE\\WOW6432Node\\${sub}`, `HKLM\\SOFTWARE\\${sub}`];

/** Valores da própria chave (o export traz as subchaves junto). */
const keyValues = (tree: RegistryTree, key: string) => [...tree].find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1];

// ---------- Steam ----------

/** Pasta da Steam: a do usuário (HKCU), a da instalação (HKLM) ou o local padrão. */
export async function findSteamRoot(deps: StoreLibraryDeps): Promise<string | null> {
  if (deps.steamDir) return pickSteamRoot([deps.steamDir]);
  const readRegistry = deps.readRegistry ?? ((key: string) => exportRegistry(key, deps.tempDir));
  const user = 'HKCU\\Software\\Valve\\Steam';
  const candidates: (string | undefined)[] = [keyValues(await readRegistry(user), user)?.SteamPath];
  for (const key of regRoots('Valve\\Steam')) candidates.push(keyValues(await readRegistry(key), key)?.InstallPath);
  return pickSteamRoot([...candidates, ...(deps.steamFallbackDirs ?? [])]);
}

export async function steamGames(deps: StoreLibraryDeps): Promise<StoreGame[]> {
  const root = await findSteamRoot(deps);
  if (!root) return [];
  return (await steamApps(root)).map((app) => ({ store: 'Steam' as const, title: app.title, dir: app.dir, steamAppId: app.appId }));
}

// ---------- Epic Games ----------

interface EpicManifest {
  DisplayName?: string;
  InstallLocation?: string;
  LaunchExecutable?: string;
  AppCategories?: string[];
  bIsIncompleteInstall?: boolean;
}

export async function epicGames(programData: string): Promise<StoreGame[]> {
  const dir = path.join(programData, 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  const games: StoreGame[] = [];
  for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
    if (!name.toLowerCase().endsWith('.item')) continue;
    const m = await fs
      .readFile(path.join(dir, name), 'utf8')
      .then((t) => JSON.parse(t.replace(/^\uFEFF/, '')) as EpicManifest)
      .catch(() => null);
    // Só jogos completos (não plugins, editores nem instalações pela metade).
    if (!m?.DisplayName || !m.InstallLocation || m.bIsIncompleteInstall) continue;
    if (m.AppCategories && !m.AppCategories.includes('games')) continue;
    games.push({ store: 'Epic Games', title: m.DisplayName, dir: m.InstallLocation, exe: m.LaunchExecutable ? path.join(m.InstallLocation, m.LaunchExecutable) : undefined });
  }
  return games;
}

// ---------- GOG ----------

export async function gogGames(readRegistry: (key: string) => Promise<RegistryTree>): Promise<StoreGame[]> {
  const games = new Map<string, StoreGame>();
  for (const root of regRoots('GOG.com\\Games')) {
    for (const [key, v] of await readRegistry(root)) {
      // Cada jogo é uma subchave numérica; DLCs dependem de outro jogo (dependsOn).
      if (!/\\\d+$/.test(key) || !v.gameName || !v.path || v.dependsOn) continue;
      games.set(key.split('\\').pop()!, { store: 'GOG', title: v.gameName, dir: v.path, exe: v.exe || undefined });
    }
  }
  return [...games.values()];
}

// ---------- Ubisoft Connect ----------

export async function ubisoftGames(readRegistry: (key: string) => Promise<RegistryTree>): Promise<StoreGame[]> {
  const games = new Map<string, StoreGame>();
  for (const root of regRoots('Ubisoft\\Launcher\\Installs')) {
    for (const [key, v] of await readRegistry(root)) {
      if (!/\\\d+$/.test(key) || !v.InstallDir) continue;
      const dir = v.InstallDir.replace(/[\\/]+$/, '');
      games.set(key.split('\\').pop()!, { store: 'Ubisoft Connect', title: path.basename(dir), dir });
    }
  }
  return [...games.values()];
}

// ---------- Bancos SQLite (Amazon, itch.io): só leitura ----------

function readSqlite<T>(file: string, query: string): T[] {
  let db: Database.Database | null = null;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    return db.prepare(query).all() as T[];
  } catch {
    return []; // loja não instalada, banco em outro formato ou bloqueado
  } finally {
    db?.close();
  }
}

export async function amazonGames(localAppData: string): Promise<StoreGame[]> {
  const file = path.join(localAppData, 'Amazon Games', 'Data', 'Games', 'Sql', 'GameInstallInfo.sqlite');
  if (!(await pathExists(file))) return [];
  const rows = readSqlite<{ ProductTitle: string; InstallDirectory: string }>(file, 'SELECT ProductTitle, InstallDirectory FROM DbSet WHERE Installed = 1');
  const games: StoreGame[] = [];
  for (const r of rows) {
    if (!r.ProductTitle || !r.InstallDirectory) continue;
    // fuel.json (na pasta do jogo) diz o executável principal.
    const fuel = await fs
      .readFile(path.join(r.InstallDirectory, 'fuel.json'), 'utf8')
      .then((t) => JSON.parse(t.replace(/^\uFEFF/, '')) as { Main?: { Command?: string } })
      .catch(() => null);
    const command = fuel?.Main?.Command;
    games.push({ store: 'Amazon Games', title: r.ProductTitle, dir: r.InstallDirectory, exe: command ? path.join(r.InstallDirectory, command) : undefined });
  }
  return games;
}

export async function itchGames(appData: string): Promise<StoreGame[]> {
  const file = path.join(appData, 'itch', 'db', 'butler.db');
  if (!(await pathExists(file))) return [];
  const rows = readSqlite<{ title: string; root: string; folder: string }>(
    file,
    `SELECT g.title AS title, l.path AS root, c.install_folder_name AS folder
     FROM caves c JOIN games g ON g.id = c.game_id JOIN install_locations l ON l.id = c.install_location_id`,
  );
  return rows.filter((r) => r.title && r.root && r.folder).map((r) => ({ store: 'itch.io' as const, title: r.title, dir: path.join(r.root, r.folder) }));
}

// ---------- Executável e candidatos ----------

const MAX_EXE_SCAN = 400;

/** Sigla do título ("Counter-Strike 2" → "cs2"): muitos jogos usam o nome curto no executável. */
export const titleAcronym = (title: string) =>
  title
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => (/^\d+$/.test(w) ? w : w[0]!))
    .join('')
    .toLowerCase();

/** Executáveis do jogo (pasta e até 3 níveis abaixo), sem instaladores e auxiliares, do mais provável ao menos. */
async function rankedExecutables(dir: string, title: string): Promise<ExeInfo[]> {
  const found: ExeInfo[] = [];
  const walk = async (current: string, depth: number) => {
    if (found.length >= MAX_EXE_SCAN) return;
    for (const entry of await fs.readdir(current, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory() && depth < 3 && !/^(_commonredist|redist|redistributables|directx|support|__installer|installer)$/i.test(entry.name)) await walk(full, depth + 1);
      else if (entry.isFile() && /\.exe$/i.test(entry.name) && !isHelperExecutable(entry.name)) {
        found.push({ file: full, size: (await fs.stat(full).catch(() => null))?.size ?? 0 });
      }
    }
  };
  await walk(dir, 0);
  return rankExecutables(found, [title, path.basename(dir), titleAcronym(title)]);
}

/** Jogo da loja → candidato da revisão (o executável da loja, se existir; senão o mais provável da pasta). */
async function toCandidate(game: StoreGame, inLibrary: (p: string) => boolean): Promise<ScanCandidate | null> {
  if (!(await pathExists(game.dir))) return null; // registro velho de jogo desinstalado
  const ranked = await rankedExecutables(game.dir, game.title);
  const main = game.exe && (await pathExists(game.exe)) ? game.exe : ranked[0]?.file;
  if (!main) return null;
  const alternatives = ranked.map((e) => e.file).filter((f) => f.toLowerCase() !== main.toLowerCase());
  return {
    path: main,
    kind: 'executable',
    title: game.title,
    consoleId: null,
    alternatives,
    inLibrary: [main, ...alternatives].some((f) => inLibrary(f)),
    recommended: true,
    note: game.store,
    steamAppId: game.steamAppId ?? null,
  };
}

/** Todos os jogos das lojas instaladas, prontos para a revisão (os já na biblioteca vêm marcados). */
export async function scanStoreLibraries(deps: StoreLibraryDeps, libraryPaths: ReadonlySet<string>): Promise<ScanCandidate[]> {
  const readRegistry = deps.readRegistry ?? ((key: string) => exportRegistry(key, deps.tempDir));
  const lists = await Promise.all([
    steamGames({ ...deps, readRegistry }),
    epicGames(deps.programData),
    gogGames(readRegistry),
    ubisoftGames(readRegistry),
    amazonGames(deps.localAppData),
    itchGames(deps.appData),
  ]);
  const inLibrary = (p: string) => libraryPaths.has(p.toLowerCase());
  const candidates: ScanCandidate[] = [];
  const seen = new Set<string>();
  for (const game of lists.flat()) {
    const candidate = await toCandidate(game, inLibrary).catch(() => null);
    // O mesmo jogo em duas lojas (ou registrado duas vezes) entra uma vez.
    if (!candidate || seen.has(candidate.path.toLowerCase())) continue;
    seen.add(candidate.path.toLowerCase());
    candidates.push(candidate);
  }
  return candidates.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
}
