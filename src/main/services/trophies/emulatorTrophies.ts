// Troféus que os emuladores de PlayStation já guardam: RPCS3 (PS3) e Vita3K (PS Vita).
// O emulador registra cada desbloqueio no TROPUSR.DAT; aqui só lemos (nada é escrito nas pastas dele).
// Formatos conferidos no código de cada emulador:
//   RPCS3  rpcs3/Loader/TROPUSR.{h,cpp}: big-endian, assinatura 818F54AD, cabeçalho de 48 bytes, tabelas de
//          32 bytes a partir de 0x30; a tabela tipo 6 tem uma entrada de 112 bytes por troféu (id no byte 16,
//          estado no 20, data no 40, em microssegundos desde o ano 1, o CellRtcTick do PS3).
//   Vita3K vita3k/np/src/trophy/context.cpp: assinatura 12D5819A (little-endian), 128 bits de "desbloqueado"
//          logo depois, e a partir do byte 112 as datas (segundos Unix, 8 bytes por troféu).
// Ideia trazida do Taiga Launcher (GabrielTaiga, Apache-2.0); código escrito do zero.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Game } from '@shared/types';
import { parseArgs } from '../fsUtils';
import { parseTrophyXml, type ParsedTrophy } from './trp';

export type TrophyEmulator = 'rpcs3' | 'vita3k';

/** Estado de um troféu no emulador: desbloqueado e quando (null se o emulador não guardou a data). */
export interface EmulatorUnlock {
  unlocked: boolean;
  at: Date | null;
}

const RPCS3_MAGIC = 0x818f54ad;
const VITA3K_MAGIC = 0x12d5819a;
/** Segundos entre 0001-01-01 e 1970-01-01 (o relógio do PS3 conta do ano 1). */
const RTC_EPOCH_OFFSET_S = 62_135_596_800;
const MAX_PROGRESS_BYTES = 4 * 1024 * 1024;
const MAX_XML_BYTES = 8 * 1024 * 1024;
const NPWR = /^NPWR\d{5}_\d{2}$/i;

/** CellRtcTick (microssegundos desde o ano 1) → data; 0 = sem data. */
export function rtcTickToDate(tick: bigint): Date | null {
  if (tick <= 0n) return null;
  const ms = Number(tick / 1000n) - RTC_EPOCH_OFFSET_S * 1000;
  return ms > 0 ? new Date(ms) : null;
}

/** TROPUSR.DAT do RPCS3: estado de cada troféu (tabela tipo 6). */
export function parseRpcs3Progress(data: Buffer): Map<number, EmulatorUnlock> {
  if (data.length < 48 || data.readUInt32BE(0) !== RPCS3_MAGIC) throw new Error('TROPUSR.DAT do RPCS3 inválido');
  const tables = data.readUInt32BE(8);
  if (tables > 32 || 0x30 + tables * 32 > data.length) throw new Error('índice do TROPUSR.DAT inválido');
  const out = new Map<number, EmulatorUnlock>();
  for (let t = 0; t < tables; t++) {
    const head = 0x30 + t * 32;
    if (data.readUInt32BE(head) !== 6) continue;
    const stride = data.readUInt32BE(head + 4) + 16; // tamanho do conteúdo + cabeçalho da entrada
    const count = data.readUInt32BE(head + 12);
    const offset = Number(data.readBigUInt64BE(head + 16));
    if (stride < 48 || count > 4096 || offset + count * stride > data.length) throw new Error('tabela de troféus do TROPUSR.DAT truncada');
    for (let i = 0; i < count; i++) {
      const at = offset + i * stride;
      const unlocked = data.readUInt32BE(at + 20) === 1;
      out.set(data.readUInt32BE(at + 16), { unlocked, at: unlocked ? rtcTickToDate(data.readBigUInt64BE(at + 40)) : null });
    }
  }
  return out;
}

/** TROPUSR.DAT do Vita3K: até 128 troféus. */
export function parseVita3kProgress(data: Buffer): Map<number, EmulatorUnlock> {
  if (data.length < 20 || data.readUInt32LE(0) !== VITA3K_MAGIC) throw new Error('TROPUSR.DAT do Vita3K inválido');
  const out = new Map<number, EmulatorUnlock>();
  for (let id = 0; id < 128; id++) {
    const unlocked = (data.readUInt32LE(4 + (id >> 5) * 4) & (1 << (id & 31))) !== 0;
    if (!unlocked) continue;
    const at = 112 + id * 8;
    const seconds = at + 8 <= data.length ? Number(data.readBigUInt64LE(at)) : 0;
    out.set(id, { unlocked: true, at: seconds > 0 ? new Date(seconds * 1000) : null });
  }
  return out;
}

export function parseProgress(emulator: TrophyEmulator, data: Buffer): Map<number, EmulatorUnlock> {
  return emulator === 'rpcs3' ? parseRpcs3Progress(data) : parseVita3kProgress(data);
}

const exists = (p: string) => fs.stat(p).then(() => true, () => false);
const isDir = (p: string) => fs.stat(p).then((s) => s.isDirectory(), () => false);
const list = (p: string) => fs.readdir(p).catch(() => [] as string[]);

async function readLimited(file: string, max: number): Promise<Buffer> {
  const { size } = await fs.stat(file);
  if (size > max) throw new Error(`${path.basename(file)} grande demais`);
  return fs.readFile(file);
}

/** Lê o TROPUSR.DAT; null se ainda não existir (o emulador cria ao abrir o jogo ou no primeiro troféu). */
export async function readProgressFile(emulator: TrophyEmulator, file: string): Promise<Map<number, EmulatorUnlock> | null> {
  const data = await readLimited(file, MAX_PROGRESS_BYTES).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return null;
    throw err;
  });
  return data ? parseProgress(emulator, data) : null;
}

/** Lista de troféus de uma pasta de emulador (TROPCONF + o primeiro idioma que houver). */
export interface TrophyFolder {
  title: string | null;
  trophies: ParsedTrophy[];
}

export async function readTrophyFolder(folder: string, languages: readonly string[]): Promise<TrophyFolder> {
  const conf = parseTrophyXml((await readLimited(path.join(folder, 'TROPCONF.SFM'), MAX_XML_BYTES)).toString('utf8'));
  let localized: ReturnType<typeof parseTrophyXml> | null = null;
  for (const lang of languages) {
    const file = path.join(folder, `${lang}.SFM`);
    if (!(await exists(file))) continue;
    const parsed = parseTrophyXml((await readLimited(file, MAX_XML_BYTES)).toString('utf8'));
    if (parsed.trophies.length) {
      localized = parsed;
      break;
    }
  }
  const names = new Map((localized?.trophies ?? []).map((t) => [t.id, t]));
  return {
    title: localized?.title ?? conf.title,
    trophies: conf.trophies.map((t) => ({ ...t, name: names.get(t.id)?.name ?? t.name, detail: names.get(t.id)?.detail ?? t.detail })),
  };
}

/** Onde estão os troféus de um jogo no emulador. */
export interface EmulatorTrophyLocation {
  emulator: TrophyEmulator;
  npCommId: string;
  /** Pasta com TROPCONF.SFM, idiomas e ícones. */
  folder: string;
  /** TROPUSR.DAT (pode ainda não existir: o emulador cria no primeiro desbloqueio ou abertura). */
  progressPath: string;
}

const titleKey = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/[^a-z0-9]+/g, '');

// ---------- RPCS3 ----------

/** dev_hdd0 do RPCS3: o do vfs.yml (se mudado de lugar) ou o padrão, ao lado do rpcs3.exe. */
async function rpcs3Hdd(root: string): Promise<string> {
  for (const vfs of [path.join(root, 'config', 'vfs.yml'), path.join(root, 'vfs.yml')]) {
    const text = await fs.readFile(vfs, 'utf8').catch(() => null);
    const value = text?.match(/^\s*["']?\/dev_hdd0\/?["']?\s*:\s*["']?([^\r\n"']+)/m)?.[1]?.trim();
    if (value) {
      const expanded = value.replace(/\$\(EmulatorDir\)/g, root + path.sep);
      return path.isAbsolute(expanded) ? expanded : path.resolve(root, expanded);
    }
  }
  return path.join(root, 'dev_hdd0');
}

/** Conjuntos de troféus do jogo: pastas NPWR… em TROPDIR (disco: PS3_GAME\TROPDIR; jogo da PSN: <ID>\TROPDIR). */
async function ps3TrophyIds(target: string): Promise<string[]> {
  let dir = (await isDir(target)) ? target : path.dirname(target);
  for (let i = 0; i < 6; i++) {
    for (const candidate of [path.join(dir, 'PS3_GAME', 'TROPDIR'), path.join(dir, 'TROPDIR')]) {
      const ids = (await list(candidate)).filter((n) => NPWR.test(n));
      if (ids.length) return ids.map((n) => n.toUpperCase());
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return [];
}

async function locateRpcs3(game: Game): Promise<EmulatorTrophyLocation | null> {
  const root = path.dirname(game.path);
  const users = path.join(await rpcs3Hdd(root), 'home');
  const trophyDirs = (await list(users)).filter((u) => /^\d{8}$/.test(u)).map((u) => path.join(users, u, 'trophy'));
  const sets = async (ids: readonly string[] | null) => {
    const found: EmulatorTrophyLocation[] = [];
    for (const base of trophyDirs) {
      for (const name of await list(base)) {
        if (!NPWR.test(name) || (ids && !ids.includes(name.toUpperCase()))) continue;
        const folder = path.join(base, name);
        if (await exists(path.join(folder, 'TROPCONF.SFM'))) found.push({ emulator: 'rpcs3', npCommId: name.toUpperCase(), folder, progressPath: path.join(folder, 'TROPUSR.DAT') });
      }
    }
    return found;
  };
  // 1) Pelo jogo nos argumentos (EBOOT.BIN ou pasta do jogo): o ID exato dos troféus.
  for (const arg of parseArgs(game.launchArgs)) {
    if (!path.isAbsolute(arg) || !(await exists(arg))) continue;
    const ids = await ps3TrophyIds(arg);
    if (ids.length) return (await sets(ids))[0] ?? null;
  }
  // 2) Sem o jogo nos argumentos (ex.: uma ISO): pelo nome, só se um único conjunto bater.
  const key = titleKey(game.title);
  const byTitle: EmulatorTrophyLocation[] = [];
  for (const set of await sets(null)) {
    const title = (await readTrophyFolder(set.folder, ['TROP']).catch(() => null))?.title;
    if (title && titleKey(title) === key) byTitle.push(set);
  }
  return byTitle.length === 1 ? byTitle[0]! : null;
}

// ---------- Vita3K ----------

/** Pastas de dados do Vita3K: a do config.yml (pref-path), a portátil (ux0 ao lado do .exe) e a padrão. */
async function vita3kPrefPaths(exeDir: string, appDataDir: string): Promise<string[]> {
  const out: string[] = [];
  for (const config of [path.join(exeDir, 'config.yml'), path.join(appDataDir, 'Vita3K', 'Vita3K', 'config.yml')]) {
    const pref = (await fs.readFile(config, 'utf8').catch(() => null))?.match(/^pref-path:\s*["']?([^"'\r\n]*)/m)?.[1]?.trim();
    if (pref) out.push(pref);
  }
  out.push(exeDir, path.join(appDataDir, 'Vita3K', 'Vita3K'));
  const unique: string[] = [];
  for (const p of out.map((p) => path.resolve(p))) if (!unique.includes(p) && (await isDir(path.join(p, 'ux0')))) unique.push(p);
  return unique;
}

async function locateVita3k(game: Game, appDataDir: string): Promise<EmulatorTrophyLocation | null> {
  const args = parseArgs(game.launchArgs);
  const titleId = args.find((a, i) => /^[A-Z]{4}\d{5}$/.test(a) && (args[i - 1] === '-r' || args[i - 1] === '--app-path')) ?? args.find((a) => /^[A-Z]{4}\d{5}$/.test(a));
  if (!titleId) return null;
  for (const pref of await vita3kPrefPaths(path.dirname(game.path), appDataDir)) {
    const ids = (await list(path.join(pref, 'ux0', 'app', titleId, 'sce_sys', 'trophy'))).filter((n) => NPWR.test(n)).map((n) => n.toUpperCase());
    const usersDir = path.join(pref, 'ux0', 'user');
    for (const user of await list(usersDir)) {
      for (const id of ids) {
        const folder = path.join(usersDir, user, 'trophy', 'conf', id);
        if (await exists(path.join(folder, 'TROPCONF.SFM'))) {
          return { emulator: 'vita3k', npCommId: id, folder, progressPath: path.join(usersDir, user, 'trophy', 'data', id, 'TROPUSR.DAT') };
        }
      }
    }
  }
  return null;
}

/**
 * Troféus do jogo no emulador, se ele for aberto pelo rpcs3.exe ou Vita3K.exe. null se não for de um
 * deles ou se o emulador ainda não criou a pasta (o jogo nunca rodou nele: tenta de novo depois).
 */
export async function locateEmulatorTrophies(game: Game, appDataDir: string): Promise<EmulatorTrophyLocation | null> {
  if (game.kind !== 'executable') return null;
  const exe = path.basename(game.path, path.extname(game.path)).toLowerCase();
  if (exe === 'rpcs3') return locateRpcs3(game);
  if (exe === 'vita3k') return locateVita3k(game, appDataDir);
  return null;
}
