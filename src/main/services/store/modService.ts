import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { InstalledMod, ModDetails, ModListResult, ModProgress, ModSort, PortMods } from '@shared/mods';
import type { StoreInstall, StorePort } from '@shared/store';
import type { ModInstallRepository } from '../../db/repositories/modInstallRepository';
import { AppError } from '../../errors';
import { extract7z } from './archive7z';
import { downloadFile, GAMEBANANA_HOSTS } from './downloader';
import { MODS_PER_PAGE, type GameBananaClient } from './gameBanana';
import type { FetchFn } from './githubClient';
import { extractZip, safeEntryPath } from './zipExtract';

/** Pacotes de mod que a Loja abre (o resto, só se já for o arquivo que o port lê). */
const ZIP = /\.zip$/i;
const TAR = /\.(7z|rar|tar\.gz|tgz)$/i;
const MAX_MOD_BYTES = 4 * 1024 * 1024 * 1024;

interface ModServiceDeps {
  store: { port(portId: string): Promise<StorePort> };
  installs: { get(portId: string): StoreInstall | null };
  repo: ModInstallRepository;
  gb: Pick<GameBananaClient, 'listMods' | 'modDetails'>;
  /** Baixa uma imagem do GameBanana para o cofre (rv-media://). */
  importImage(url: string): Promise<string>;
  /** Pasta para downloads e extração temporários (fica dentro da pasta dos ports). */
  workDir: string;
  isRunning(gameId: number): boolean;
  onProgress(progress: ModProgress): void;
  fetchFn?: FetchFn;
}

/** Arquivos com estas extensões em qualquer nível da pasta (o pacote do mod pode trazer subpastas e leia-me). */
async function findByExtension(dir: string, extensions: readonly string[]): Promise<string[]> {
  const wanted = extensions.map((e) => e.toLowerCase());
  const found: string[] = [];
  for (const item of await fs.readdir(dir, { withFileTypes: true, recursive: true })) {
    if (item.isFile() && wanted.some((e) => item.name.toLowerCase().endsWith(e))) found.push(path.join(item.parentPath, item.name));
  }
  return found;
}

const toPosix = (p: string) => p.split(path.sep).join('/');

/**
 * Mods do GameBanana para os ports que os aceitam. Baixa só do GameBanana (conferindo tamanho e
 * MD5 publicados), recusa arquivos que não passaram na análise de vírus deles, extrai numa pasta
 * temporária e copia para a pasta de mods do port apenas os arquivos que o port lê. Cada arquivo
 * colocado fica registrado, para "Remover" apagar só ele.
 */
export class ModService {
  private readonly busy = new Set<string>();

  constructor(private readonly deps: ModServiceDeps) {}

  private async modsOf(portId: string): Promise<{ port: StorePort; mods: PortMods }> {
    const port = await this.deps.store.port(portId);
    if (!port.mods) throw new AppError('NOT_FOUND', 'Este port não tem mods na Loja.');
    return { port, mods: port.mods };
  }

  async list(portId: string, page: number, sort: ModSort, query?: string): Promise<ModListResult> {
    const { mods } = await this.modsOf(portId);
    const result = await this.deps.gb.listMods(mods.gamebanana, { page, sort, query });
    const withThumbs = await Promise.all(
      result.mods.map(async ({ thumbUrl, ...m }) => ({ ...m, thumb: thumbUrl ? await this.deps.importImage(thumbUrl).catch(() => null) : null })),
    );
    return { mods: withThumbs, total: result.total, page, hasMore: page * MODS_PER_PAGE < result.total };
  }

  async details(portId: string, modId: number): Promise<ModDetails> {
    await this.modsOf(portId);
    const { thumbUrl, imageUrls, files, ...d } = await this.deps.gb.modDetails(modId);
    const [thumb, ...images] = await Promise.all(
      [thumbUrl, ...imageUrls].map((u) => (u ? this.deps.importImage(u).catch(() => null) : Promise.resolve(null))),
    );
    return {
      ...d,
      thumb: thumb ?? null,
      images: images.filter((i): i is string => !!i),
      files: files.map(({ md5: _md5, downloadUrl: _url, ...f }) => f),
    };
  }

  /** Mods instalados no port. Os que tiveram todos os arquivos apagados fora do app saem da lista. */
  async installed(portId: string): Promise<InstalledMod[]> {
    const install = this.deps.installs.get(portId);
    const list = this.deps.repo.list(portId);
    if (!install) return list;
    const out: InstalledMod[] = [];
    for (const mod of list) {
      const present = await Promise.all(mod.files.map((f) => this.exists(install.installDir, f)));
      if (present.some(Boolean)) out.push(mod);
      else this.deps.repo.delete(portId, mod.modId);
    }
    return out;
  }

  async install(portId: string, modId: number, fileId: number): Promise<InstalledMod> {
    const key = `${portId}:${modId}`;
    if (this.busy.has(key)) throw new AppError('ALREADY_RUNNING', 'Este mod já está sendo instalado.');
    this.busy.add(key);
    try {
      const { mods } = await this.modsOf(portId);
      const install = this.requireInstall(portId);
      const details = await this.deps.gb.modDetails(modId);
      const file = details.files.find((f) => f.id === fileId);
      if (!file) throw new AppError('NOT_FOUND', 'Arquivo do mod não encontrado.');
      if (!file.scanOk) throw new AppError('VALIDATION', 'Este arquivo ainda não passou na análise de vírus do GameBanana.');
      if (file.size > MAX_MOD_BYTES) throw new AppError('VALIDATION', 'Arquivo grande demais.');
      const direct = mods.extensions.some((e) => file.name.toLowerCase().endsWith(e.toLowerCase()));
      if (!direct && !ZIP.test(file.name) && !TAR.test(file.name)) {
        throw new AppError('VALIDATION', `Formato do arquivo não suportado (${path.extname(file.name) || 'sem extensão'}). Veja as instruções na página do mod.`);
      }

      const work = path.join(this.deps.workDir, `${portId}-${modId}-${Date.now()}`);
      await fs.mkdir(work, { recursive: true });
      try {
        const downloaded = path.join(work, path.basename(file.name).replace(/[<>:"|?*\\/]/g, '_'));
        await downloadFile(file.downloadUrl, downloaded, {
          expectedSize: file.size,
          expectedSha256: null,
          expectedMd5: file.md5,
          hosts: GAMEBANANA_HOSTS,
          fetchFn: this.deps.fetchFn,
          onProgress: (p) => this.deps.onProgress({ portId, modId, received: p.received, total: p.total }),
        });
        let sources = [downloaded];
        if (!direct) {
          const extracted = path.join(work, 'x');
          await fs.mkdir(extracted);
          if (ZIP.test(file.name)) await extractZip(downloaded, extracted);
          else await extract7z(downloaded, extracted);
          sources = await findByExtension(extracted, mods.extensions);
        }
        if (sources.length === 0) {
          throw new AppError('VALIDATION', `Este mod não traz arquivos ${mods.extensions.join(' ou ')}. Veja as instruções na página do mod.`);
        }
        return await this.place(portId, install, mods, { modId, fileId, name: details.name, version: details.version }, sources);
      } finally {
        await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
      }
    } finally {
      this.busy.delete(key);
    }
  }

  async uninstall(portId: string, modId: number): Promise<void> {
    const mod = this.deps.repo.get(portId, modId);
    if (!mod) return;
    const install = this.deps.installs.get(portId);
    if (install) {
      if (install.gameId && this.deps.isRunning(install.gameId)) throw new AppError('ALREADY_RUNNING', 'Feche o jogo antes de remover mods.');
      await this.removeFiles(install.installDir, mod.files);
    }
    this.deps.repo.delete(portId, modId);
  }

  /** Copia para a pasta de mods; um arquivo de outro mod (ou colocado à mão) com o mesmo nome não é sobrescrito. */
  private async place(
    portId: string,
    install: StoreInstall,
    mods: PortMods,
    mod: { modId: number; fileId: number; name: string; version: string | null },
    sources: string[],
  ): Promise<InstalledMod> {
    const folder = safeEntryPath(install.installDir, mods.folder.replace(/\\/g, '/'));
    if (!folder) throw new AppError('VALIDATION', 'Pasta de mods inválida no catálogo.');
    await fs.mkdir(folder, { recursive: true });
    const previous = this.deps.repo.get(portId, mod.modId);
    const ownedByOthers = new Set(this.deps.repo.list(portId).filter((m) => m.modId !== mod.modId).flatMap((m) => m.files.map((f) => f.toLowerCase())));
    const ownedByThis = new Set((previous?.files ?? []).map((f) => f.toLowerCase()));

    const plan = sources.map((src) => {
      const dest = path.join(folder, path.basename(src));
      return { src, dest, rel: toPosix(path.relative(install.installDir, dest)) };
    });
    for (const { dest, rel } of plan) {
      if (ownedByOthers.has(rel.toLowerCase())) {
        const other = this.deps.repo.list(portId).find((m) => m.files.some((f) => f.toLowerCase() === rel.toLowerCase()));
        throw new AppError('DUPLICATE', `"${path.basename(dest)}" já foi instalado pelo mod "${other?.name}". Remova-o antes.`);
      }
      if (!ownedByThis.has(rel.toLowerCase()) && (await this.exists(install.installDir, rel))) {
        throw new AppError('DUPLICATE', `Já existe "${path.basename(dest)}" na pasta de mods (colocado fora da Loja). Apague-o ou renomeie antes.`);
      }
    }
    // Reinstalar/atualizar: tira os arquivos da versão anterior deste mod antes de pôr os novos.
    if (previous) await this.removeFiles(install.installDir, previous.files);
    for (const { src, dest } of plan) await fs.copyFile(src, dest);
    return this.deps.repo.save(portId, { ...mod, files: plan.map((p) => p.rel) });
  }

  private requireInstall(portId: string): StoreInstall {
    const install = this.deps.installs.get(portId);
    if (!install) throw new AppError('NOT_FOUND', 'Instale o port antes de adicionar mods.');
    if (install.kind === 'installer') throw new AppError('VALIDATION', 'Este port foi instalado pelo instalador do projeto; os mods vão pela pasta dele.');
    if (install.gameId && this.deps.isRunning(install.gameId)) throw new AppError('ALREADY_RUNNING', 'Feche o jogo antes de instalar mods.');
    return install;
  }

  private async removeFiles(installDir: string, files: readonly string[]): Promise<void> {
    for (const rel of files) {
      const target = safeEntryPath(installDir, rel);
      if (target) await fs.rm(target, { force: true });
    }
  }

  private async exists(installDir: string, rel: string): Promise<boolean> {
    const target = safeEntryPath(installDir, rel);
    return !!target && (await fs.stat(target).then((s) => s.isFile(), () => false));
  }

  /** Restos de uma instalação interrompida (app fechado no meio do download). */
  async cleanupLeftovers(): Promise<void> {
    await fs.rm(this.deps.workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
