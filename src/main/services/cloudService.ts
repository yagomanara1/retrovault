import { execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { CloudProvider, CloudProviderId } from '@shared/types';
import { AppError } from '../errors';

// "Nuvem" pelo aplicativo de sincronização que o usuário já tem (OneDrive, Google Drive, Dropbox):
// o cofre de saves passa a ficar dentro da pasta sincronizada e o próprio app cuida do upload,
// do histórico de versões e de outros PCs. Sem login/token no RetroVault (nada de OAuth).

const run = promisify(execFile);

export interface CloudEnv {
  home: string;
  localAppData: string;
  appData: string;
  programFiles: string[];
  env: NodeJS.ProcessEnv;
}

const DOWNLOAD: Record<CloudProviderId, string> = {
  onedrive: 'https://www.microsoft.com/microsoft-365/onedrive/download',
  googledrive: 'https://www.google.com/drive/download/',
  dropbox: 'https://www.dropbox.com/install',
};
const PROCESS: Record<CloudProviderId, string> = {
  onedrive: 'onedrive.exe',
  googledrive: 'googledrivefs.exe',
  dropbox: 'dropbox.exe',
};
const NAME: Record<CloudProviderId, string> = { onedrive: 'OneDrive', googledrive: 'Google Drive', dropbox: 'Dropbox' };

/** Saída de `reg query <chave> /s` → { "<subchave>": { valor: dado } }. */
export function parseRegQuery(output: string): Map<string, Map<string, string>> {
  const keys = new Map<string, Map<string, string>>();
  let current: Map<string, string> | null = null;
  for (const line of output.split(/\r?\n/)) {
    if (/^HKEY_/i.test(line.trim())) {
      current = new Map();
      keys.set(line.trim(), current);
      continue;
    }
    const m = /^\s{2,}(.+?)\s{2,}(REG_\w+)\s{2,}(.*)$/.exec(line);
    if (m && current) current.set(m[1]!, m[3]!.trim());
  }
  return keys;
}

/** Saída de `tasklist /FO CSV /NH` → nomes de processo em minúsculas. */
export function parseTasklist(output: string): Set<string> {
  const names = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const m = /^"([^"]+)"/.exec(line.trim());
    if (m) names.add(m[1]!.toLowerCase());
  }
  return names;
}

/** %LOCALAPPDATA%\Dropbox\info.json → pasta da conta pessoal (ou da empresa). */
export function parseDropboxInfo(text: string): string | null {
  try {
    const info = JSON.parse(text) as Record<string, { path?: string }>;
    return info.personal?.path ?? info.business?.path ?? null;
  } catch {
    return null;
  }
}

/** Qual provedor contém esta pasta (o cofre "está na nuvem" se estiver dentro de uma pasta sincronizada). */
export function providerForPath(target: string, providers: readonly Pick<CloudProvider, 'id' | 'folder'>[]): CloudProviderId | null {
  const t = path.resolve(target).toLowerCase();
  for (const p of providers) {
    if (!p.folder) continue;
    const root = path.resolve(p.folder).toLowerCase();
    if (t === root || t.startsWith(root.endsWith(path.sep) ? root : root + path.sep)) return p.id;
  }
  return null;
}

const isDir = (p: string) => fs.stat(p).then((s) => s.isDirectory(), () => false);
const isFile = (p: string) => fs.stat(p).then((s) => s.isFile(), () => false);

export class CloudService {
  constructor(private readonly env: CloudEnv) {}

  async providers(savesRoot: string): Promise<CloudProvider[]> {
    if (process.platform !== 'win32') return [];
    const [onedrive, googledrive, dropbox, processes] = await Promise.all([
      this.detect('onedrive'),
      this.detect('googledrive'),
      this.detect('dropbox'),
      run('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true }).then((r) => parseTasklist(r.stdout), () => new Set<string>()),
    ]);
    const found = { onedrive, googledrive, dropbox };
    const list = (Object.keys(found) as CloudProviderId[]).map((id) => ({
      id,
      name: NAME[id],
      folder: found[id].folder,
      account: found[id].account,
      running: processes.has(PROCESS[id]),
      canStart: !!found[id].exe,
      connected: false,
      downloadUrl: DOWNLOAD[id],
    }));
    const connected = providerForPath(savesRoot, list);
    return list.map((p) => ({ ...p, connected: p.id === connected }));
  }

  /** Pasta do cofre dentro do provedor: <pasta sincronizada>\RetroVault\Saves. */
  async vaultFolderFor(id: CloudProviderId, savesRoot: string): Promise<string> {
    const provider = (await this.providers(savesRoot)).find((p) => p.id === id);
    if (!provider?.folder) throw new AppError('NOT_FOUND', `${NAME[id]} não está instalado neste PC.`);
    if (!(await isDir(provider.folder))) throw new AppError('FILE_MISSING', `A pasta do ${NAME[id]} não existe: ${provider.folder}`);
    return path.join(provider.folder, 'RetroVault', 'Saves');
  }

  /**
   * "Manter sempre neste dispositivo": com o Files On-Demand do OneDrive, os backups poderiam ficar
   * só na nuvem e restaurar com o OneDrive fechado falharia. attrib +P -U fixa os arquivos no disco.
   */
  async pinLocally(folder: string): Promise<void> {
    await run('attrib', ['+P', '-U', `${folder}\\*`, '/S', '/D'], { windowsHide: true }).catch((err) =>
      console.warn('[cloud] não foi possível fixar os arquivos no dispositivo', err),
    );
    await run('attrib', ['+P', '-U', folder], { windowsHide: true }).catch(() => undefined);
  }

  async startClient(id: CloudProviderId): Promise<void> {
    const { exe } = await this.detect(id);
    if (!exe) throw new AppError('NOT_FOUND', `Não encontramos o aplicativo do ${NAME[id]}.`);
    const child = spawn(exe, id === 'onedrive' ? ['/background'] : [], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
  }

  // ---------- Detecção ----------

  private detect(id: CloudProviderId) {
    switch (id) {
      case 'onedrive':
        return this.oneDrive();
      case 'googledrive':
        return this.googleDrive();
      case 'dropbox':
        return this.dropbox();
    }
  }

  private async oneDrive(): Promise<{ folder: string | null; account: string | null; exe: string | null }> {
    let folder = this.env.env.OneDriveConsumer || this.env.env.OneDrive || null;
    let account: string | null = null;
    try {
      const { stdout } = await run('reg', ['query', 'HKCU\\Software\\Microsoft\\OneDrive\\Accounts', '/s'], { windowsHide: true });
      // Conta pessoal primeiro; depois a primeira conta corporativa (Business1…).
      const accounts = [...parseRegQuery(stdout).entries()].filter(([, v]) => v.get('UserFolder'));
      const chosen = accounts.find(([k]) => /\\Personal$/i.test(k)) ?? accounts[0];
      if (chosen) {
        folder = chosen[1].get('UserFolder') ?? folder;
        account = chosen[1].get('UserEmail') ?? null;
      }
    } catch {
      // sem conta configurada
    }
    const exe = await this.firstFile([
      path.join(this.env.localAppData, 'Microsoft', 'OneDrive', 'OneDrive.exe'),
      ...this.env.programFiles.map((p) => path.join(p, 'Microsoft OneDrive', 'OneDrive.exe')),
    ]);
    return { folder: folder && (await isDir(folder)) ? folder : null, account, exe };
  }

  /** Google Drive para computador: unidade virtual (G:\Meu Drive) ou pasta espelhada (%USERPROFILE%\Meu Drive). */
  private async googleDrive(): Promise<{ folder: string | null; account: string | null; exe: string | null }> {
    const names = ['My Drive', 'Meu Drive', 'Mi unidad'];
    const candidates = [
      ...'DEFGHIJKLMNOPQRSTUVWXYZ'.split('').flatMap((l) => names.map((n) => `${l}:\\${n}`)),
      ...names.map((n) => path.join(this.env.home, n)),
      path.join(this.env.home, 'Google Drive'),
    ];
    let folder: string | null = null;
    for (const c of candidates) {
      if (await isDir(c)) {
        folder = c;
        break;
      }
    }
    let exe: string | null = null;
    for (const pf of this.env.programFiles) {
      const base = path.join(pf, 'Google', 'Drive File Stream');
      const versions = await fs.readdir(base).catch(() => [] as string[]);
      for (const v of versions.sort().reverse()) {
        const candidate = path.join(base, v, 'GoogleDriveFS.exe');
        if (await isFile(candidate)) {
          exe = candidate;
          break;
        }
      }
      if (exe) break;
    }
    return { folder, account: null, exe };
  }

  private async dropbox(): Promise<{ folder: string | null; account: string | null; exe: string | null }> {
    let folder: string | null = null;
    for (const base of [this.env.localAppData, this.env.appData]) {
      const text = await fs.readFile(path.join(base, 'Dropbox', 'info.json'), 'utf8').catch(() => null);
      folder = text ? parseDropboxInfo(text) : null;
      if (folder) break;
    }
    const exe = await this.firstFile([
      ...this.env.programFiles.map((p) => path.join(p, 'Dropbox', 'Client', 'Dropbox.exe')),
      path.join(this.env.localAppData, 'Dropbox', 'Client', 'Dropbox.exe'),
    ]);
    return { folder: folder && (await isDir(folder)) ? folder : null, account: null, exe };
  }

  private async firstFile(paths: string[]): Promise<string | null> {
    for (const p of paths) if (await isFile(p)) return p;
    return null;
  }
}
