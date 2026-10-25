import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { installKind, type StorePort, type StoreRelease } from '@shared/store';
import { openDatabase } from '../../db/database';
import { GameRepository } from '../../db/repositories/gameRepository';
import { StoreInstallRepository } from '../../db/repositories/storeInstallRepository';
import { AppError } from '../../errors';
import { makeTree, useTempDir } from '../../testing/tempDir';
import { checkListing, extract7z, systemTar, TAR_FORMATS } from './archive7z';
import type { StoreCatalogService } from './catalogService';
import type { FetchFn } from './githubClient';
import { expandWindowsPath, InstallService } from './installService';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** .7z de verdade, criado pelo tar.exe do Windows (o mesmo que a Loja usa para extrair). */
async function make7z(dir: string, tree: Record<string, string>): Promise<Buffer> {
  const src = path.join(dir, 'src7z');
  await makeTree(src, tree);
  const out = path.join(dir, 'pacote.7z');
  execFileSync(systemTar(), ['--format', '7zip', '-cf', out, '-C', src, '.']);
  await fs.rm(src, { recursive: true, force: true });
  return fs.readFile(out);
}

function response(body: Buffer, url: string): Response {
  const r = new Response(new Uint8Array(body), { status: 200 });
  Object.defineProperty(r, 'url', { value: url });
  return r;
}

describe('tipo de instalação pelo arquivo', () => {
  it('deduz archive, portable e installer; o catálogo pode forçar', () => {
    expect(installKind({}, 'Jogo-Windows.zip')).toBe('archive');
    expect(installKind({}, 'ProjectMidas-v1.0.1-windows.7z')).toBe('archive');
    expect(installKind({}, 'SMS-Launcher-0.1.64-win-portable.exe')).toBe('portable');
    expect(installKind({}, 'Takedawn-0.2.1-windows-x64-setup.exe')).toBe('installer');
    expect(installKind({}, 'OpenGOAL-Launcher_2.11.2_x64_en-US.msi.zip')).toBe('installer');
    expect(installKind({}, 'App.msi')).toBe('installer');
    expect(installKind({ install: 'portable' }, 'Game-Setup.exe')).toBe('portable');
  });

  it('expande variáveis do Windows e recusa as que não existem', () => {
    const env = { LOCALAPPDATA: 'C:\\Users\\eu\\AppData\\Local', ProgramFiles: 'C:\\Program Files' };
    expect(expandWindowsPath('%LOCALAPPDATA%\\Programs\\Jogo\\jogo.exe', env)).toBe('C:\\Users\\eu\\AppData\\Local\\Programs\\Jogo\\jogo.exe');
    expect(expandWindowsPath('%PROGRAMFILES%\\Jogo\\jogo.exe', env)).toBe('C:\\Program Files\\Jogo\\jogo.exe');
    expect(expandWindowsPath('%NAOEXISTE%\\jogo.exe', env)).toBeNull();
  });
});

describe('extract7z (tar.exe do Windows)', () => {
  const tmp = useTempDir();

  it('extrai .7z com subpastas e informa o progresso', async () => {
    const data = await make7z(tmp(), { 'windows/jogo.exe': 'MZ', 'windows/Data/a.txt': 'oi', 'windows/Data/b.txt': 'tchau' });
    const file = path.join(tmp(), 'x.7z');
    await fs.writeFile(file, data);
    const out = path.join(tmp(), 'out');
    await fs.mkdir(out);
    let last = 0;
    expect(await extract7z(file, out, { onProgress: (p) => (last = p.files) })).toEqual({ files: 3 });
    expect(last).toBe(3);
    expect(await fs.readFile(path.join(out, 'windows', 'Data', 'b.txt'), 'utf8')).toBe('tchau');
  });

  it('a listagem é conferida antes de extrair: "..", unidade e caminho absoluto são recusados', () => {
    const dest = path.resolve('C:/destino');
    expect(checkListing('./\n./windows/\n./windows/jogo.exe\r\n', dest)).toEqual(['windows/', 'windows/jogo.exe']);
    for (const evil of ['../fora.txt', 'windows/../../fora.txt', 'C:/Windows/evil.dll', '/etc/passwd', '..\\fora.txt']) {
      expect(() => checkListing(`ok.txt\n${evil}\n`, dest), evil).toThrow(/inseguro/);
    }
  });

  it('.tar.gz (o único pacote de Windows de alguns ports) sai pelo mesmo caminho', async () => {
    const src = path.join(tmp(), 'srctgz');
    await makeTree(src, { 'tmc/tmc.exe': 'MZ', 'tmc/assets/a.bin': 'x' });
    const file = path.join(tmp(), 'tmc-multi-windows-x86_64-v0.9.6.tar.gz');
    execFileSync(systemTar(), ['-czf', file, '-C', src, '.']);
    expect(TAR_FORMATS.test(path.basename(file))).toBe(true);
    expect(TAR_FORMATS.test('Jogo-Windows.zip')).toBe(false);
    const out = path.join(tmp(), 'out-tgz');
    await fs.mkdir(out);
    expect(await extract7z(file, out)).toEqual({ files: 2 });
    expect(await fs.readFile(path.join(out, 'tmc', 'tmc.exe'), 'utf8')).toBe('MZ');
  });

  it('arquivo corrompido vira erro claro', async () => {
    const file = path.join(tmp(), 'ruim.7z');
    await fs.writeFile(file, '7z de mentira');
    await expect(extract7z(file, tmp())).rejects.toBeInstanceOf(AppError);
  });
});

describe('InstallService: .7z, .exe portátil e instalador', () => {
  const tmp = useTempDir();

  function setup(port: StorePort, asset: Buffer, assetName: string, overrides: Partial<ConstructorParameters<typeof InstallService>[0]> = {}) {
    const db = openDatabase(':memory:');
    const gameRepo = new GameRepository(db);
    const repo = new StoreInstallRepository(db);
    const url = `https://github.com/dono/x/releases/download/v1/${assetName}`;
    const release: StoreRelease = {
      tag: 'v1',
      name: 'v1',
      publishedAt: null,
      prerelease: false,
      notes: '',
      htmlUrl: '',
      windowsAsset: { name: assetName, size: asset.length, downloadUrl: url, sha256: sha(asset) },
    };
    const service = new InstallService({
      store: { port: async () => port, releases: async () => [release] } as unknown as StoreCatalogService,
      repo,
      root: path.join(tmp(), 'Ports'),
      games: {
        get: (id) => gameRepo.get(id)!,
        list: () => gameRepo.list(),
        add: async ({ path: p, title }) => ({
          game: gameRepo.create({ title, kind: 'executable', path: p, corePath: null, launchArgs: null, consoleId: null, raGameId: null, romHash: null, coverUrl: null, backgroundUrl: null, iconUrl: null }),
        }),
        relocate: async (id, p) => gameRepo.updatePath(id, p)!,
      },
      isRunning: () => false,
      backupSave: async () => undefined,
      trash: async (t) => fs.rm(t, { recursive: true, force: true }),
      onProgress: () => undefined,
      onGameAdded: () => undefined,
      runInstaller: async () => undefined,
      pickExecutable: async () => null,
      fetchFn: (async () => response(asset, url)) as FetchFn,
      ...overrides,
    });
    return { service, repo, gameRepo };
  }

  const port = (extra: Partial<StorePort> = {}): StorePort => ({
    id: 'x',
    name: 'Jogo X',
    original: { title: 'X', platform: 'pc' },
    developer: 'd',
    summary: 's',
    description: '',
    tags: [],
    source: { type: 'github', repo: 'dono/x' },
    assets: { windows: 'x' },
    requires: { kind: 'game-files', label: 'x' },
    ...extra,
  });

  it('.7z: extrai, acha o executável e registra como archive', async () => {
    const data = await make7z(tmp(), { 'windows/midas.exe': 'MZ', 'windows/Data/README.txt': 'r' });
    const { service } = setup(port({ executable: 'midas.exe' }), data, 'ProjectMidas-v1-windows.7z');
    const install = await service.install('x');
    expect(install.kind).toBe('archive');
    expect(path.basename(install.exePath)).toBe('midas.exe');
    expect(await fs.readFile(path.join(install.installDir, 'Data', 'README.txt'), 'utf8')).toBe('r');
  });

  it('.tar.gz: passa pela checagem de formato, extrai na raiz e acha o executável', async () => {
    const src = path.join(tmp(), 'src-install-tgz');
    await makeTree(src, { 'tmc_pc.exe': 'MZ', 'assets/a.json': '{}' });
    const file = path.join(tmp(), 'pacote.tar.gz');
    execFileSync(systemTar(), ['-czf', file, '-C', src, '.']);
    const { service } = setup(port({ executable: 'tmc_pc.exe' }), await fs.readFile(file), 'tmc-multi-windows-x86_64-v0.9.6.tar.gz');
    const install = await service.install('x');
    expect(install.kind).toBe('archive');
    expect(path.basename(install.exePath)).toBe('tmc_pc.exe');
    expect(await fs.readFile(path.join(install.installDir, 'assets', 'a.json'), 'utf8')).toBe('{}');
  });

  it('formato que a Loja não abre (.AppImage, .rar) é recusado antes de baixar', async () => {
    const { service } = setup(port(), Buffer.from('x'), 'Jogo.rar');
    await expect(service.install('x')).rejects.toMatchObject({ code: 'VALIDATION', message: expect.stringMatching(/não é suportado/) });
  });

  it('.exe portátil: vira um pacote de um arquivo, com versão e manifesto', async () => {
    const exe = Buffer.from('MZ portátil');
    const { service } = setup(port(), exe, 'SMS-Launcher-0.1.64-win-portable.exe');
    const install = await service.install('x');
    expect(install.kind).toBe('portable');
    expect(path.basename(install.exePath)).toBe('SMS-Launcher-0.1.64-win-portable.exe');
    expect(await fs.readFile(install.exePath, 'utf8')).toBe('MZ portátil');
  });

  it('instalador: roda, acha o jogo nos caminhos do catálogo e desinstalar fica com o Windows', async () => {
    const installedExe = path.join(tmp(), 'Programs', 'Takedawn', 'Takedawn.exe');
    process.env.RV_TEST_HOME = tmp();
    const ran: string[] = [];
    const { service, repo, gameRepo } = setup(port({ installedExe: ['%RV_TEST_HOME%\\Programs\\Takedawn\\Takedawn.exe'] as never }), Buffer.from('MZ setup'), 'Takedawn-0.2.1-windows-x64-setup.exe', {
      runInstaller: async (file) => {
        ran.push(path.basename(file));
        await makeTree(path.dirname(installedExe), { 'Takedawn.exe': 'MZ jogo' }); // "o usuário seguiu o instalador"
      },
    });
    const install = await service.install('x');
    expect(ran[0]).toMatch(/setup\.exe$/);
    expect(install).toMatchObject({ kind: 'installer', exePath: installedExe, installDir: path.dirname(installedExe), previous: null });
    expect(gameRepo.list()[0]!.path).toBe(installedExe);
    expect(await service.uninstall('x')).toEqual({ manual: true });
    expect(repo.get('x')).toBeNull();
    await expect(fs.access(installedExe)).resolves.toBeUndefined(); // o RetroVault não apaga arquivos do Windows
  });

  it('instalador sem o jogo nos caminhos conhecidos: pergunta; se o usuário desistir, cancela com explicação', async () => {
    const { service } = setup(port(), Buffer.from('MZ setup'), 'App-setup.exe', { pickExecutable: async () => null });
    await expect(service.install('x')).rejects.toMatchObject({ code: 'CANCELLED', message: expect.stringMatching(/Adicionar jogo/) });
  });
});
