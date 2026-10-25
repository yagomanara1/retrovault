import { type Dirent, promises as fs } from 'node:fs';
import path from 'node:path';
import type { Game } from '@shared/types';
import { parseArgs } from '../fsUtils';

// Descobre o sce_sys/trophy/trophy00.trp de um jogo de PS4 sem perguntar nada ao usuário.
//
// Estratégias, da mais direta para a mais indireta:
//   1. game-path       o arquivo do jogo está dentro do dump (eboot.bin, exe dentro da pasta CUSA…)
//   2. launch-args     um argumento aponta para o dump (ex.: shadPS4.exe -g "C:\…\CUSA01623\eboot.bin")
//   3. nearby          dump ao lado do executável (padrão dos ports: <port>\..\CUSA01623)
//   4. launcher-config caminho salvo pelo launcher do port (ex.: %APPDATA%\gow3-launcher\settings.json → game_dir)
//
// As estratégias 3 e 4 podem achar dumps de outros jogos, então só valem quando o Title ID do dump
// aparece perto do executável (saves em user\savedata\1\CUSA01623, log "Patches: CUSA01623"…)
// ou quando o nome do launcher bate com um arquivo do port (gow3-launcher ↔ gow3.ini).

export type TrpLocationSource = 'game-path' | 'launch-args' | 'nearby' | 'launcher-config';

export interface TrpLocation {
  trpPath: string;
  dumpDir: string;
  titleId: string | null;
  source: TrpLocationSource;
}

const TRP_RELATIVE = path.join('sce_sys', 'trophy', 'trophy00.trp');
/** CUSA01623, PLAS00001… (prefixos de Title ID do PS4 + 5 dígitos). */
const TITLE_ID_SOURCE = String.raw`\b(?:CUSA|PLAS|PCAS|PCJS|PLJM|PLJS|PCKS)\d{5}\b`;
const TITLE_ID = new RegExp(TITLE_ID_SOURCE, 'g');
const HAS_TITLE_ID = new RegExp(TITLE_ID_SOURCE);
/** Arquivos que dão nome ao port (gow3.ini, God of War III.exe); README/LICENSE não contam. */
const STEM_EXTENSIONS = new Set(['.exe', '.ini', '.json', '.toml', '.cfg']);
const MAX_ANCESTORS = 6;
const MAX_DIR_ENTRIES = 500;
const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_LOG_HEAD_BYTES = 256 * 1024;
const CONFIG_FILES = ['settings.json', 'config.json', 'config.toml', path.join('user', 'config.toml')];
const LOG_FILES = [path.join('user', 'last_run.log'), path.join('user', 'log', 'shad_log.txt')];

interface Candidate {
  dumpDir: string;
  source: TrpLocationSource;
  /** Para launcher-config: nome da pasta do launcher (gow3-launcher). */
  origin?: string;
}

const exists = (p: string, kind: 'file' | 'dir') =>
  fs
    .stat(p)
    .then((s) => (kind === 'file' ? s.isFile() : s.isDirectory()))
    .catch(() => false);

const hasTrp = (dir: string) => exists(path.join(dir, TRP_RELATIVE), 'file');

async function readDirSafe(dir: string): Promise<Dirent[]> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).slice(0, MAX_DIR_ENTRIES);
  } catch {
    return [];
  }
}

async function readHead(file: string, maxBytes: number): Promise<string | null> {
  let fh: fs.FileHandle | null = null;
  try {
    fh = await fs.open(file, 'r');
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await fh.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
}

const isRoot = (dir: string) => path.dirname(dir) === dir;

/** Sobe a árvore a partir de um arquivo/pasta procurando a raiz do dump. */
async function findDumpAbove(start: string): Promise<string | null> {
  let dir = (await exists(start, 'dir')) ? start : path.dirname(start);
  for (let i = 0; i < MAX_ANCESTORS; i++) {
    if (await hasTrp(dir)) return dir;
    if (isRoot(dir)) break;
    dir = path.dirname(dir);
  }
  return null;
}

/** Lê TITLE_ID do sce_sys/param.sfo (formato PSF, little-endian). */
export function readSfoString(data: Buffer, wanted: string): string | null {
  if (data.length < 0x14 || data.readUInt32BE(0) !== 0x00505346) return null;
  const keyTable = data.readUInt32LE(0x08);
  const dataTable = data.readUInt32LE(0x0c);
  const count = data.readUInt32LE(0x10);
  for (let i = 0; i < count && 0x14 + (i + 1) * 16 <= data.length; i++) {
    const at = 0x14 + i * 16;
    const keyStart = keyTable + data.readUInt16LE(at);
    const keyEnd = data.indexOf(0, keyStart);
    if (keyEnd < 0 || data.toString('latin1', keyStart, keyEnd) !== wanted) continue;
    const length = data.readUInt32LE(at + 4);
    const start = dataTable + data.readUInt32LE(at + 12);
    if (start + length > data.length) return null;
    return data.toString('utf8', start, start + length).replace(/\0+$/, '') || null;
  }
  return null;
}

async function dumpTitleId(dumpDir: string): Promise<string | null> {
  try {
    const sfo = await fs.readFile(path.join(dumpDir, 'sce_sys', 'param.sfo'));
    const id = readSfoString(sfo, 'TITLE_ID');
    if (id) return id;
  } catch {
    // sem param.sfo: tenta pelo nome da pasta
  }
  return [...dumpDir.toUpperCase().matchAll(TITLE_ID)].pop()?.[0] ?? null;
}

/** Strings que parecem caminhos absolutos do Windows/Unix dentro de um JSON/TOML/INI. */
function pathsInText(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/"((?:[A-Za-z]:|\\\\|\/)(?:[^"\\]|\\.)*)"|'((?:[A-Za-z]:|\/)[^']*)'/g)) {
    const raw = m[1] ?? m[2];
    if (!raw) continue;
    // Strings JSON/TOML básicas escapam a barra invertida.
    const value = m[1] !== undefined ? raw.replace(/\\\\/g, '\\').replace(/\\\//g, '/') : raw;
    if (value.length > 3) found.add(value);
  }
  return [...found];
}

export class TrpLocator {
  /** @param configRoots pastas onde launchers guardam configuração (normalmente %APPDATA%). */
  constructor(private readonly configRoots: readonly string[]) {}

  async locate(game: Pick<Game, 'path' | 'launchArgs'>): Promise<TrpLocation | null> {
    const direct = await this.directCandidates(game);
    if (direct.length > 0) return this.resolve(direct[0]!);

    const exeDir = path.dirname(game.path);
    const indirect = [...(await this.nearbyCandidates(exeDir)), ...(await this.configCandidates(exeDir))];
    if (indirect.length === 0) return null;

    const hints = await this.titleHints(game, exeDir);
    const stems = await this.portStems(game.path, exeDir);
    const nearbyOnly = indirect.filter((c) => c.source === 'nearby');

    for (const candidate of indirect) {
      const location = await this.resolve(candidate);
      if (location.titleId && hints.has(location.titleId)) return location;
      if (candidate.origin && stems.has(launcherKey(candidate.origin))) return location;
    }
    // Sem pistas de Title ID: um único dump ao lado do executável é inequívoco.
    return nearbyOnly.length === 1 && hints.size === 0 ? this.resolve(nearbyOnly[0]!) : null;
  }

  private async resolve(c: Candidate): Promise<TrpLocation> {
    return {
      trpPath: path.join(c.dumpDir, TRP_RELATIVE),
      dumpDir: c.dumpDir,
      titleId: await dumpTitleId(c.dumpDir),
      source: c.source,
    };
  }

  private async directCandidates(game: Pick<Game, 'path' | 'launchArgs'>): Promise<Candidate[]> {
    const fromPath = await findDumpAbove(game.path);
    if (fromPath) return [{ dumpDir: fromPath, source: 'game-path' }];

    for (const arg of parseArgs(game.launchArgs)) {
      // Aceita "-g=C:\…" e "--game C:\…".
      const value = arg.replace(/^-{1,2}[\w-]+=/, '');
      if (!path.isAbsolute(value)) continue;
      const dump = await findDumpAbove(value);
      if (dump) return [{ dumpDir: dump, source: 'launch-args' }];
    }
    return [];
  }

  /** Dumps na pasta do executável e na pasta acima (até 2 níveis para baixo). */
  private async nearbyCandidates(exeDir: string): Promise<Candidate[]> {
    const roots = [exeDir];
    if (!isRoot(path.dirname(exeDir))) roots.push(path.dirname(exeDir));

    const found = new Map<string, Candidate>();
    for (const root of roots) {
      for (const child of await readDirSafe(root)) {
        if (!child.isDirectory()) continue;
        const dir = path.join(root, child.name);
        if (await hasTrp(dir)) {
          found.set(dir.toLowerCase(), { dumpDir: dir, source: 'nearby' });
          continue;
        }
        // Ex.: CUSA01623_1\CUSA01623 (pasta extraída de um .rar).
        if (!HAS_TITLE_ID.test(child.name.toUpperCase())) continue;
        for (const inner of await readDirSafe(dir)) {
          const innerDir = path.join(dir, inner.name);
          if (inner.isDirectory() && (await hasTrp(innerDir))) {
            found.set(innerDir.toLowerCase(), { dumpDir: innerDir, source: 'nearby' });
          }
        }
      }
    }
    return [...found.values()];
  }

  /** Caminhos de jogo salvos em configs de launchers (%APPDATA%\<launcher>\settings.json…) e do próprio port. */
  private async configCandidates(exeDir: string): Promise<Candidate[]> {
    const files: { file: string; origin?: string }[] = CONFIG_FILES.map((f) => ({ file: path.join(exeDir, f) }));
    for (const root of this.configRoots) {
      for (const entry of await readDirSafe(root)) {
        if (!entry.isDirectory()) continue;
        for (const f of CONFIG_FILES) files.push({ file: path.join(root, entry.name, f), origin: entry.name });
      }
    }

    const found = new Map<string, Candidate>();
    for (const { file, origin } of files) {
      const stat = await fs.stat(file).catch(() => null);
      if (!stat?.isFile() || stat.size > MAX_CONFIG_BYTES) continue;
      const text = await fs.readFile(file, 'utf8').catch(() => '');
      for (const p of pathsInText(text)) {
        const dump = await this.dumpsAt(p);
        for (const dir of dump) found.set(dir.toLowerCase(), { dumpDir: dir, source: 'launcher-config', origin });
      }
    }
    return [...found.values()];
  }

  /** O caminho é um dump, ou uma pasta de biblioteca com vários dumps (installDirs do shadPS4). */
  private async dumpsAt(p: string): Promise<string[]> {
    if (!(await exists(p, 'dir'))) {
      const above = (await exists(p, 'file')) ? await findDumpAbove(p) : null;
      return above ? [above] : [];
    }
    if (await hasTrp(p)) return [p];
    const dumps: string[] = [];
    for (const child of await readDirSafe(p)) {
      const dir = path.join(p, child.name);
      if (child.isDirectory() && (await hasTrp(dir))) dumps.push(dir);
    }
    return dumps;
  }

  /** Title IDs citados perto do executável: nomes de pastas de save, argumentos e início dos logs. */
  private async titleHints(game: Pick<Game, 'path' | 'launchArgs'>, exeDir: string): Promise<Set<string>> {
    const texts = [game.path, game.launchArgs ?? ''];
    for (const dir of [exeDir, path.join(exeDir, 'user', 'savedata'), path.join(exeDir, 'user', 'game_data')]) {
      for (const entry of await readDirSafe(dir)) {
        texts.push(entry.name);
        // user\savedata\<usuário>\CUSA01623
        if (entry.isDirectory() && dir.endsWith('savedata')) {
          texts.push(...(await readDirSafe(path.join(dir, entry.name))).map((e) => e.name));
        }
      }
    }
    for (const log of LOG_FILES) texts.push((await readHead(path.join(exeDir, log), MAX_LOG_HEAD_BYTES)) ?? '');

    const hints = new Set<string>();
    for (const text of texts) for (const m of text.toUpperCase().matchAll(TITLE_ID)) hints.add(m[0]);
    return hints;
  }

  /** Nomes que identificam o port: gow3.ini → "gow3", "God of War III.exe" → "godofwariii". */
  private async portStems(gamePath: string, exeDir: string): Promise<Set<string>> {
    const stems = new Set([normalizeStem(path.basename(gamePath, path.extname(gamePath)))]);
    for (const entry of await readDirSafe(exeDir)) {
      if (entry.isFile() && STEM_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) stems.add(normalizeStem(path.basename(entry.name, path.extname(entry.name))));
    }
    stems.delete('');
    return stems;
  }
}

const normalizeStem = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
/** "gow3-launcher" → "gow3"; "Bloodborne Launcher" → "bloodborne". */
const launcherKey = (dirName: string) => normalizeStem(dirName.replace(/[-_ ]?(launcher|gui|app)$/i, ''));
