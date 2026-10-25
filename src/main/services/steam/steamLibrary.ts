// Jogos da Steam instalados neste PC, só pelos arquivos locais dela (sem login, sem API, sem escrever nada):
// steamapps\libraryfolders.vdf (pastas de biblioteca), appmanifest_<id>.acf (um por jogo), o cache de artes
// (appcache\librarycache) e o tempo de jogo de userdata\<conta>\config\localconfig.vdf.
import { promises as fs, realpath } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const realpathNative = promisify(realpath.native);

// ---------- KeyValues (VDF em texto) ----------

export interface Vdf {
  [key: string]: string | Vdf;
}

/**
 * Formato KeyValues da Valve: "chave" "valor" ou "chave" { ... }, comentários com //.
 * Tolerante: texto truncado devolve o que deu para ler; condicionais ([$WIN32]) são ignoradas.
 */
export function parseVdf(text: string): Vdf {
  let i = 0;
  const n = text.length;

  const next = (): string | '{' | '}' | null => {
    for (;;) {
      while (i < n && /\s/.test(text[i]!)) i++;
      if (text.startsWith('//', i)) {
        while (i < n && text[i] !== '\n') i++;
        continue;
      }
      break;
    }
    if (i >= n) return null;
    const ch = text[i]!;
    if (ch === '{' || ch === '}') {
      i++;
      return ch;
    }
    if (ch === '"') {
      let out = '';
      i++;
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < n) {
          const e = text[i + 1]!;
          out += e === 'n' ? '\n' : e === 't' ? '\t' : e;
          i += 2;
        } else out += text[i++];
      }
      i++; // aspas de fechamento
      return out;
    }
    const start = i;
    while (i < n && !/[\s{}"]/.test(text[i]!)) i++;
    return text.slice(start, i);
  };

  const readObject = (): Vdf => {
    const obj: Vdf = {};
    for (;;) {
      const key = next();
      if (key === null || key === '}') return obj;
      if (key === '{') continue; // chave ausente: ignora o bloco solto
      let value = next();
      while (typeof value === 'string' && value.startsWith('[$')) value = next(); // condicional
      if (value === null) return obj;
      if (value === '{') obj[key] = readObject();
      else if (value === '}') return obj;
      else {
        obj[key] = value;
        // Condicional depois do valor ("chave" "valor" [$WIN32]).
        const save = i;
        const after = next();
        if (!(typeof after === 'string' && after.startsWith('[$'))) i = save;
      }
    }
  };

  return readObject();
}

/** As chaves da Valve não diferenciam maiúsculas ("apps" / "Apps"). */
export function vdfGet(obj: Vdf | string | undefined, ...keys: string[]): Vdf | string | undefined {
  let cur: Vdf | string | undefined = obj;
  for (const key of keys) {
    if (!cur || typeof cur === 'string') return undefined;
    const lower = key.toLowerCase();
    const found: string | undefined = Object.keys(cur).find((k) => k.toLowerCase() === lower);
    cur = found === undefined ? undefined : cur[found];
  }
  return cur;
}

const vdfString = (obj: Vdf | string | undefined, ...keys: string[]) => {
  const v = vdfGet(obj, ...keys);
  return typeof v === 'string' ? v : undefined;
};

async function readVdf(file: string): Promise<Vdf | null> {
  const text = await fs.readFile(file, 'utf8').catch(() => null);
  return text === null ? null : parseVdf(text.replace(/^\uFEFF/, ''));
}

const exists = (p: string) => fs.stat(p).then(() => true, () => false);

// ---------- Pasta da Steam e bibliotecas ----------

/**
 * Primeira pasta que realmente tem uma instalação da Steam (com steamapps). O registro guarda em
 * minúsculas e com barras ("c:/program files (x86)/steam"): o realpath devolve a grafia real.
 */
export async function pickSteamRoot(candidates: readonly (string | null | undefined)[]): Promise<string | null> {
  for (const c of candidates) {
    if (!c) continue;
    const dir = path.normalize(c);
    if (await exists(path.join(dir, 'steamapps'))) return realpathNative(dir).catch(() => dir);
  }
  return null;
}

/** Pastas de biblioteca (a própria pasta da Steam e as de outros discos), sem repetição. */
export async function steamLibraryFolders(root: string): Promise<string[]> {
  const folders = [root];
  const vdf = (await readVdf(path.join(root, 'steamapps', 'libraryfolders.vdf'))) ?? (await readVdf(path.join(root, 'config', 'libraryfolders.vdf')));
  const list = vdfGet(vdf ?? undefined, 'libraryfolders');
  if (list && typeof list === 'object') {
    for (const [key, value] of Object.entries(list)) {
      if (!/^\d+$/.test(key)) continue;
      // Formato atual: { "path" "D:\\SteamLibrary" … }; antigo: "1" "D:\\SteamLibrary".
      const p = typeof value === 'string' ? value : vdfString(value, 'path');
      if (p) folders.push(path.normalize(p));
    }
  }
  const seen = new Set<string>();
  return folders.filter((f) => {
    const k = f.toLowerCase().replace(/[\\/]+$/, '');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------- Jogos instalados ----------

export interface SteamApp {
  appId: number;
  title: string;
  /** steamapps\common\<installdir> */
  dir: string;
  /** SteamID64 da conta que instalou (pasta userdata e tempo de jogo dela). */
  ownerSteamId: string | null;
  /** Epoch em segundos (0/ausente = nunca jogado). */
  lastPlayed: number | null;
}

/** Ferramentas da Steam que aparecem como "apps" instalados mas não são jogos. */
const STEAM_TOOL_IDS = new Set([228980, 250820, 1070560, 1391110, 1493710, 1628350]);
const STEAM_TOOL_NAME = /^(proton\b|steam linux runtime|steamworks common redistributables|steamvr\b)|dedicated server$|\bsdk$/i;

/** StateFlags bit 4 = totalmente instalado (pode ter outros bits: atualização pendente etc.). */
const FULLY_INSTALLED = 4;

function appFromManifest(library: string, vdf: Vdf | null): SteamApp | null {
  const state = vdfGet(vdf ?? undefined, 'AppState');
  if (!state || typeof state === 'string') return null;
  const appId = Number(vdfString(state, 'appid'));
  const title = vdfString(state, 'name')?.trim();
  const installdir = vdfString(state, 'installdir');
  const flags = Number(vdfString(state, 'StateFlags') ?? 0);
  if (!Number.isInteger(appId) || appId <= 0 || !title || !installdir) return null;
  if (!(flags & FULLY_INSTALLED)) return null; // baixando ou pela metade
  if (STEAM_TOOL_IDS.has(appId) || STEAM_TOOL_NAME.test(title)) return null;
  const lastPlayed = Number(vdfString(state, 'LastPlayed') ?? 0);
  return {
    appId,
    title,
    dir: path.join(library, 'steamapps', 'common', installdir),
    ownerSteamId: vdfString(state, 'LastOwner')?.match(/^\d{17}$/)?.[0] ?? null,
    lastPlayed: lastPlayed > 0 ? lastPlayed : null,
  };
}

/** Todos os jogos instalados em todas as bibliotecas (o mesmo id em duas bibliotecas entra uma vez). */
export async function steamApps(root: string): Promise<SteamApp[]> {
  const apps = new Map<number, SteamApp>();
  for (const library of await steamLibraryFolders(root)) {
    const dir = path.join(library, 'steamapps');
    for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
      if (!/^appmanifest_\d+\.acf$/i.test(name)) continue;
      const app = appFromManifest(library, await readVdf(path.join(dir, name)));
      if (app && !apps.has(app.appId) && (await exists(app.dir))) apps.set(app.appId, app);
    }
  }
  return [...apps.values()];
}

/** Um jogo pelo id (para arte e tempo de jogo depois de adicionado). */
export async function findSteamApp(root: string, appId: number): Promise<SteamApp | null> {
  for (const library of await steamLibraryFolders(root)) {
    const app = appFromManifest(library, await readVdf(path.join(library, 'steamapps', `appmanifest_${appId}.acf`)));
    if (app) return app;
  }
  return null;
}

// ---------- Arte (cache local da Steam) ----------

export interface SteamArtwork {
  cover: string | null;
  background: string | null;
}

// Do melhor para o pior. A capa vertical é "library_600x900" (antiga) ou "library_capsule" (nova, numa subpasta).
const COVER_NAMES = ['library_600x900_2x.jpg', 'library_600x900.jpg', 'library_capsule_2x.jpg', 'library_capsule.jpg'];
const BACKGROUND_NAMES = ['library_hero_2x.jpg', 'library_hero.jpg'];

/** Capa e fundo que a Steam já baixou: pasta librarycache\<id>\ (e subpastas) ou o formato antigo <id>_nome.jpg. */
export async function steamArtwork(root: string, appId: number): Promise<SteamArtwork> {
  const cache = path.join(root, 'appcache', 'librarycache');
  const files: { name: string; full: string; mtime: number }[] = [];
  const walk = async (dir: string, depth: number) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && depth < 1) await walk(full, depth + 1);
      else if (entry.isFile()) files.push({ name: entry.name.toLowerCase(), full, mtime: (await fs.stat(full).catch(() => null))?.mtimeMs ?? 0 });
    }
  };
  await walk(path.join(cache, String(appId)), 0);
  for (const name of [...COVER_NAMES, ...BACKGROUND_NAMES]) {
    const flat = path.join(cache, `${appId}_${name}`);
    const stat = await fs.stat(flat).catch(() => null);
    if (stat?.isFile()) files.push({ name, full: flat, mtime: stat.mtimeMs });
  }
  // Arte trocada pela Valve deixa a antiga numa outra subpasta: vale a mais recente.
  const best = (names: string[]) => {
    for (const name of names) {
      const match = files.filter((f) => f.name === name).sort((a, b) => b.mtime - a.mtime)[0];
      if (match) return match.full;
    }
    return null;
  };
  return { cover: best(COVER_NAMES), background: best(BACKGROUND_NAMES) };
}

// ---------- Tempo de jogo ----------

/** SteamID64 → id da conta (nome da pasta em userdata). */
const STEAM_ID64_BASE = 76561197960265728n;

export interface SteamPlaytime {
  seconds: number;
  lastPlayedAt: string | null;
}

/**
 * Tempo de jogo que a Steam registrou para a conta dona do jogo. O localconfig.vdf tem outros dados da
 * conta: só "Playtime" e "LastPlayed" do jogo são lidos, e nada dele é registrado em log.
 */
export async function steamPlaytime(root: string, app: Pick<SteamApp, 'appId' | 'ownerSteamId' | 'lastPlayed'>): Promise<SteamPlaytime | null> {
  let minutes = 0;
  let lastPlayed = app.lastPlayed ?? 0;
  if (app.ownerSteamId) {
    const account = (BigInt(app.ownerSteamId) - STEAM_ID64_BASE).toString();
    const config = await readVdf(path.join(root, 'userdata', account, 'config', 'localconfig.vdf'));
    const entry = vdfGet(config ?? undefined, 'UserLocalConfigStore', 'Software', 'Valve', 'Steam', 'apps', String(app.appId));
    if (entry && typeof entry === 'object') {
      minutes = Math.max(0, Math.floor(Number(vdfString(entry, 'Playtime') ?? 0)) || 0);
      lastPlayed = Math.max(lastPlayed, Number(vdfString(entry, 'LastPlayed') ?? 0) || 0);
    }
  }
  if (minutes === 0 && lastPlayed === 0) return null;
  return { seconds: minutes * 60, lastPlayedAt: lastPlayed > 0 ? new Date(lastPlayed * 1000).toISOString() : null };
}

// ---------- Abrir pela Steam ----------

/** O jogo abre pela própria Steam (DRM, overlay, nuvem e conquistas dela continuam valendo). */
export const steamRunUrl = (appId: number) => `steam://rungameid/${appId}`;

/** Pasta do jogo (steamapps\common\<jogo>), mesmo que o .exe esteja numa subpasta (bin\win64…). */
export function steamGameDir(exePath: string): string {
  const m = exePath.match(/^(.*?[\\/]steamapps[\\/]common[\\/][^\\/]+)/i);
  return m ? m[1]! : path.dirname(exePath);
}
