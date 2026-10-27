import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { StoreInstall, StorePort } from '@shared/store';
import { openDatabase } from '../../db/database';
import { CacheRepository } from '../../db/repositories/cacheRepository';
import { ModInstallRepository } from '../../db/repositories/modInstallRepository';
import { useTempDir } from '../../testing/tempDir';
import { buildZip } from '../../testing/zip';
import { ApiCache } from '../apiCache';
import type { FetchFn } from '../http';
import { GAMEBANANA_HOSTS, isAllowedDownloadUrl } from './downloader';
import { GameBananaClient, htmlToText, type GbModDetails } from './gameBanana';
import { ModService } from './modService';

const md5 = (b: Buffer) => createHash('md5').update(b).digest('hex');

function respond(body: Buffer | string, url: string, type = 'application/octet-stream'): Response {
  const r = new Response(typeof body === 'string' ? body : new Uint8Array(body), { status: 200, headers: { 'content-type': type } });
  Object.defineProperty(r, 'url', { value: url });
  return r;
}

describe('GameBanana: endereços e texto', () => {
  it('downloads só do GameBanana (inclusive os servidores de cache), sempre https', () => {
    for (const ok of ['https://gamebanana.com/dl/1', 'https://files.gamebanana.com/mods/x.zip', 'https://filecache44.gamebanana.com/mods/x.zip']) {
      expect(isAllowedDownloadUrl(ok, GAMEBANANA_HOSTS), ok).toBe(true);
    }
    for (const bad of ['http://gamebanana.com/dl/1', 'https://evilgamebanana.com/x', 'https://gamebanana.com.evil.example/x', 'https://github.com/a/b']) {
      expect(isAllowedDownloadUrl(bad, GAMEBANANA_HOSTS), bad).toBe(false);
    }
    // O padrão continua sendo só o GitHub (os ports não passam a aceitar o GameBanana).
    expect(isAllowedDownloadUrl('https://files.gamebanana.com/mods/x.zip')).toBe(false);
  });

  it('texto do mod sem HTML, com as quebras de linha', () => {
    expect(htmlToText('<h1>Oi</h1>Linha 1<br>Linha&nbsp;2 &amp; 3<ul><li>a</li><li>b</li></ul><script>x</script>')).toBe('Oi\nLinha 1\nLinha 2 & 3• a\n• b\nx');
  });

  it('lista esconde mods com conteúdo adulto e obsoletos, e só aceita imagem do servidor de imagens', async () => {
    const records = [
      { _idRow: 1, _sName: 'Bom', _sProfileUrl: '', _nLikeCount: 5, _aPreviewMedia: { _aImages: [{ _sBaseUrl: 'https://images.gamebanana.com/img/ss/mods', _sFile220: '220-a.jpg' }] } },
      { _idRow: 2, _sName: 'Adulto', _sProfileUrl: '', _bHasContentRatings: true },
      { _idRow: 3, _sName: 'Velho', _sProfileUrl: '', _bIsObsolete: true },
      { _idRow: 4, _sName: 'Imagem estranha', _sProfileUrl: '', _aPreviewMedia: { _aImages: [{ _sBaseUrl: 'https://evil.example/img', _sFile220: 'x.jpg' }] } },
    ];
    let asked = '';
    const gb = new GameBananaClient(new ApiCache(new CacheRepository(openDatabase(':memory:'))), (async (url: string) => {
      asked = url;
      return respond(JSON.stringify({ _aRecords: records, _aMetadata: { _nRecordCount: 4 } }), url, 'application/json');
    }) as FetchFn);
    const { mods } = await gb.listMods(16121, { page: 1, sort: 'popular', query: 'link' });
    expect(mods.map((m) => m.name)).toEqual(['Bom', 'Imagem estranha']);
    expect(mods[0]!.thumbUrl).toBe('https://images.gamebanana.com/img/ss/mods/220-a.jpg');
    expect(mods[1]!.thumbUrl).toBeNull();
    expect(decodeURIComponent(asked)).toContain('_aFilters[Generic_Name]=contains,link');
    expect(asked).toContain('Generic_MostLiked');
  });
});

describe('ModService', () => {
  const tmp = useTempDir();
  const PORT = { id: 'shipwright', name: 'Ship of Harkinian', mods: { gamebanana: 16121, folder: 'mods', extensions: ['.otr', '.o2r'] } } as StorePort;

  /** Pacote de mod de verdade: o .o2r numa subpasta, mais um leia-me que não deve ir para a pasta de mods. */
  const MOD_ZIP = buildZip([
    { name: 'MeuMod/', content: null },
    { name: 'MeuMod/link.o2r', content: 'o2r do mod' },
    { name: 'MeuMod/LEIA-ME.txt', content: 'instruções' },
  ]);

  function setup(opts: { files?: GbModDetails['files']; running?: boolean; installed?: boolean } = {}) {
    const installDir = path.join(tmp(), 'Ports', 'shipwright', 'v1');
    const install = { portId: 'shipwright', kind: 'archive', installDir, gameId: 7 } as StoreInstall;
    const served = new Map<string, Buffer>([['https://gamebanana.com/dl/10', MOD_ZIP]]);
    const files = opts.files ?? [{ id: 10, name: 'meumod.zip', size: MOD_ZIP.length, md5: md5(MOD_ZIP), downloadUrl: 'https://gamebanana.com/dl/10', scanOk: true, description: null }];
    const detailsOf = (id: number, name: string): GbModDetails => ({
      id, name, category: 'Models', author: 'Autor', likes: 1, version: '1.0', updatedAt: null, thumbUrl: null, url: '', text: '', imageUrls: [], downloads: 0, files,
    });
    const repo = new ModInstallRepository(openDatabase(':memory:'));
    const service = new ModService({
      store: { port: async () => PORT },
      installs: { get: () => (opts.installed === false ? null : install) },
      repo,
      gb: { listMods: async () => ({ mods: [], total: 0 }), modDetails: async (id) => detailsOf(id, id === 1 ? 'Mod Um' : 'Mod Dois') },
      importImage: async (u) => u,
      workDir: path.join(tmp(), 'Ports', '.mods'),
      isRunning: () => !!opts.running,
      onProgress: () => undefined,
      // O GameBanana redireciona para o servidor de cache: o endereço final é outro subdomínio.
      fetchFn: (async (url: string) => respond(served.get(url)!, 'https://filecache44.gamebanana.com/mods/meumod.zip')) as FetchFn,
    });
    return { service, installDir, repo };
  }

  it('instala só os arquivos que o port lê, na pasta de mods, e remove só eles', async () => {
    const { service, installDir } = setup();
    await fs.mkdir(path.join(installDir, 'mods'), { recursive: true });
    await fs.writeFile(path.join(installDir, 'mods', 'meu-proprio.otr'), 'colocado à mão');

    const mod = await service.install('shipwright', 1, 10);
    expect(mod).toMatchObject({ modId: 1, fileId: 10, name: 'Mod Um', files: ['mods/link.o2r'] });
    expect(await fs.readFile(path.join(installDir, 'mods', 'link.o2r'), 'utf8')).toBe('o2r do mod');
    await expect(fs.access(path.join(installDir, 'mods', 'LEIA-ME.txt'))).rejects.toThrow();
    expect((await service.installed('shipwright')).map((m) => m.modId)).toEqual([1]);

    await service.uninstall('shipwright', 1);
    await expect(fs.access(path.join(installDir, 'mods', 'link.o2r'))).rejects.toThrow();
    expect(await fs.readFile(path.join(installDir, 'mods', 'meu-proprio.otr'), 'utf8')).toBe('colocado à mão'); // o que não é do mod fica
    expect(await service.installed('shipwright')).toEqual([]);
  });

  it('reinstalar o mesmo mod troca os arquivos; outro mod com o mesmo arquivo é recusado', async () => {
    const { service } = setup();
    await service.install('shipwright', 1, 10);
    expect((await service.install('shipwright', 1, 10)).files).toEqual(['mods/link.o2r']);
    await expect(service.install('shipwright', 2, 10)).rejects.toMatchObject({ code: 'DUPLICATE', message: expect.stringMatching(/Mod Um/) });
  });

  it('arquivo com o mesmo nome colocado fora da Loja não é sobrescrito', async () => {
    const { service, installDir } = setup();
    await fs.mkdir(path.join(installDir, 'mods'), { recursive: true });
    await fs.writeFile(path.join(installDir, 'mods', 'link.o2r'), 'do usuário');
    await expect(service.install('shipwright', 1, 10)).rejects.toMatchObject({ code: 'DUPLICATE' });
    expect(await fs.readFile(path.join(installDir, 'mods', 'link.o2r'), 'utf8')).toBe('do usuário');
  });

  it('MD5 diferente, análise de vírus pendente, pacote sem o que o port lê: recusados sem deixar nada', async () => {
    const wrongMd5 = setup({ files: [{ id: 10, name: 'meumod.zip', size: MOD_ZIP.length, md5: '0'.repeat(32), downloadUrl: 'https://gamebanana.com/dl/10', scanOk: true, description: null }] });
    await expect(wrongMd5.service.install('shipwright', 1, 10)).rejects.toMatchObject({ message: expect.stringMatching(/MD5/) });
    await expect(fs.readdir(path.join(wrongMd5.installDir, 'mods'))).rejects.toThrow();

    const pending = setup({ files: [{ id: 10, name: 'meumod.zip', size: MOD_ZIP.length, md5: null, downloadUrl: 'https://gamebanana.com/dl/10', scanOk: false, description: null }] });
    await expect(pending.service.install('shipwright', 1, 10)).rejects.toMatchObject({ message: expect.stringMatching(/vírus/) });

    const PNG_ONLY = buildZip([{ name: 'textura.png', content: 'x' }]);
    const noMod = setup({ files: [{ id: 10, name: 'meumod.zip', size: PNG_ONLY.length, md5: md5(PNG_ONLY), downloadUrl: 'https://gamebanana.com/dl/10', scanOk: true, description: null }] });
    // O servidor serve este outro pacote.
    (noMod.service as unknown as { deps: { fetchFn: FetchFn } }).deps.fetchFn = (async () => respond(PNG_ONLY, 'https://files.gamebanana.com/mods/x.zip')) as FetchFn;
    await expect(noMod.service.install('shipwright', 1, 10)).rejects.toMatchObject({ message: expect.stringMatching(/\.otr ou \.o2r/) });
  });

  it('port não instalado ou aberto: não instala', async () => {
    await expect(setup({ installed: false }).service.install('shipwright', 1, 10)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(setup({ running: true }).service.install('shipwright', 1, 10)).rejects.toMatchObject({ code: 'ALREADY_RUNNING' });
  });

  it('mod apagado à mão da pasta sai da lista de instalados', async () => {
    const { service, installDir } = setup();
    await service.install('shipwright', 1, 10);
    await fs.rm(path.join(installDir, 'mods', 'link.o2r'));
    expect(await service.installed('shipwright')).toEqual([]);
  });
});
