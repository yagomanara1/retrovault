import { type Dirent, promises as fs } from 'node:fs';
import path from 'node:path';
import { ConsoleId, DISC_IMAGE_EXTENSIONS, ROM_EXTENSIONS } from '@shared/consoles';
import type { ScanCandidate, ScanProgress, ScanResult } from '@shared/types';
import { AppError } from '../errors';
import { detectDiscConsole } from './disc/raDiscHash';
import { titleFromPath } from './fsUtils';
import { consoleFromExtension } from './romHasher';

// Varre uma pasta e sugere jogos para adicionar de uma vez.
//  - Jogos de PC / ports: a primeira pasta com um executável válido é a raiz do jogo; não descemos
//    mais nela (bin\gow3-probe.exe, _internal\… ficam de fora). O executável principal é escolhido
//    por nome parecido com o das pastas e por tamanho; os outros válidos viram alternativas.
//  - ROMs: extensão específica (.sfc → SNES) ou genérica (.chd, .iso, .zip…) com o console deduzido
//    do nome da pasta (PS1\, SNES\…) ou, nas imagens de disco, do conteúdo do disco (SYSTEM.CNF, PSP_GAME,
//    cabeçalho da Sega). Sem pista de console, .bin/.iso/.zip são ignorados: em pastas de jogos de PC quase
//    sempre são dados, não ROMs.
//  - Dumps de PS4 (sce_sys/eboot.bin) são ignorados: não são executáveis; o port ao lado é que roda.

const MAX_DEPTH = 8;
const MAX_DIRS = 50_000;
const MAX_CANDIDATES = 5_000;
const TIME_BUDGET_MS = 60_000;
const PROGRESS_INTERVAL_MS = 200;

const SKIP_DIRS = new Set([
  'node_modules', '.git', '$recycle.bin', 'system volume information', 'windows', 'appdata', '__pycache__',
  '_internal', '_commonredist', 'redist', 'redistributables', 'directx', 'vcredist', 'dotnet', 'prereqs',
  'shader', 'shadercache', 'cache', 'savedata', 'savedata_backups', 'saves', 'screenshots', 'logs',
  'sce_sys', 'sce_module',
]);

/** Executáveis que não são o jogo: instaladores, auxiliares, runtimes, binários internos de ports. */
// Padrões específicos de propósito: "crash\w*" esconderia CrashBandicoot.exe; "be\w*", Bejeweled.exe.
// Curingas aceitam "." e "-": "vc_redist.x64", "bb-gpu-capabilities" (\w* sozinho não casava).
const W = String.raw`[\w.-]*`;
const HELPER_EXE = new RegExp(
  String.raw`^(unins\d*|uninstall${W}|setup${W}|${W}installer|install${W}|pkginstall|vc_?redist${W}|dxsetup|dxwebsetup|directx${W}|dotnet${W}|ndp\d+${W}|oalinst|physx${W}|ue\dprereq${W}|easyanticheat${W}|beservice${W}|belauncher|${W}crash_?(handler|report(er)?|pad|sender)${W}|bugreport${W}|uploader|updater?|patcher|config(urator|tool)?|settings|${W}helper|${W}-probe|${W}-capabilities|cefprocess|python${W}|7z${W}|unrar|quicksfv|${W}dedicated_?server|${W}benchmark|dxdiag)$`,
  'i',
);

/** Emuladores e frontends: são ferramentas, não jogos (e a pasta deles não é varrida). */
const EMULATOR_EXE =
  /^(retroarch|pcsx2\w*|duckstation\w*|ppsspp\w*|dolphin\w*|rpcs3|shadps4\w*|yuzu|ryujinx|suyu|sudachi|cemu|xenia\w*|citra\w*|lime3ds|melonds|desmume\w*|mgba\w*|snes9x\w*|project64|mupen64\w*|mame\w*|fbneo|redream|flycast|xemu|vita3k|azahar|bsnes\w*|mesen\w*|epsxe|visualboyadvance\w*|steam|epicgameslauncher|gog(galaxy)?|playnite\w*|launchbox|retrovault)$/i;

/** Nomes genéricos: o título vem da pasta ("Pokemon Platinum\main.exe" → "Pokemon Platinum"). */
const GENERIC_EXE = /^(main|game|start|launch(er)?|play|run|app|client|bin|win(32|64)?|x64|release|shipping)$/i;

/** Pistas de console no nome da pasta, para extensões genéricas. */
const FOLDER_CONSOLE: [RegExp, number][] = [
  [/^(psx|ps1|playstation( ?1)?|sony playstation)$/i, ConsoleId.PlayStation],
  [/^(ps2|playstation ?2)$/i, ConsoleId.PS2],
  [/^(gamecube|gc|ngc|nintendo gamecube)$/i, ConsoleId.GameCube],
  [/^(wii|nintendo wii)$/i, ConsoleId.Wii],
  [/^(psp|playstation portable)$/i, ConsoleId.PSP],
  [/^(snes|super nintendo|super famicom|sfc)$/i, ConsoleId.SNES],
  [/^(nes|famicom)$/i, ConsoleId.NES],
  [/^(n64|nintendo 64)$/i, ConsoleId.N64],
  [/^(gba|game ?boy advance)$/i, ConsoleId.GBA],
  [/^(gbc|game ?boy colou?r)$/i, ConsoleId.GBC],
  [/^(gb|game ?boy)$/i, ConsoleId.GameBoy],
  [/^(nds|ds|nintendo ds)$/i, ConsoleId.NDS],
  [/^(genesis|mega ?drive|md|sega genesis)$/i, ConsoleId.Genesis],
  [/^(sega ?cd|mega ?cd)$/i, ConsoleId.SegaCD],
  [/^(saturn|sega saturn)$/i, ConsoleId.Saturn],
  [/^(dreamcast|dc)$/i, ConsoleId.Dreamcast],
  [/^(master ?system|sms)$/i, ConsoleId.MasterSystem],
  [/^(game ?gear|gg)$/i, ConsoleId.GameGear],
  [/^(32x|sega 32x)$/i, ConsoleId.Sega32X],
  [/^(pc ?engine|turbografx(-?16)?|tg16|pce)$/i, ConsoleId.PCEngine],
  [/^(pc ?engine ?cd|turbografx ?cd|pcecd)$/i, ConsoleId.PCEngineCD],
  [/^(arcade|mame|fbneo|fba|neo ?geo)$/i, ConsoleId.Arcade],
  [/^(atari ?2600|2600)$/i, ConsoleId.Atari2600],
];

/** Extensões genéricas que só entram com o console deduzido da pasta. */
const NEEDS_FOLDER_HINT = new Set(['bin', 'img', 'rom', 'iso', 'zip', '7z', 'ccd']);
/** Formatos de disco que são, por si, uma ROM (console pode ficar para depois). */
const DISC_FORMATS = new Set(['cue', 'chd', 'm3u', 'gdi', 'cdi', 'pbp', 'cso', 'rvz', 'ciso']);
const ROM_EXT_SET = new Set(ROM_EXTENSIONS);

const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const stem = (file: string) => path.basename(file, path.extname(file));

export function isHelperExecutable(fileName: string): boolean {
  const s = stem(fileName);
  return HELPER_EXE.test(s) || EMULATOR_EXE.test(s);
}

export function isEmulatorExecutable(fileName: string): boolean {
  return EMULATOR_EXE.test(stem(fileName));
}

/** Console sugerido pelos nomes das pastas (do mais próximo ao mais distante). */
export function consoleFromFolders(dirs: readonly string[]): number | null {
  for (const dir of [...dirs].reverse()) {
    const name = dir.trim();
    for (const [pattern, id] of FOLDER_CONSOLE) if (pattern.test(name)) return id;
  }
  return null;
}

export interface ExeInfo {
  file: string;
  size: number;
}

/**
 * Escolhe o executável principal de uma pasta: nome parecido com o das pastas acima
 * ("God of War III.exe" em "gow3-windows" × "Gow") e depois o maior arquivo (o launcher real
 * costuma ser bem maior que "Play X.exe", um atalho de 60 KB).
 */
export function rankExecutables(exes: readonly ExeInfo[], folderNames: readonly string[]): ExeInfo[] {
  const folders = folderNames.map(normalize).filter((f) => f.length >= 3);
  const score = (e: ExeInfo) => {
    const name = normalize(stem(e.file));
    let s = 0;
    if (folders.some((f) => name.includes(f) || f.includes(name))) s += 4;
    if (GENERIC_EXE.test(stem(e.file))) s += 1; // main.exe numa pasta só com ele: provável jogo
    if (/^play\s/i.test(stem(e.file))) s -= 1; // atalho "Play X" quando existe o "X"
    return s + Math.log10(Math.max(e.size, 1)) / 10;
  };
  return [...exes].sort((a, b) => score(b) - score(a));
}

/** Título: o nome do executável, ou o da pasta quando o executável tem nome genérico. */
export function titleForExecutable(file: string): string {
  const base = stem(file);
  // O sufixo falso evita que titleFromPath trate "Vol. 2" no nome da pasta como extensão.
  return GENERIC_EXE.test(base) ? titleFromPath(`${path.dirname(file)}.dir`) : titleFromPath(file);
}

export interface ScanOptions {
  libraryPaths: ReadonlySet<string>;
  onProgress?: (progress: ScanProgress) => void;
  signal?: AbortSignal;
}

export async function scanLibraryFolder(root: string, options: ScanOptions): Promise<ScanResult> {
  const started = Date.now();
  const rootStat = await fs.stat(root).catch(() => null);
  if (!rootStat?.isDirectory()) throw new AppError('FILE_MISSING', 'Pasta não encontrada.');

  const candidates: ScanCandidate[] = [];
  const inLibrary = (p: string) => options.libraryPaths.has(p.toLowerCase());
  let dirsVisited = 0;
  let truncated = false;
  let lastProgress = 0;

  const queue: { dir: string; depth: number; trail: string[] }[] = [{ dir: path.resolve(root), depth: 0, trail: [path.basename(root)] }];
  while (queue.length > 0) {
    if (options.signal?.aborted) throw new AppError('VALIDATION', 'Varredura cancelada.');
    if (dirsVisited >= MAX_DIRS || candidates.length >= MAX_CANDIDATES || Date.now() - started > TIME_BUDGET_MS) {
      truncated = true;
      break;
    }
    const { dir, depth, trail } = queue.shift()!;
    dirsVisited++;
    if (options.onProgress && Date.now() - lastProgress > PROGRESS_INTERVAL_MS) {
      lastProgress = Date.now();
      options.onProgress({ dirsVisited, found: candidates.length, currentDir: dir });
    }

    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue; // sem permissão etc.
    }
    const files = entries.filter((e) => e.isFile());
    const names = new Set(files.map((f) => f.name.toLowerCase()));

    // Dump de PS4: dados, não um jogo executável.
    if (names.has('eboot.bin') || entries.some((e) => e.isDirectory() && e.name.toLowerCase() === 'sce_sys')) continue;
    // Pasta de emulador: ferramenta, não varre (evita listar cores, BIOS, saves).
    if (files.some((f) => /\.exe$/i.test(f.name) && isEmulatorExecutable(f.name))) continue;

    // 1) Jogo de PC / port: executável principal nesta pasta → raiz do jogo, não desce mais.
    const exes = files.filter((f) => /\.exe$/i.test(f.name) && !isHelperExecutable(f.name));
    if (exes.length > 0) {
      const infos: ExeInfo[] = [];
      for (const f of exes) {
        const file = path.join(dir, f.name);
        infos.push({ file, size: (await fs.stat(file).catch(() => null))?.size ?? 0 });
      }
      const [main, ...others] = rankExecutables(infos, trail.slice(-3));
      candidates.push({
        path: main!.file,
        kind: 'executable',
        title: titleForExecutable(main!.file),
        consoleId: null,
        alternatives: others.map((o) => o.file),
        inLibrary: [main!, ...others].some((e) => inLibrary(e.file)),
        recommended: true,
        note: null,
      });
      continue;
    }

    // 2) ROMs desta pasta.
    candidates.push(...(await resolveDiscConsoles(romCandidates(dir, files, trail, inLibrary))));

    if (depth >= MAX_DEPTH) continue;
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIRS.has(e.name.toLowerCase())) continue;
      queue.push({ dir: path.join(dir, e.name), depth: depth + 1, trail: [...trail, e.name] });
    }
  }

  options.onProgress?.({ dirsVisited, found: candidates.length, currentDir: null });
  return {
    root: path.resolve(root),
    candidates: candidates.slice(0, MAX_CANDIDATES),
    dirsVisited,
    truncated,
    elapsedMs: Date.now() - started,
  };
}

/**
 * Imagens de disco sem console: lê o disco (SYSTEM.CNF, PSP_GAME, cabeçalho da Sega) para descobrir.
 * As que não dá para reconhecer e só entrariam com pista da pasta (ex.: um .iso qualquer) saem da lista.
 */
async function resolveDiscConsoles(candidates: ScanCandidate[]): Promise<ScanCandidate[]> {
  const out: ScanCandidate[] = [];
  for (const c of candidates) {
    const ext = path.extname(c.path).slice(1).toLowerCase();
    if (c.consoleId != null || !DISC_IMAGE_EXTENSIONS.has(ext)) {
      out.push(c);
      continue;
    }
    const consoleId = await detectDiscConsole(c.path);
    if (consoleId != null) out.push({ ...c, consoleId, recommended: true, note: 'Console reconhecido pelo conteúdo do disco' });
    else if (!NEEDS_FOLDER_HINT.has(ext)) out.push(c);
  }
  return out;
}

function romCandidates(
  dir: string,
  files: readonly Dirent[],
  trail: readonly string[],
  inLibrary: (p: string) => boolean,
): ScanCandidate[] {
  const folderConsole = consoleFromFolders(trail);
  const roms = files.filter((f) => ROM_EXT_SET.has(path.extname(f.name).slice(1).toLowerCase()));
  if (roms.length === 0) return [];

  // Arquivos que pertencem a outro (faixas de um .cue/.gdi, discos de um .m3u) não são jogos sozinhos.
  const extOf = (name: string) => path.extname(name).slice(1).toLowerCase();
  const sheets = new Map<string, Set<string>>(); // stem → extensões de "índice" (cue/gdi/m3u)
  for (const f of roms) {
    const ext = extOf(f.name);
    if (ext === 'cue' || ext === 'gdi' || ext === 'm3u') {
      const s = stem(f.name).toLowerCase();
      sheets.set(s, (sheets.get(s) ?? new Set()).add(ext));
    }
  }
  const hasCue = [...sheets.values()].some((exts) => exts.has('cue'));
  const referenced = new Set<string>();
  for (const f of roms) {
    const ext = extOf(f.name);
    if (ext === 'm3u') continue; // o .m3u é sempre o jogo
    const s = stem(f.name).toLowerCase();
    const own = sheets.get(s);
    // "Jogo.bin" ao lado de "Jogo.cue"/"Jogo.gdi"; "Jogo.cue" ao lado de "Jogo.m3u".
    if (own?.has('m3u') || (own && ext !== 'cue' && ext !== 'gdi')) referenced.add(f.name);
    // "Jogo (Disc 1).cue" com "Jogo.m3u".
    const base = s.replace(/\s*[([]?(disc|disk|cd)\s*\d+[)\]]?\s*$/i, '').trim();
    if (base !== s && sheets.get(base)?.has('m3u')) referenced.add(f.name);
    // "Jogo (Track 2).bin": faixas de um .cue com outro nome.
    if (hasCue && ext === 'bin' && /\(track \d+\)/i.test(f.name)) referenced.add(f.name);
  }

  const out: ScanCandidate[] = [];
  for (const f of roms) {
    if (referenced.has(f.name)) continue;
    const file = path.join(dir, f.name);
    const ext = path.extname(f.name).slice(1).toLowerCase();
    const byExt = consoleFromExtension(file);
    // Imagem de disco sem pista da pasta: o console ainda pode sair do conteúdo (resolveDiscConsoles).
    if (byExt == null && NEEDS_FOLDER_HINT.has(ext) && folderConsole == null && !DISC_IMAGE_EXTENSIONS.has(ext)) continue;
    const consoleId = byExt ?? folderConsole;
    out.push({
      path: file,
      kind: 'retroarch',
      title: titleFromPath(file),
      consoleId,
      alternatives: [],
      inLibrary: inLibrary(file),
      // Disco sem console definido: entra desmarcado, o usuário confirma.
      recommended: consoleId != null || !DISC_FORMATS.has(ext),
      note: byExt == null && folderConsole != null ? `Console deduzido da pasta "${trail[trail.length - 1]}"` : null,
    });
  }
  return out;
}
