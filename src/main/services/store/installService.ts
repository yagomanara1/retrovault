import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Game } from '@shared/types';
import {
  availableUpdate,
  chooseRelease,
  installKind,
  type InstalledVersion,
  type InstallPhase,
  type InstallProgress,
  type UpdateAllResult,
  type StoreInstall,
  type StorePort,
} from '@shared/store';
import type { StoreInstallRepository } from '../../db/repositories/storeInstallRepository';
import { AppError } from '../../errors';
import type { StoreCatalogService } from './catalogService';
import { downloadFile } from './downloader';
import type { FetchFn } from './githubClient';
import { extract7z, TAR_FORMATS } from './archive7z';
import { carryUserFiles, listFiles, packageFilesOf, readManifest, writeManifest } from './userFiles';
import { contentRoot, extractZip, safeEntryPath } from './zipExtract';

const PROGRESS_INTERVAL_MS = 150;
/** Executáveis que não são o jogo (atualizadores, desinstaladores, relatórios de erro…). */
const HELPER_EXE = /(unins|updater|update|crash|report|redist|setup|install|helper|launcher_?config)/i;

export interface InstallServiceDeps {
  store: StoreCatalogService;
  repo: StoreInstallRepository;
  /** Pasta dos ports (ex.: %LOCALAPPDATA%\RetroVault\Ports). */
  root: string;
  games: {
    get(id: number): Game;
    add(input: { kind: 'executable'; path: string; title: string }): Promise<{ game: Game }>;
    relocate(id: number, newPath: string): Promise<Game>;
    list(): Game[];
  };
  isRunning(gameId: number): boolean;
  /** Guarda o save no cofre antes de apagar arquivos (muitos ports salvam na própria pasta). */
  backupSave(gameId: number): Promise<void>;
  /** Manda para a Lixeira (recuperável). */
  trash(target: string): Promise<void>;
  onProgress(progress: InstallProgress): void;
  /** Jogo novo na biblioteca: troféus, arte e categoria em segundo plano. */
  onGameAdded(gameId: number): void;
  /** Depois de instalar (ex.: recolocar a ROM já conferida na versão nova). Não deve lançar erro. */
  afterInstall?(portId: string): Promise<void>;
  /** Abre o instalador do projeto (.exe ou .msi) e espera ele fechar; o usuário segue os passos dele. */
  runInstaller(file: string, signal: AbortSignal): Promise<void>;
  /** Instalador terminou e o jogo não está nos caminhos do catálogo: o usuário aponta o .exe (null = desistiu). */
  pickExecutable(title: string): Promise<string | null>;
  fetchFn?: FetchFn;
}

interface InstallerJob {
  port: StorePort;
  tag: string;
  asset: { name: string; size: number; sha256: string | null };
  file: string;
  sha256: string;
  staging: string;
  installed: StoreInstall | null;
  rememberedGame: number | null;
  report: (phase: InstallPhase, done: number, total: number, force?: boolean) => void;
  signal: AbortSignal;
}

/** Nome de pasta seguro para uma tag ("v1.2.2", "ci-dev-build"…). */
export function safeDirName(tag: string): string {
  const cleaned = tag.replace(/[^\w.-]+/g, '_').replace(/^\.+/, '').slice(0, 80);
  return cleaned || 'versao';
}

/** Só os campos da versão (sem port, jogo e anterior), para guardar como "anterior". */
function versionOf(v: InstalledVersion): InstalledVersion {
  const { kind, tag, assetName, sha256, verified, installDir, exePath, sizeBytes, installedAt } = v;
  return { kind, tag, assetName, sha256, verified, installDir, exePath, sizeBytes, installedAt };
}

/** "%LOCALAPPDATA%\Programs\X\x.exe" → caminho real (variáveis de ambiente, sem diferenciar maiúsculas). */
export function expandWindowsPath(template: string, env: NodeJS.ProcessEnv = process.env): string | null {
  let missing = false;
  const expanded = template.replace(/%([^%]+)%/g, (_m, name: string) => {
    const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
    const value = key ? env[key] : undefined;
    if (!value) missing = true;
    return value ?? '';
  });
  return missing ? null : path.normalize(expanded);
}

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(
    () => true,
    () => false,
  );
}

/** .exe até 2 níveis de profundidade (ports trazem o executável no topo ou numa subpasta). */
async function findExecutables(dir: string, depth = 0): Promise<string[]> {
  const found: string[] = [];
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isFile() && /\.exe$/i.test(item.name)) found.push(full);
    else if (item.isDirectory() && depth < 1) found.push(...(await findExecutables(full, depth + 1)));
  }
  return found;
}

/** O executável do catálogo; se a versão nova o renomeou, o melhor candidato da pasta. */
export async function resolveExecutable(dir: string, port: Pick<StorePort, 'executable' | 'name'>): Promise<string> {
  if (port.executable) {
    const target = safeEntryPath(dir, port.executable.replace(/\\/g, '/'));
    if (target && (await exists(target))) return target;
  }
  const candidates = (await findExecutables(dir)).filter((f) => !HELPER_EXE.test(path.basename(f)));
  if (candidates.length === 0) throw new AppError('VALIDATION', 'Não encontrei o executável do port no pacote baixado.');
  // Mais raso primeiro (o principal costuma estar no topo); empate: o maior arquivo.
  const scored = await Promise.all(
    candidates.map(async (f) => ({ f, depth: path.relative(dir, f).split(path.sep).length, size: (await fs.stat(f)).size })),
  );
  scored.sort((a, b) => a.depth - b.depth || b.size - a.size);
  return scored[0]!.f;
}

/**
 * Instala ports da Loja: baixar → conferir → extrair numa pasta temporária → mover de forma atômica
 * → registrar na biblioteca. Uma instalação por port de cada vez; todas podem ser canceladas.
 */
export class InstallService {
  private readonly jobs = new Map<string, AbortController>();

  constructor(private readonly deps: InstallServiceDeps) {}

  list(): StoreInstall[] {
    return this.deps.repo.list();
  }

  installing(): string[] {
    return [...this.jobs.keys()];
  }

  cancel(portId: string): void {
    this.jobs.get(portId)?.abort();
  }

  /** Restos de uma instalação interrompida (app fechado no meio): pastas temporárias e downloads parciais. */
  async cleanupLeftovers(): Promise<void> {
    await fs.rm(path.join(this.deps.root, '.staging'), { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(path.join(this.deps.root, '.downloads'), { recursive: true, force: true }).catch(() => undefined);
  }

  async install(portId: string, tag?: string): Promise<StoreInstall> {
    // A versão pedida é a anterior, ainda no disco: troca na hora, sem baixar.
    const current = this.deps.repo.get(portId);
    if (tag && current?.previous?.tag === tag && (await exists(current.previous.installDir))) return this.rollback(portId);

    if (this.jobs.has(portId)) throw new AppError('ALREADY_RUNNING', 'Este port já está sendo instalado.');
    const controller = new AbortController();
    this.jobs.set(portId, controller);
    const { signal } = controller;
    const report = this.reporter(portId);
    let staging: string | null = null;
    let downloadPath: string | null = null;

    try {
      report('preparing', 0, 0, true);
      const port = await this.deps.store.port(portId);
      const release = chooseRelease(await this.deps.store.releases(portId), tag);
      const asset = release?.windowsAsset;
      if (!release || !asset) throw new AppError('NOT_FOUND', 'Este port não tem uma versão para Windows publicada.');
      const kind = installKind(port, asset.name);
      if (kind === 'archive' && !/\.zip$/i.test(asset.name) && !TAR_FORMATS.test(asset.name)) {
        throw new AppError('VALIDATION', `O formato de "${asset.name}" ainda não é suportado pela Loja.`);
      }

      const installed = this.deps.repo.get(portId);
      // Versão de instalador fica fora da pasta do RetroVault: não vira "anterior" nem tem arquivos a levar.
      const previous = installed && installed.kind !== 'installer' ? installed : null;
      const rememberedGame = this.deps.repo.gameFor(portId);
      if (rememberedGame && this.deps.isRunning(rememberedGame)) {
        throw new AppError('ALREADY_RUNNING', 'Feche o jogo antes de atualizar ou reinstalar.');
      }

      const downloads = path.join(this.deps.root, '.downloads');
      await fs.mkdir(downloads, { recursive: true });
      // O nome do arquivo mantém a extensão (.zip, .7z, .exe, .msi, .msi.zip): ela decide como abrir.
      downloadPath = path.join(downloads, `${portId}-${safeDirName(release.tag)}-${safeDirName(asset.name)}`);
      report('downloading', 0, asset.size, true);
      const { sha256 } = await downloadFile(asset.downloadUrl, downloadPath, {
        expectedSize: asset.size,
        expectedSha256: asset.sha256,
        signal,
        fetchFn: this.deps.fetchFn,
        onProgress: (p) => report('downloading', p.received, p.total),
      });

      await fs.mkdir(path.join(this.deps.root, '.staging'), { recursive: true });
      staging = await fs.mkdtemp(path.join(this.deps.root, '.staging', `${portId}-`));
      if (kind === 'installer') {
        return await this.installWithInstaller({ port, tag: release.tag, asset, file: downloadPath, sha256, staging, installed, rememberedGame, report, signal });
      }

      let content: string;
      let exeInContent: string;
      if (kind === 'portable') {
        // Um .exe sozinho: vira um "pacote" de um arquivo, com versões e "voltar" como os outros.
        exeInContent = path.join(staging, safeDirName(asset.name));
        await fs.copyFile(downloadPath, exeInContent);
        content = staging;
      } else {
        report('extracting', 0, 0, true);
        const onProgress = (p: { files: number; totalFiles: number }) => report('extracting', p.files, p.totalFiles);
        if (TAR_FORMATS.test(asset.name)) await extract7z(downloadPath, staging, { signal, onProgress });
        else await extractZip(downloadPath, staging, { signal, onProgress });
        content = await contentRoot(staging);
        exeInContent = await resolveExecutable(content, port);
      }
      // Manifesto do pacote: o que não estiver nele, depois, é do usuário (saves, configurações…).
      const packageFiles = await listFiles(content);
      const packageSet = new Set(packageFiles.map((f) => f.toLowerCase()));
      await writeManifest(content, packageFiles);

      report('finishing', 0, 0, true);
      signal.throwIfAborted();
      // Antes de mexer em qualquer pasta (e enquanto o jogo ainda aponta para a versão antiga):
      // o save vai para o cofre, porque muitos ports salvam dentro da própria pasta.
      if (previous && rememberedGame) await this.deps.backupSave(rememberedGame);
      const previousExists = !!previous && (await exists(previous.installDir));
      if (previous && previousExists) {
        // Saves, configurações e arquivos gerados (ex.: o .o2r feito da ROM) seguem para a versão nova.
        await carryUserFiles(previous.installDir, content, packageSet);
        // Pasta de antes do manifesto: registra o que era pacote, para "voltar" saber o que é do usuário.
        if (!(await readManifest(previous.installDir))) {
          await writeManifest(previous.installDir, (await listFiles(previous.installDir)).filter((f) => packageSet.has(f.toLowerCase())));
        }
      }

      // Troca atômica: a pasta final só aparece completa (rename no mesmo volume).
      let finalDir = path.join(this.deps.root, portId, safeDirName(release.tag));
      // Mesma tag com outro arquivo (compilação republicada, ex.: "ci-dev-build"): pasta própria,
      // para a compilação anterior continuar disponível para voltar.
      if (previous && previous.installDir === finalDir && previous.sha256 !== sha256) finalDir = `${finalDir}-${sha256.slice(0, 8)}`;
      await fs.mkdir(path.dirname(finalDir), { recursive: true });
      let replaced: string | null = null;
      if (await exists(finalDir)) {
        // Reinstalar a mesma versão: a antiga sai do caminho e vai para a Lixeira no fim.
        replaced = `${finalDir}.old-${Date.now()}`;
        await fs.rename(finalDir, replaced);
      }
      await fs.rename(content, finalDir);
      const exePath = path.join(finalDir, path.relative(content, exeInContent));

      // A versão que estava ativa (se for outra pasta) vira a "anterior" e a anterior dela sai.
      // Reinstalação da mesma pasta: a "anterior" que já existia continua.
      let keep: InstalledVersion | null = null;
      if (previous && previousExists && previous.installDir !== finalDir) keep = versionOf(previous);
      else if (previous?.previous && previous.previous.installDir !== finalDir && (await exists(previous.previous.installDir))) keep = previous.previous;
      const gameId = await this.linkGame(port, rememberedGame, exePath);
      const install = this.deps.repo.save(
        portId,
        {
          kind,
          tag: release.tag,
          assetName: asset.name,
          sha256,
          verified: asset.sha256 !== null,
          installDir: finalDir,
          exePath,
          sizeBytes: asset.size,
          installedAt: new Date().toISOString(),
        },
        keep,
        gameId,
      );

      // Para a Lixeira (o save já está no cofre): a pasta substituída e a versão de antes da anterior.
      const discard = [replaced, previous?.previous?.installDir].filter(
        (d): d is string => !!d && d !== finalDir && d !== keep?.installDir,
      );
      for (const dir of discard) await this.trashQuietly(dir);
      await this.deps.afterInstall?.(portId);
      return install;
    } catch (err) {
      if (signal.aborted) throw new AppError('CANCELLED', 'Instalação cancelada.');
      throw err;
    } finally {
      this.jobs.delete(portId);
      if (staging) await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
      if (downloadPath) await fs.rm(downloadPath, { force: true }).catch(() => undefined);
    }
  }

  /**
   * Volta para a versão anterior, que continua no disco (sem baixar). Os arquivos do usuário da
   * versão atual (saves mais novos, configurações) vão junto; a atual vira a "anterior" — dá para
   * desfazer chamando de novo.
   */
  async rollback(portId: string): Promise<StoreInstall> {
    if (this.jobs.has(portId)) throw new AppError('ALREADY_RUNNING', 'Espere a instalação terminar.');
    const install = this.deps.repo.get(portId);
    const target = install?.previous;
    if (!install || !target || !(await exists(target.installDir))) {
      throw new AppError('NOT_FOUND', 'Não há versão anterior guardada para voltar.');
    }
    if (install.gameId && this.deps.isRunning(install.gameId)) throw new AppError('ALREADY_RUNNING', 'Feche o jogo antes de trocar de versão.');
    this.jobs.set(portId, new AbortController());
    try {
      if (install.gameId) await this.deps.backupSave(install.gameId);
      if (await exists(install.installDir)) {
        await carryUserFiles(install.installDir, target.installDir, await packageFilesOf(target.installDir));
      }
      const port = await this.deps.store.port(portId);
      const gameId = await this.linkGame(port, install.gameId, target.exePath);
      const swapped = this.deps.repo.save(portId, target, versionOf(install), gameId);
      await this.deps.afterInstall?.(portId);
      return swapped;
    } finally {
      this.jobs.delete(portId);
    }
  }

  /** Atualizações dos ports instalados (versões em cache; um port com erro de rede só fica de fora). */
  async updates(): Promise<Record<string, { tag: string; name: string; sizeBytes: number }>> {
    const out: Record<string, { tag: string; name: string; sizeBytes: number }> = {};
    for (const install of this.deps.repo.list()) {
      try {
        const update = availableUpdate(await this.deps.store.releases(install.portId), install);
        if (update?.windowsAsset) out[install.portId] = { tag: update.tag, name: update.name, sizeBytes: update.windowsAsset.size };
      } catch (err) {
        console.warn('[store] não foi possível verificar atualização', install.portId, err);
      }
    }
    return out;
  }

  /**
   * "Atualizar tudo": instala, um de cada vez, a versão nova de cada port que tiver uma. Ficam de fora
   * os que usam instalador (pedem interação do usuário) e os que estão abertos agora. Uma falha não
   * interrompe os outros; a versão anterior de cada um continua guardada para voltar.
   */
  async updateAll(): Promise<UpdateAllResult> {
    const result: UpdateAllResult = { updated: [], skipped: [], failed: [] };
    for (const [portId, update] of Object.entries(await this.updates())) {
      const install = this.deps.repo.get(portId);
      if (!install) continue;
      if (install.kind === 'installer') {
        result.skipped.push({ portId, reason: 'installer' });
        continue;
      }
      if (install.gameId && this.deps.isRunning(install.gameId)) {
        result.skipped.push({ portId, reason: 'running' });
        continue;
      }
      try {
        await this.install(portId, update.tag);
        result.updated.push(portId);
      } catch (err) {
        if (err instanceof AppError && err.code === 'CANCELLED') {
          result.skipped.push({ portId, reason: 'cancelled' });
          continue;
        }
        result.failed.push({ portId, message: err instanceof Error ? err.message : String(err) });
      }
    }
    return result;
  }

  /**
   * Desinstala: guarda o save no cofre, manda as pastas (a ativa e a anterior) para a Lixeira e mantém
   * o jogo na biblioteca (tempo de jogo e troféus). Reinstalar religa o mesmo jogo.
   */
  async uninstall(portId: string): Promise<{ manual: boolean }> {
    const install = this.deps.repo.get(portId);
    if (!install) throw new AppError('NOT_FOUND', 'Este port não está instalado.');
    if (this.jobs.has(portId)) throw new AppError('ALREADY_RUNNING', 'Espere a instalação terminar.');
    if (install.gameId && this.deps.isRunning(install.gameId)) throw new AppError('ALREADY_RUNNING', 'Feche o jogo antes de desinstalar.');
    if (install.gameId) await this.deps.backupSave(install.gameId);
    if (install.kind === 'installer') {
      // Instalado pelo instalador do projeto: os arquivos são do Windows, não do RetroVault.
      this.deps.repo.remove(portId);
      return { manual: true };
    }
    await this.deps.trash(install.installDir);
    if (install.previous && (await exists(install.previous.installDir))) await this.trashQuietly(install.previous.installDir);
    this.deps.repo.remove(portId);
    // A pasta do port fica vazia sem as versões: some também (rmdir só apaga pasta vazia).
    await fs.rmdir(path.dirname(install.installDir)).catch(() => undefined);
    return { manual: false };
  }

  /**
   * Instalador do projeto (setup .exe/.msi): roda e espera o usuário terminar; depois acha o jogo
   * instalado (caminhos do catálogo) ou pede para ele apontar. Fica fora da pasta do RetroVault,
   * então não há versão anterior guardada nem desinstalação pela Loja.
   */
  private async installWithInstaller(job: InstallerJob): Promise<StoreInstall> {
    const { port, file, report, signal } = job;
    report('installer', 0, 0, true);
    if (job.installed && job.rememberedGame) await this.deps.backupSave(job.rememberedGame);

    let runnable = file;
    if (/\.msi\.zip$/i.test(job.asset.name)) {
      // .msi dentro de um .zip (ex.: OpenGOAL): extrai com as mesmas proteções e roda o .msi.
      await extractZip(file, job.staging, { signal });
      const msi = (await listFiles(job.staging)).find((f) => /\.msi$/i.test(f));
      if (!msi) throw new AppError('VALIDATION', 'O pacote não tem o instalador (.msi) esperado.');
      runnable = path.join(job.staging, ...msi.split('/'));
    }
    await this.deps.runInstaller(runnable, signal);
    signal.throwIfAborted();

    let exe: string | null = null;
    for (const candidate of port.installedExe ?? []) {
      const expanded = expandWindowsPath(candidate);
      if (expanded && (await exists(expanded))) {
        exe = expanded;
        break;
      }
    }
    exe ??= await this.deps.pickExecutable(`Onde ficou o ${port.name}? Escolha o .exe do jogo instalado`);
    if (!exe) {
      throw new AppError('CANCELLED', 'O instalador terminou, mas o jogo não foi indicado. Use "Adicionar jogo" para colocá-lo na biblioteca.');
    }

    report('finishing', 0, 0, true);
    const gameId = await this.linkGame(port, job.rememberedGame, exe);
    // Se antes estava instalado pela Loja em versões (.zip), essas pastas saem (o save já está no cofre).
    const oldDirs = job.installed && job.installed.kind !== 'installer' ? [job.installed.installDir, job.installed.previous?.installDir] : [];
    const install = this.deps.repo.save(
      port.id,
      {
        kind: 'installer',
        tag: job.tag,
        assetName: job.asset.name,
        sha256: job.sha256,
        verified: job.asset.sha256 !== null,
        installDir: path.dirname(exe),
        exePath: exe,
        sizeBytes: job.asset.size,
        installedAt: new Date().toISOString(),
      },
      null,
      gameId,
    );
    for (const dir of oldDirs) if (dir && (await exists(dir))) await this.trashQuietly(dir);
    await this.deps.afterInstall?.(port.id);
    return install;
  }

  /** Reinstalação religa o jogo lembrado; instalação nova cria (ou reaproveita) o jogo pelo caminho. */
  private async linkGame(port: StorePort, remembered: number | null, exePath: string): Promise<number> {
    if (remembered) {
      try {
        const game = this.deps.games.get(remembered);
        if (game.path.toLowerCase() !== exePath.toLowerCase()) await this.deps.games.relocate(remembered, exePath);
        return remembered;
      } catch (err) {
        if (!(err instanceof AppError && err.code === 'NOT_FOUND')) throw err;
      }
    }
    const existing = this.deps.games.list().find((g) => g.path.toLowerCase() === exePath.toLowerCase());
    if (existing) return existing.id;
    const { game } = await this.deps.games.add({ kind: 'executable', path: exePath, title: port.name });
    this.deps.onGameAdded(game.id);
    return game.id;
  }

  private async trashQuietly(dir: string): Promise<void> {
    try {
      await this.deps.trash(dir);
    } catch (err) {
      console.warn('[store] não foi possível mandar a versão antiga para a Lixeira', dir, err);
    }
  }

  /** Progresso no máximo a cada 150 ms (mudança de fase sempre passa). */
  private reporter(portId: string) {
    let last = 0;
    return (phase: InstallPhase, done: number, total: number, force = false) => {
      const now = Date.now();
      if (!force && now - last < PROGRESS_INTERVAL_MS) return;
      last = now;
      this.deps.onProgress({ portId, phase, done, total });
    };
  }
}
