import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { availableUpdate, type InstallProgress, type StorePort, type StoreRelease } from '@shared/store';
import { openDatabase } from '../../db/database';
import { GameRepository } from '../../db/repositories/gameRepository';
import { StoreInstallRepository } from '../../db/repositories/storeInstallRepository';
import { AppError } from '../../errors';
import { makeTree, useTempDir } from '../../testing/tempDir';
import { buildZip } from '../../testing/zip';
import type { StoreCatalogService } from './catalogService';
import { downloadFile, isAllowedDownloadUrl } from './downloader';
import type { FetchFn } from './githubClient';
import { InstallService, resolveExecutable, safeDirName, type InstallServiceDeps } from './installService';
import { parseCatalog } from './catalogSchema';
import { SEED_CATALOG } from './seedCatalog';
import { carryUserFiles, listFiles, readManifest, writeManifest } from './userFiles';
import { contentRoot, extractZip, safeEntryPath } from './zipExtract';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** Resposta de download a partir de um buffer, em pedaços (como uma rede de verdade). */
function streamResponse(body: Buffer, url = 'https://release-assets.githubusercontent.com/x.zip', chunk = 1024): Response {
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= body.length) return controller.close();
      controller.enqueue(new Uint8Array(body.subarray(i, i + chunk)));
      i += chunk;
    },
  });
  const res = new Response(stream, { status: 200 });
  Object.defineProperty(res, 'url', { value: url });
  return res;
}

describe('extractZip', () => {
  const tmp = useTempDir();

  it('extrai pastas e arquivos e acha a pasta única do topo', async () => {
    const zip = path.join(tmp(), 'a.zip');
    await fs.writeFile(
      zip,
      buildZip([
        { name: 'pd-x86_64-windows/', content: null },
        { name: 'pd-x86_64-windows/pd.x86_64.exe', content: 'MZ' },
        { name: 'pd-x86_64-windows/data/readme.txt', content: 'oi' },
      ]),
    );
    const out = path.join(tmp(), 'out');
    await fs.mkdir(out);
    const progress: number[] = [];
    expect(await extractZip(zip, out, { onProgress: (p) => progress.push(p.files) })).toEqual({ files: 2, bytes: 4 });
    expect(progress).toEqual([1, 2]);
    const root = await contentRoot(out);
    expect(path.basename(root)).toBe('pd-x86_64-windows');
    expect(await fs.readFile(path.join(root, 'data', 'readme.txt'), 'utf8')).toBe('oi');
  });

  it('recusa caminho que sai da pasta (zip slip) e link simbólico', async () => {
    const out = path.join(tmp(), 'out');
    await fs.mkdir(out);
    const evil = path.join(tmp(), 'evil.zip');
    await fs.writeFile(evil, buildZip([{ name: '../fora.txt', content: 'x' }]));
    await expect(extractZip(evil, out)).rejects.toThrow();
    await expect(fs.access(path.join(tmp(), 'fora.txt'))).rejects.toThrow();

    const link = path.join(tmp(), 'link.zip');
    await fs.writeFile(link, buildZip([{ name: 'atalho', content: 'C:/Windows', unixMode: 0o120777 }]));
    await expect(extractZip(link, out)).rejects.toMatchObject({ message: expect.stringMatching(/links simbólicos/) });
  });

  it('safeEntryPath só aceita caminhos dentro da raiz', () => {
    const root = path.resolve('C:/raiz');
    expect(safeEntryPath(root, 'a/b.exe')).toBe(path.join(root, 'a', 'b.exe'));
    expect(safeEntryPath(root, '../b.exe')).toBeNull();
    expect(safeEntryPath(root, 'C:/Windows/b.exe')).toBeNull();
    expect(safeEntryPath(root, '/etc/b')).toBeNull();
  });

  it('extrai muitos arquivos em paralelo sem perder nenhum (fechamento do zip só no fim)', async () => {
    const zip = path.join(tmp(), 'many.zip');
    const specs = Array.from({ length: 300 }, (_, i) => ({ name: `d${i % 7}/f${i}.txt`, content: `conteúdo ${i}` }));
    await fs.writeFile(zip, buildZip(specs));
    const out = path.join(tmp(), 'out');
    await fs.mkdir(out);
    expect((await extractZip(zip, out)).files).toBe(300);
    expect(await fs.readFile(path.join(out, 'd3', 'f150.txt'), 'utf8')).toBe('conteúdo 150');
  });

  it('arquivo que não é zip vira erro claro', async () => {
    const bad = path.join(tmp(), 'bad.zip');
    await fs.writeFile(bad, 'isto não é um zip');
    await expect(extractZip(bad, tmp())).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('downloadFile', () => {
  const tmp = useTempDir();
  const body = Buffer.alloc(5000, 7);

  it('baixa, confere o SHA-256 e só então cria o arquivo final', async () => {
    const dest = path.join(tmp(), 'f.zip');
    const progress: number[] = [];
    const result = await downloadFile('https://github.com/a/b/releases/download/v1/f.zip', dest, {
      expectedSize: body.length,
      expectedSha256: sha(body),
      fetchFn: async () => streamResponse(body),
      onProgress: (p) => progress.push(p.received),
    });
    expect(result.sha256).toBe(sha(body));
    expect(await fs.readFile(dest)).toEqual(body);
    expect(progress.at(-1)).toBe(body.length);
    await expect(fs.access(`${dest}.part`)).rejects.toThrow();
  });

  it('hash diferente, tamanho errado e host estranho são recusados sem deixar arquivo', async () => {
    const dest = path.join(tmp(), 'f.zip');
    const url = 'https://github.com/a/b/releases/download/v1/f.zip';
    await expect(
      downloadFile(url, dest, { expectedSize: body.length, expectedSha256: 'ab'.repeat(32), fetchFn: async () => streamResponse(body) }),
    ).rejects.toMatchObject({ code: 'VALIDATION', message: expect.stringMatching(/SHA-256/) });
    await expect(downloadFile(url, dest, { expectedSize: body.length + 1, expectedSha256: null, fetchFn: async () => streamResponse(body) })).rejects.toMatchObject({
      message: expect.stringMatching(/incompleto/),
    });
    await expect(downloadFile(url, dest, { expectedSize: 10, expectedSha256: null, fetchFn: async () => streamResponse(body) })).rejects.toMatchObject({
      message: expect.stringMatching(/maior/),
    });
    await expect(
      downloadFile(url, dest, { expectedSize: body.length, expectedSha256: null, fetchFn: async () => streamResponse(body, 'https://evil.example/x.zip') }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(downloadFile('https://evil.example/f.zip', dest, { expectedSize: 1, expectedSha256: null })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await fs.readdir(tmp())).toEqual([]);
  });

  it('só aceita https do GitHub', () => {
    expect(isAllowedDownloadUrl('https://github.com/a/b/releases/download/v1/x.zip')).toBe(true);
    expect(isAllowedDownloadUrl('http://github.com/x')).toBe(false);
    expect(isAllowedDownloadUrl('https://github.com.evil.example/x')).toBe(false);
  });
});

describe('resolveExecutable', () => {
  const tmp = useTempDir();

  it('usa o do catálogo; se sumiu, escolhe o principal e ignora atualizadores', async () => {
    await makeTree(tmp(), { 'sm64coopdx.exe': 'MZ jogo', 'coopdx_updater.exe': 'MZ atualizador grande '.repeat(10) });
    expect(path.basename(await resolveExecutable(tmp(), { name: 'x', executable: 'sm64coopdx.exe' }))).toBe('sm64coopdx.exe');
    expect(path.basename(await resolveExecutable(tmp(), { name: 'x', executable: 'renomeado.exe' }))).toBe('sm64coopdx.exe');
  });

  it('sem executável vira erro claro', async () => {
    await makeTree(tmp(), { 'readme.txt': 'oi' });
    await expect(resolveExecutable(tmp(), { name: 'x' })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('todo port do catálogo embutido diz qual executável abrir', () => {
    // Portátil é o próprio .exe baixado; instalador é achado depois (installedExe ou o usuário aponta);
    // os outros dizem qual abrir dentro do pacote.
    for (const p of parseCatalog(SEED_CATALOG).ports) {
      if (p.install === 'portable' || p.install === 'installer') continue;
      expect(p.executable, p.id).toMatch(/\.exe$/);
    }
  });

  it('safeDirName limpa tags estranhas', () => {
    expect(safeDirName('v1.2.2')).toBe('v1.2.2');
    expect(safeDirName('../../x y')).toBe('_.._x_y');
    expect(safeDirName('...')).toBe('versao');
  });
});

describe('availableUpdate', () => {
  const r = (tag: string, opts: { pre?: boolean; sha?: string | null; asset?: boolean } = {}): StoreRelease => ({
    tag,
    name: tag,
    publishedAt: null,
    prerelease: !!opts.pre,
    notes: '',
    htmlUrl: '',
    windowsAsset: opts.asset === false ? null : { name: 'x.zip', size: 1, downloadUrl: 'https://github.com/x', sha256: opts.sha === undefined ? 'aa' : opts.sha },
  });

  it('versão estável mais nova que a instalada', () => {
    expect(availableUpdate([r('v2'), r('v1')], { tag: 'v1', sha256: 'aa' })?.tag).toBe('v2');
    expect(availableUpdate([r('v2'), r('v1')], { tag: 'v2', sha256: 'aa' })).toBeNull();
  });

  it('não sugere "voltar" quando a instalada é uma prévia mais nova que a estável', () => {
    expect(availableUpdate([r('v3-beta', { pre: true }), r('v2')], { tag: 'v3-beta', sha256: 'aa' })).toBeNull();
  });

  it('mesma tag republicada com outro arquivo conta como atualização (só se houver hash publicado)', () => {
    expect(availableUpdate([r('ci-dev-build', { sha: 'bb' })], { tag: 'ci-dev-build', sha256: 'aa' })?.tag).toBe('ci-dev-build');
    expect(availableUpdate([r('ci-dev-build', { sha: null })], { tag: 'ci-dev-build', sha256: 'aa' })).toBeNull();
  });

  it('instalada fora da lista (muito antiga) e versão nova sem arquivo de Windows', () => {
    expect(availableUpdate([r('v9'), r('v8')], { tag: 'v1', sha256: 'aa' })?.tag).toBe('v9');
    expect(availableUpdate([r('v2', { asset: false }), r('v1')], { tag: 'v1', sha256: 'aa' })).toBeNull();
  });
});

describe('carryUserFiles', () => {
  const tmp = useTempDir();

  it('com manifesto: leva só o que não é do pacote de origem nem do destino', async () => {
    const from = path.join(tmp(), 'v1');
    const to = path.join(tmp(), 'v2');
    await makeTree(from, { 'game.exe': 'v1', 'old.dll': 'v1', 'Save/a.sav': 's', 'cfg.json': 'c' });
    await writeManifest(from, ['game.exe', 'old.dll']);
    await makeTree(to, { 'game.exe': 'v2' });
    expect(await carryUserFiles(from, to, new Set(['game.exe']))).toBe(2);
    expect((await listFiles(to)).sort()).toEqual(['Save/a.sav', 'cfg.json', 'game.exe']); // old.dll era do pacote: fica
    expect(await fs.readFile(path.join(to, 'game.exe'), 'utf8')).toBe('v2');
  });

  it('sem manifesto (instalação antiga): leva o que não vem no pacote novo', async () => {
    const from = path.join(tmp(), 'v1');
    const to = path.join(tmp(), 'v2');
    await makeTree(from, { 'game.exe': 'v1', 'Save/a.sav': 's' });
    await makeTree(to, { 'game.exe': 'v2' });
    expect(await carryUserFiles(from, to, new Set(['game.exe']))).toBe(1);
    expect(await fs.readFile(path.join(to, 'Save', 'a.sav'), 'utf8')).toBe('s');
    expect(await readManifest(from)).toBeNull();
  });
});

describe('InstallService', () => {
  const tmp = useTempDir();
  const PORT: StorePort = {
    id: 'demo',
    name: 'Demo Port',
    original: { title: 'Demo', platform: 'n64' },
    developer: 'Equipe',
    summary: 's',
    description: '',
    tags: [],
    source: { type: 'github', repo: 'dono/demo' },
    assets: { windows: 'Windows\\.zip$' },
    executable: 'demo.exe',
    requires: { kind: 'rom', label: 'ROM' },
  };
  const ZIP = buildZip([
    { name: 'demo.exe', content: 'MZ demo' },
    { name: 'assets/', content: null },
    { name: 'assets/a.bin', content: Buffer.alloc(300, 1) },
  ]);
  /** Zip servido por URL de download (cada versão de teste pode ter um conteúdo próprio). */
  const served = new Map<string, Buffer>();
  const release = (tag: string, withHash = true, zip = ZIP, build = ''): StoreRelease => {
    const downloadUrl = `https://github.com/dono/demo/releases/download/${tag}/Demo-Windows${build}.zip`;
    served.set(downloadUrl, zip);
    return {
      tag,
      name: tag,
      publishedAt: null,
      prerelease: false,
      notes: '',
      htmlUrl: '',
      windowsAsset: { name: `Demo-${tag}-Windows.zip`, size: zip.length, downloadUrl, sha256: withHash ? sha(zip) : null },
    };
  };
  /** Pacote de uma versão: o executável e um arquivo de dados marcado com a versão. */
  const zipOf = (label: string) =>
    buildZip([
      { name: 'demo.exe', content: `MZ ${label}` },
      { name: 'data/', content: null },
      { name: 'data/pacote.txt', content: `pacote ${label}` },
    ]);

  function setup(releases: StoreRelease[], overrides: Partial<InstallServiceDeps> = {}) {
    const db = openDatabase(':memory:');
    const gameRepo = new GameRepository(db);
    const repo = new StoreInstallRepository(db);
    const calls = { backups: 0, trashed: [] as string[], added: [] as number[], progress: [] as InstallProgress[] };
    const deps: InstallServiceDeps = {
      store: { port: async () => PORT, releases: async () => releases } as unknown as StoreCatalogService,
      repo,
      root: path.join(tmp(), 'Ports'),
      games: {
        get: (id) => {
          const g = gameRepo.get(id);
          if (!g) throw new AppError('NOT_FOUND', 'Jogo não encontrado');
          return g;
        },
        list: () => gameRepo.list(),
        add: async ({ path: p, title }) => ({
          game: gameRepo.create({ title, kind: 'executable', path: p, corePath: null, launchArgs: null, consoleId: null, raGameId: null, romHash: null, coverUrl: null, backgroundUrl: null, iconUrl: null }),
        }),
        relocate: async (id, p) => gameRepo.updatePath(id, p)!,
      },
      isRunning: () => false,
      backupSave: async () => {
        calls.backups++;
      },
      trash: async (target) => {
        calls.trashed.push(target);
        await fs.rm(target, { recursive: true, force: true });
      },
      onProgress: (p) => calls.progress.push(p),
      onGameAdded: (id) => calls.added.push(id),
      runInstaller: async () => undefined,
      pickExecutable: async () => null,
      fetchFn: (async (url: string) => streamResponse(served.get(url) ?? ZIP)) as FetchFn,
      ...overrides,
    };
    return { service: new InstallService(deps), repo, gameRepo, calls, root: deps.root };
  }

  it('instala: baixa, confere, extrai, registra e coloca na biblioteca', async () => {
    const { service, gameRepo, calls, root } = setup([release('v1')]);
    const install = await service.install('demo');
    expect(install).toMatchObject({ portId: 'demo', tag: 'v1', verified: true, installDir: path.join(root, 'demo', 'v1') });
    expect(install.exePath).toBe(path.join(root, 'demo', 'v1', 'demo.exe'));
    expect(await fs.readFile(install.exePath, 'utf8')).toBe('MZ demo');
    const [game] = gameRepo.list();
    expect(game).toMatchObject({ title: 'Demo Port', path: install.exePath, id: install.gameId });
    expect(calls.added).toEqual([game!.id]);
    expect(calls.backups).toBe(0); // instalação nova: nada para guardar
    expect(new Set(calls.progress.map((p) => p.phase))).toEqual(new Set(['preparing', 'downloading', 'extracting', 'finishing']));
    // Sem restos: nem zip baixado nem pasta temporária.
    expect(await fs.readdir(path.join(root, '.downloads'))).toEqual([]);
    expect(await fs.readdir(path.join(root, '.staging'))).toEqual([]);
  });

  it('versão nova: save no cofre, mesmo jogo na pasta nova, a anterior guardada para voltar', async () => {
    const releases = [release('v1', true, zipOf('v1'))];
    const { service, gameRepo, calls, root } = setup(releases);
    const first = await service.install('demo');
    // O jogo criou arquivos do usuário na pasta (save, configuração) e o usuário mexeu num do pacote.
    await makeTree(first.installDir, { 'Save/file1.sav': 'progresso', 'config.json': '{"volume":3}', 'data/pacote.txt': 'editado' });

    releases.unshift(release('v2', true, zipOf('v2')));
    const second = await service.install('demo');
    const v2 = path.join(root, 'demo', 'v2');
    expect(second).toMatchObject({ tag: 'v2', gameId: first.gameId, previous: { tag: 'v1', installDir: first.installDir } });
    expect(gameRepo.list()).toHaveLength(1);
    expect(gameRepo.get(first.gameId!)!.path).toBe(path.join(v2, 'demo.exe'));
    expect(calls.backups).toBe(1);
    expect(calls.trashed).toEqual([]); // v1 continua no disco
    expect(calls.added).toHaveLength(1);
    // Arquivos do usuário foram junto; os do pacote são os da versão nova.
    expect(await fs.readFile(path.join(v2, 'Save', 'file1.sav'), 'utf8')).toBe('progresso');
    expect(await fs.readFile(path.join(v2, 'config.json'), 'utf8')).toBe('{"volume":3}');
    expect(await fs.readFile(path.join(v2, 'data', 'pacote.txt'), 'utf8')).toBe('pacote v2');
    expect(await fs.readFile(path.join(v2, 'demo.exe'), 'utf8')).toBe('MZ v2');

    // Terceira versão: a v2 vira a anterior e a v1 (de antes da anterior) vai para a Lixeira.
    releases.unshift(release('v3', true, zipOf('v3')));
    const third = await service.install('demo');
    expect(third.previous?.tag).toBe('v2');
    expect(calls.trashed).toEqual([first.installDir]);
    expect(await fs.readFile(path.join(third.installDir, 'Save', 'file1.sav'), 'utf8')).toBe('progresso');
  });

  it('voltar para a anterior: sem baixar, levando o save mais novo; dá para desfazer', async () => {
    const releases = [release('v1', true, zipOf('v1'))];
    let downloads = 0;
    const { service, gameRepo } = setup(releases, {
      fetchFn: (async (url: string) => {
        downloads++;
        return streamResponse(served.get(url)!);
      }) as FetchFn,
    });
    const v1 = await service.install('demo');
    releases.unshift(release('v2', true, zipOf('v2')));
    const v2 = await service.install('demo');
    await makeTree(v2.installDir, { 'Save/file1.sav': 'jogado na v2' });
    expect(downloads).toBe(2);

    const back = await service.rollback('demo');
    expect(back).toMatchObject({ tag: 'v1', installDir: v1.installDir, previous: { tag: 'v2' } });
    expect(gameRepo.get(v1.gameId!)!.path).toBe(v1.exePath);
    expect(await fs.readFile(path.join(v1.installDir, 'Save', 'file1.sav'), 'utf8')).toBe('jogado na v2');
    expect(await fs.readFile(path.join(v1.installDir, 'data', 'pacote.txt'), 'utf8')).toBe('pacote v1');

    // Pedir a v2 pela lista de versões: ela é a anterior agora, então troca sem baixar.
    const forward = await service.install('demo', 'v2');
    expect(forward).toMatchObject({ tag: 'v2', previous: { tag: 'v1' } });
    expect(downloads).toBe(2);
  });

  it('compilação republicada com a mesma tag ganha pasta própria e a anterior continua', async () => {
    const releases = [release('ci-dev-build', true, zipOf('build-1'))];
    const { service, root } = setup(releases);
    const first = await service.install('demo');
    releases[0] = release('ci-dev-build', true, zipOf('build-2'), '-2');
    const second = await service.install('demo');
    expect(first.installDir).toBe(path.join(root, 'demo', 'ci-dev-build'));
    expect(second.installDir).toBe(path.join(root, 'demo', `ci-dev-build-${second.sha256.slice(0, 8)}`));
    expect(second.previous?.installDir).toBe(first.installDir);
    expect(await fs.readFile(path.join(second.installDir, 'demo.exe'), 'utf8')).toBe('MZ build-2');
  });

  it('updates() aponta só os ports com versão nova', async () => {
    const releases = [release('v1', true, zipOf('v1'))];
    const { service } = setup(releases);
    await service.install('demo');
    expect(await service.updates()).toEqual({});
    releases.unshift(release('v2', true, zipOf('v2')));
    expect(await service.updates()).toEqual({ demo: { tag: 'v2', name: 'v2', sizeBytes: zipOf('v2').length } });
  });

  it('atualizar tudo: instala a versão nova; jogo aberto fica de fora até fechar', async () => {
    const releases = [release('v1', true, zipOf('v1'))];
    let running = false;
    const { service } = setup(releases, { isRunning: () => running });
    await service.install('demo');
    releases.unshift(release('v2', true, zipOf('v2')));

    running = true;
    expect(await service.updateAll()).toEqual({ updated: [], skipped: [{ portId: 'demo', reason: 'running' }], failed: [] });

    running = false;
    expect(await service.updateAll()).toEqual({ updated: ['demo'], skipped: [], failed: [] });
    expect(await service.updates()).toEqual({}); // nada mais a atualizar
    expect((await service.updateAll()).updated).toEqual([]);
  });

  it('atualizar tudo: falha de um port vira item da lista, não exceção', async () => {
    const releases = [release('v1', true, zipOf('v1'))];
    const { service } = setup(releases);
    await service.install('demo');
    // Versão nova com hash publicado diferente do arquivo servido: o download é recusado.
    const broken = release('v2', true, zipOf('v2'));
    releases.unshift({ ...broken, windowsAsset: { ...broken.windowsAsset!, sha256: '0'.repeat(64) } });
    const result = await service.updateAll();
    expect(result.updated).toEqual([]);
    expect(result.failed).toEqual([{ portId: 'demo', message: expect.any(String) }]);
  });

  it('desinstalar com versão anterior manda as duas para a Lixeira', async () => {
    const releases = [release('v1', true, zipOf('v1'))];
    const { service, calls } = setup(releases);
    const v1 = await service.install('demo');
    releases.unshift(release('v2', true, zipOf('v2')));
    const v2 = await service.install('demo');
    await service.uninstall('demo');
    expect(calls.trashed.sort()).toEqual([v1.installDir, v2.installDir].sort());
  });

  it('sem versão anterior, voltar é recusado com mensagem clara', async () => {
    const { service } = setup([release('v1')]);
    await service.install('demo');
    await expect(service.rollback('demo')).rejects.toMatchObject({ code: 'NOT_FOUND', message: expect.stringMatching(/versão anterior/) });
  });

  it('desinstalar guarda o save, manda para a Lixeira e mantém o jogo; reinstalar religa', async () => {
    const { service, repo, gameRepo, calls, root } = setup([release('v1', false)]);
    const install = await service.install('demo');
    expect(install.verified).toBe(false); // sem hash publicado: conferido só pelo tamanho
    await service.uninstall('demo');
    expect(calls.backups).toBe(1);
    expect(calls.trashed).toEqual([path.join(root, 'demo', 'v1')]);
    expect(repo.get('demo')).toBeNull();
    expect(gameRepo.list()).toHaveLength(1);
    await expect(fs.access(path.join(root, 'demo'))).rejects.toThrow(); // pasta vazia do port também some

    const again = await service.install('demo');
    expect(again.gameId).toBe(install.gameId);
    expect(calls.added).toHaveLength(1);
  });

  it('cancelar no meio do download não deixa nada para trás', async () => {
    let service!: InstallService;
    const slow: FetchFn = async (_url, init) => {
      const res = streamResponse(ZIP, undefined, 64);
      queueMicrotask(() => service.cancel('demo'));
      return init.signal.aborted ? Promise.reject(new Error('abortado')) : res;
    };
    const ctx = setup([release('v1')], { fetchFn: slow });
    service = ctx.service;
    await expect(service.install('demo')).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(ctx.repo.get('demo')).toBeNull();
    expect(ctx.gameRepo.list()).toHaveLength(0);
    expect(await fs.readdir(path.join(ctx.root, '.downloads'))).toEqual([]);
  });

  it('recusa instalar duas vezes ao mesmo tempo, com o jogo aberto ou sem versão para Windows', async () => {
    const { service } = setup([release('v1')]);
    const first = service.install('demo');
    await expect(service.install('demo')).rejects.toMatchObject({ code: 'ALREADY_RUNNING' });
    await first;

    const running = setup([release('v1')], { isRunning: () => true });
    await running.service.install('demo');
    await expect(running.service.install('demo')).rejects.toMatchObject({ message: expect.stringMatching(/Feche o jogo/) });
    await expect(running.service.uninstall('demo')).rejects.toMatchObject({ code: 'ALREADY_RUNNING' });

    const none = setup([{ ...release('v1'), windowsAsset: null }]);
    await expect(none.service.install('demo')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('limpa restos de uma instalação interrompida', async () => {
    const { service, root } = setup([release('v1')]);
    await makeTree(root, { '.staging/demo-abc/x.bin': 'x', '.downloads/demo-v1.zip.part': 'x', 'demo/v1/demo.exe': 'MZ' });
    await service.cleanupLeftovers();
    expect((await fs.readdir(root)).sort()).toEqual(['demo']);
  });
});
