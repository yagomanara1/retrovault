import { describe, expect, it } from 'vitest';
import type { CustomPortInput, StorePort } from '@shared/store';
import { openDatabase } from '../../db/database';
import { CacheRepository } from '../../db/repositories/cacheRepository';
import { CustomPortRepository } from '../../db/repositories/customPortRepository';
import { ApiCache } from '../apiCache';
import { pickAsset } from './catalogSchema';
import { StoreCatalogService } from './catalogService';
import { CustomPortService, parseRepoInput, patternFromAssetName, suggestOriginalTitle, windowsCandidates } from './customPorts';
import type { GitHubClient } from './githubClient';

const asAssets = (names: string[]) => names.map((name) => ({ name, size: 1000 }));

describe('link do repositório', () => {
  it.each([
    ['https://github.com/opentyrian/opentyrian', 'opentyrian/opentyrian'],
    ['github.com/opentyrian/opentyrian/releases/latest', 'opentyrian/opentyrian'],
    ['https://github.com/OpenRCT2/OpenRCT2.git', 'OpenRCT2/OpenRCT2'],
    ['https://github.com/a/b/releases/tag/v1.0', 'a/b'],
    ['  dono/projeto  ', 'dono/projeto'],
  ])('%s → %s', (input, repo) => {
    expect(parseRepoInput(input)).toBe(repo);
  });

  it('recusa o que não é repositório do GitHub', () => {
    for (const bad of ['https://gitlab.com/a/b', 'https://github.com/so-o-dono', 'não é link', '../../etc/passwd']) expect(parseRepoInput(bad), bad).toBeNull();
  });
});

describe('jogo original sugerido', () => {
  it.each([
    ['Super Metroid Launcher', 'Super Metroid'],
    ['Jet Force Gemini Recomp', 'Jet Force Gemini'],
    ['Silent Hill Native PC Port', 'Silent Hill'],
    ['Port', 'Port'], // sobraria nada: fica o nome
  ])('%s → %s', (name, title) => {
    expect(suggestOriginalTitle(name)).toBe(title);
  });
});

describe('regra do arquivo a partir do nome', () => {
  it('reconhece a próxima versão e mantém a arquitetura', () => {
    const rocket = patternFromAssetName('Rocket-R-1.0.1-Windows-x64.zip');
    expect(rocket).toBe('^Rocket-R-\\d+\\.\\d+\\.\\d+-Windows-x64\\.zip$');
    expect(pickAsset(asAssets(['Rocket-R-1.0.2-Linux-x86_64.AppImage', 'Rocket-R-1.0.2-Windows-x64.zip']), rocket)?.name).toBe('Rocket-R-1.0.2-Windows-x64.zip');
    // win64 não vira "win\d+" (senão pegaria o win32).
    const ttd = patternFromAssetName('openttd-jgrpp-0.73.4-windows-win64.zip');
    expect(pickAsset(asAssets(['openttd-jgrpp-0.74.0-windows-win32.zip', 'openttd-jgrpp-0.74.0-windows-win64.zip']), ttd)?.name).toBe('openttd-jgrpp-0.74.0-windows-win64.zip');
    // Nome sem versão: só o próprio nome.
    expect(patternFromAssetName('SotC-PC.zip')).toBe('^SotC-PC\\.zip$');
  });

  it('caracteres especiais do nome não viram regex', () => {
    const p = patternFromAssetName('Game (Beta)+v1.zip');
    expect(new RegExp(p).test('Game (Beta)+v2.zip')).toBe(true);
    expect(new RegExp(p).test('Game Beta+v2.zip')).toBe(false);
  });
});

describe('arquivos de Windows de uma release', () => {
  it('sugere o de Windows e descarta Linux, Mac, Android, ARM, hashes e código-fonte', () => {
    const list = windowsCandidates(
      asAssets([
        'ico-pc-v0.8.5-android.apk',
        'ico-pc-v0.8.5-linux-x86_64.AppImage',
        'ico-pc-v0.8.5-macos-arm64.zip',
        'ico-pc-v0.8.5-win-portable.zip',
        'ico-pc-v0.8.5-win.zip',
        'opentyrian-windows-arm64.zip',
        'Game-1.0-source.zip',
        'Game-1.0-windows.zip.sha256',
        'SHA256SUMS.txt',
      ]),
    );
    expect(list.map((a) => a.name)).toEqual(['ico-pc-v0.8.5-win-portable.zip', 'ico-pc-v0.8.5-win.zip']);
  });

  it('nome sem "windows" também entra, depois dos que parecem de Windows', () => {
    expect(windowsCandidates(asAssets(['renut.zip', 'renut-x86_64.AppImage', 'Setup-win64.exe'])).map((a) => a.name)).toEqual(['Setup-win64.exe', 'renut.zip']);
  });
});

describe('CustomPortService', () => {
  const CATALOG_PORT = { id: 'opentyrian', name: 'OpenTyrian', source: { type: 'github', repo: 'opentyrian/opentyrian' } } as StorePort;

  function setup(opts: { latest?: { tag: string; assets: { name: string; size: number }[] } | null; installed?: string[] } = {}) {
    const db = openDatabase(':memory:');
    const repo = new CustomPortRepository(db);
    const github = { latestAssets: async () => (opts.latest === undefined ? { tag: 'v1.2', assets: asAssets(['Jogo-1.2-windows-x64.zip', 'Jogo-1.2-linux.tar.gz']) } : opts.latest) };
    const service = new CustomPortService({ repo, github, catalogPorts: async () => [CATALOG_PORT], isInstalled: (id) => (opts.installed ?? []).includes(id) });
    return { service, repo, db };
  }
  const input = (over: Partial<CustomPortInput> = {}): CustomPortInput => ({
    repo: 'https://github.com/equipe/jogo-port',
    name: 'Jogo Port',
    originalTitle: 'Jogo',
    platform: 'ps2',
    system: 'PlayStation 2',
    assetPattern: patternFromAssetName('Jogo-1.2-windows-x64.zip'),
    requiresKind: 'game-files',
    requiresLabel: 'A ISO do seu disco',
    ...over,
  });

  it('inspeciona: sugere nome e o arquivo de Windows da versão mais recente', async () => {
    const { service } = setup();
    const found = await service.inspect('github.com/equipe/jogo-port');
    expect(found).toMatchObject({ repo: 'equipe/jogo-port', suggestedName: 'Jogo Port', suggestedTitle: 'Jogo', latestTag: 'v1.2' });
    expect(found.assets.map((a) => a.name)).toEqual(['Jogo-1.2-windows-x64.zip']);
  });

  it('recusa projeto que já está no catálogo, repositório sem versões e versão sem Windows', async () => {
    await expect(setup().service.inspect('https://github.com/OpenTyrian/OpenTyrian')).rejects.toMatchObject({ code: 'DUPLICATE', message: expect.stringMatching(/OpenTyrian/) });
    await expect(setup({ latest: null }).service.inspect('a/b')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(setup({ latest: { tag: 'v1', assets: asAssets(['x-linux.tar.gz', 'x.dmg']) } }).service.inspect('a/b')).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('adiciona como item válido do catálogo, marcado como do usuário, com id próprio', async () => {
    const { service } = setup();
    const port = await service.add(input());
    expect(port).toMatchObject({
      id: 'meu-jogo-port',
      custom: true,
      source: { repo: 'equipe/jogo-port' },
      original: { platform: 'ps2', system: 'PlayStation 2' },
      requires: { kind: 'game-files', label: 'A ISO do seu disco' },
      homepage: 'https://github.com/equipe/jogo-port',
    });
    expect(service.list().map((p) => p.id)).toEqual(['meu-jogo-port']);
    // O mesmo projeto de novo: recusado.
    await expect(service.add(input())).rejects.toMatchObject({ code: 'DUPLICATE' });
  });

  it('recusa regra que não acha arquivo na versão mais recente (ou que não é regex)', async () => {
    const { service } = setup();
    await expect(service.add(input({ assetPattern: '^nada\\.zip$' }))).rejects.toMatchObject({ message: expect.stringMatching(/não encontra/) });
    await expect(service.add(input({ assetPattern: '([' }))).rejects.toMatchObject({ message: expect.stringMatching(/regular/) });
  });

  it('jogo gratuito não tem assistente; remover só sem estar instalado', async () => {
    const free = setup();
    const port = await free.service.add(input({ requiresKind: 'none', requiresLabel: '' }));
    expect(port.setup).toBeUndefined();
    free.service.remove(port.id);
    expect(free.service.list()).toEqual([]);

    const busy = setup({ installed: ['meu-jogo-port'] });
    await busy.service.add(input());
    expect(() => busy.service.remove('meu-jogo-port')).toThrow(/Desinstale/);
  });

  it('a Loja mostra o catálogo e depois os adicionados; o catálogo vence se trouxer o mesmo projeto', async () => {
    const { service, db } = setup();
    await service.add(input());
    const store = new StoreCatalogService({
      cache: new ApiCache(new CacheRepository(db)),
      github: {} as GitHubClient,
      remoteUrl: () => null,
      customPorts: () => [...service.list(), { ...service.list()[0]!, id: 'meu-repetido', source: { type: 'github', repo: 'opentyrian/opentyrian' } }],
    });
    const ports = (await store.catalog()).ports;
    expect(ports.at(-1)).toMatchObject({ id: 'meu-jogo-port', custom: true });
    expect(ports.some((p) => p.id === 'meu-repetido')).toBe(false);
    // Exportar leva o adicionado sem a marca "custom" (não faz parte do formato do catalog.json).
    const exported = JSON.parse(await store.exportJson());
    expect(exported.ports.find((p: StorePort) => p.id === 'meu-jogo-port')).not.toHaveProperty('custom');
  });
});
