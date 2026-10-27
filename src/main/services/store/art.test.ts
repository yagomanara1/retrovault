import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { StorePort } from '@shared/store';
import { openDatabase } from '../../db/database';
import { CacheRepository } from '../../db/repositories/cacheRepository';
import { StoreArtRepository } from '../../db/repositories/storeArtRepository';
import { ApiCache } from '../apiCache';
import { z } from 'zod';
import { toIpcError } from '../../errors';
import { isAllowedArtUrl, parseCatalog, toRawGitHubUrl } from './catalogSchema';
import { StoreCatalogService } from './catalogService';
import { GitHubClient, type FetchFn } from './githubClient';
import { gitSymlinkTarget, imageFormat, pngFromIco, StoreArtService } from './storeArt';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 3)]);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function image(data: Buffer, url: string): Response {
  const r = new Response(new Uint8Array(data), { status: 200, headers: { 'content-type': 'image/png' } });
  Object.defineProperty(r, 'url', { value: url });
  return r;
}

const PORT: StorePort = {
  id: 'perfect-dark',
  name: 'Perfect Dark',
  original: { title: 'Perfect Dark', platform: 'n64' },
  developer: 'x',
  summary: 's',
  description: '',
  tags: [],
  source: { type: 'github', repo: 'a/b' },
  assets: { windows: 'x' },
  requires: { kind: 'rom', label: 'ROM' },
  art: { logo: 'https://raw.githubusercontent.com/a/b/main/logo.png' },
};

/** SteamGridDB simulado no formato da API v2 ({ success, data }). */
function sgdbFetch(log: string[], opts: { outage?: () => boolean; unauthorized?: boolean } = {}): FetchFn {
  return async (url, init) => {
    log.push(url);
    if (url.startsWith('https://www.steamgriddb.com/api/v2/')) {
      if (opts.outage?.()) return new Response('', { status: 200, headers: { 'content-type': 'text/html; charset=UTF-8' } });
      if (opts.unauthorized || init.headers.Authorization !== 'Bearer chave-valida-123456') return json({ success: false, errors: ['Unauthorized'] }, 401);
      const path = url.slice('https://www.steamgriddb.com/api/v2'.length);
      if (path.startsWith('/search/autocomplete/')) return json({ success: true, data: [{ id: 5, name: 'Perfect Dark Zero' }, { id: 7, name: 'Perfect Dark' }] });
      const kind = path.split('/')[1]!; // grids | heroes | logos | icons
      expect(path).toContain('/game/7');
      return json({ success: true, data: [{ url: 'http://evil.example/x.png' }, { url: `https://cdn2.steamgriddb.com/${kind}/7.png` }] });
    }
    return image(url.includes('cdn2') ? JPG : PNG, url);
  };
}

function setup(key: string | null, fetchFn: FetchFn) {
  const db = openDatabase(':memory:');
  const saved: string[] = [];
  /** Arquivos "apagados do cofre" (para simular alguém limpando a pasta de artes fora do app). */
  const removed = new Set<string>();
  const service = new StoreArtService({
    artwork: {
      has: async (url) => !removed.has(url),
      saveGraphic: async (data, format) => {
        saved.push(format);
        return `rv-media://artwork/${createHash('md5').update(data).digest('hex')}.${format}`;
      },
      // Como no app: foto reduzida e recodificada em JPEG.
      savePhoto: async (data) => {
        saved.push('foto');
        return `rv-media://artwork/${createHash('md5').update(data).digest('hex')}.jpg`;
      },
    },
    repo: new StoreArtRepository(db),
    cache: new ApiCache(new CacheRepository(db)),
    sgdbKey: () => key,
    fetchFn,
  });
  return { service, saved, removed };
}

describe('imagens da Loja', () => {
  it('reconhece imagem pela assinatura e só aceita hosts permitidos', () => {
    expect(imageFormat(PNG)).toBe('png');
    expect(imageFormat(JPG)).toBe('jpg');
    expect(imageFormat(Buffer.from('<html>'))).toBeNull();
    expect(isAllowedArtUrl('https://cdn2.steamgriddb.com/grid/1.png')).toBe(true);
    expect(isAllowedArtUrl('https://raw.githubusercontent.com/a/b/x.png')).toBe(true);
    expect(isAllowedArtUrl('http://cdn2.steamgriddb.com/grid/1.png')).toBe(false);
    expect(isAllowedArtUrl('https://evil.example/x.png')).toBe(false);
  });

  it('catálogo recusa logo de host não permitido', () => {
    const { ports, skipped } = parseCatalog({ schemaVersion: 1, ports: [{ ...PORT, art: { logo: 'https://evil.example/x.png' } }] });
    expect(ports).toHaveLength(0);
    expect(skipped.join()).toMatch(/raw\.githubusercontent/);
  });
});

describe('StoreArtService', () => {
  it('sem chave: logo do projeto, baixado uma vez só', async () => {
    const log: string[] = [];
    const { service } = setup(null, sgdbFetch(log));
    const art = await service.art(PORT);
    expect(art).toMatchObject({ source: 'project', cover: null, logo: expect.stringMatching(/^rv-media:\/\/artwork\/.+\.png$/) });
    service.invalidate();
    await service.art(PORT);
    expect(log.filter((u) => u.includes('logo.png'))).toHaveLength(1); // segunda vez vem do store_art
    expect(service.referencedArtwork()).toEqual([art.logo]);
  });

  it('falta de internet ao baixar uma imagem vira STORE_NETWORK, como nos outros clientes', async () => {
    const { service } = setup(null, async () => {
      throw new TypeError('fetch failed');
    });
    await expect(service.importRemote(PORT.art!.logo!, { photo: false })).rejects.toMatchObject({ code: 'STORE_NETWORK' });
  });

  it('arquivo apagado do cofre fora do app: baixa de novo em vez de devolver um endereço quebrado', async () => {
    const log: string[] = [];
    const { service, removed } = setup(null, sgdbFetch(log));
    const logoFetches = () => log.filter((u) => u.includes('logo.png')).length;
    const first = await service.art(PORT);
    expect(logoFetches()).toBe(1);
    removed.add(first.logo!); // alguém limpou a pasta de artes
    const again = await service.art(PORT);
    expect(logoFetches()).toBe(2); // conferiu o cofre e baixou de novo (o nome é o md5: o mesmo endereço)
    expect(again.logo).toBe(first.logo);
  });

  it('sem chave: a capa do catálogo (libretro) vira a capa do port, guardada como foto leve', async () => {
    const { service, saved } = setup(null, sgdbFetch([]));
    const art = await service.art({
      ...PORT,
      art: { boxart: 'https://raw.githubusercontent.com/libretro-thumbnails/x/master/Named_Boxarts/PD.png', logo: PORT.art!.logo },
    });
    expect(art).toMatchObject({ source: 'project', cover: expect.stringMatching(/\.jpg$/), logo: expect.stringMatching(/\.png$/) });
    expect(saved.sort()).toEqual(['foto', 'png']); // capa → foto (JPEG reduzido); logo mantém a transparência
  });

  it('com chave: escolhe o jogo de nome igual e a primeira imagem permitida de cada tipo', async () => {
    const log: string[] = [];
    const { service } = setup('chave-valida-123456', sgdbFetch(log));
    const art = await service.art(PORT);
    expect(art.source).toBe('steamgriddb');
    for (const slot of ['cover', 'hero', 'logo', 'icon'] as const) expect(art[slot], slot).toMatch(/^rv-media:\/\/artwork\/.+\.jpg$/);
    expect(log.some((u) => u.includes('evil.example'))).toBe(false);
    expect(log.find((u) => u.includes('/grids/'))).toContain('dimensions=600x900');
    expect(log.find((u) => u.includes('/grids/'))).toContain('nsfw=false');
  });

  it('SteamGridDB instável (200 com HTML vazio): usa o logo do projeto e tenta de novo depois', async () => {
    const log: string[] = [];
    let down = true;
    const { service } = setup('chave-valida-123456', sgdbFetch(log, { outage: () => down }));
    expect((await service.art(PORT)).source).toBe('project');
    down = false;
    expect((await service.art(PORT)).source).toBe('steamgriddb'); // a falha não ficou em cache
  });

  it('verifyKey: chave recusada vira SGDB_AUTH; serviço fora do ar vira aviso claro', async () => {
    await expect(setup(null, sgdbFetch([], { unauthorized: true })).service.verifyKey('qualquer')).rejects.toMatchObject({ code: 'SGDB_AUTH' });
    await expect(setup(null, sgdbFetch([], { outage: () => true })).service.verifyKey('chave-valida-123456')).rejects.toMatchObject({
      code: 'STORE_HTTP',
      message: expect.stringMatching(/não está respondendo/),
    });
    await expect(setup(null, sgdbFetch([])).service.verifyKey('chave-valida-123456')).resolves.toBeUndefined();
  });

  it('nunca derruba a Loja, e falta de internet não fica em cache', async () => {
    let online = false;
    const { service } = setup(null, async (url, init) => {
      if (!online) throw new TypeError('fetch failed');
      return sgdbFetch([])(url, init);
    });
    expect(await service.art({ ...PORT, art: undefined })).toEqual({ cover: null, hero: null, logo: null, icon: null, source: 'none' });
    expect(await service.art(PORT)).toMatchObject({ source: 'none' });
    online = true;
    expect(await service.art(PORT)).toMatchObject({ source: 'project' }); // voltou a internet: o logo aparece
  });
});

describe('ícone do Windows (.ico) como logo do projeto', () => {
  /** .ico com uma entrada BMP de 32 px e uma PNG de 256 px (lado 0 = 256). */
  function makeIco(png: Buffer): Buffer {
    const bmp = Buffer.alloc(40, 1);
    const header = Buffer.alloc(6);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(2, 4);
    const entries = Buffer.alloc(32);
    entries[0] = 32;
    entries.writeUInt32LE(bmp.length, 8);
    entries.writeUInt32LE(6 + 32, 12);
    entries[16] = 0;
    entries.writeUInt32LE(png.length, 24);
    entries.writeUInt32LE(6 + 32 + bmp.length, 28);
    return Buffer.concat([header, entries, bmp, png]);
  }
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);

  it('usa o PNG grande de dentro do .ico', () => {
    expect(pngFromIco(makeIco(png))?.equals(png)).toBe(true);
  });

  it('.ico só com bitmap, truncado ou outro arquivo: null', () => {
    const onlyBmp = makeIco(png).subarray(0, 6 + 32 + 40); // a entrada PNG aponta para fora do arquivo
    expect(pngFromIco(onlyBmp)).toBeNull();
    expect(pngFromIco(png)).toBeNull();
    expect(pngFromIco(Buffer.alloc(3))).toBeNull();
  });

  /** .ico com um bitmap 2x2 (BGRA, de baixo para cima) de `bpp` bits. */
  function makeBmpIco(bgraBottomUp: number[], bpp = 32): Buffer {
    const dib = Buffer.alloc(40 + 16 + 8); // cabeçalho + pixels + máscara (ignorada)
    dib.writeUInt32LE(40, 0);
    dib.writeInt32LE(2, 4);
    dib.writeInt32LE(4, 8); // altura dobrada (imagem + máscara)
    dib.writeUInt16LE(1, 12);
    dib.writeUInt16LE(bpp, 14);
    dib.set(bgraBottomUp, 40);
    const header = Buffer.alloc(6);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(1, 4);
    const entry = Buffer.alloc(16);
    entry[0] = 2;
    entry[1] = 2;
    entry.writeUInt16LE(bpp, 6);
    entry.writeUInt32LE(dib.length, 8);
    entry.writeUInt32LE(6 + 16, 12);
    return Buffer.concat([header, entry, dib]);
  }
  /** Pixels RGBA (de cima para baixo) de um PNG gerado pelo pngFromIco. */
  function rgbaOf(png: Buffer): number[] {
    expect(imageFormat(png)).toBe('png');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([2, 2]);
    const idatLength = png.readUInt32BE(33);
    expect(png.subarray(37, 41).toString('latin1')).toBe('IDAT');
    const raw = inflateSync(png.subarray(41, 41 + idatLength));
    return [...raw.subarray(1, 9), ...raw.subarray(10, 18)]; // sem o byte de filtro de cada linha
  }

  it('.ico antigo, só com bitmap de 32 bits: vira PNG (RGBA, de cima para baixo)', () => {
    // Linha de baixo: azul, verde; linha de cima: vermelho, branco meio transparente.
    const ico = makeBmpIco([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 128]);
    expect(rgbaOf(pngFromIco(ico)!)).toEqual([255, 0, 0, 255, 255, 255, 255, 128, 0, 0, 255, 255, 0, 255, 0, 255]);
  });

  it('bitmap de 32 bits com alfa todo zerado fica opaco; bitmap de paleta não serve', () => {
    const ico = makeBmpIco([255, 0, 0, 0, 0, 255, 0, 0, 0, 0, 255, 0, 9, 9, 9, 0]);
    expect(rgbaOf(pngFromIco(ico)!).filter((_, i) => i % 4 === 3)).toEqual([255, 255, 255, 255]);
    expect(pngFromIco(makeBmpIco(new Array(16).fill(1), 8))).toBeNull();
  });
});

describe('capas com link simbólico do git (libretro-thumbnails)', () => {
  const base = 'https://raw.githubusercontent.com/libretro-thumbnails/Nintendo_-_Nintendo_64/master/Named_Boxarts/';

  it('reconhece o link e aponta para a capa de verdade na mesma pasta', () => {
    expect(gitSymlinkTarget(`${base}DKR%20(Rev%201).png`, Buffer.from('Diddy Kong Racing (USA) (En,Fr).png'))).toBe(
      `${base}Diddy%20Kong%20Racing%20(USA)%20(En%2CFr).png`,
    );
    expect(gitSymlinkTarget(`${base}x.png`, Buffer.from('../../segredo.png'))).toBeNull(); // nada de sair da pasta
    expect(gitSymlinkTarget('https://cdn2.steamgriddb.com/x.png', Buffer.from('y.png'))).toBeNull();
  });

  it('segue o link uma vez e guarda a capa de verdade', async () => {
    const log: string[] = [];
    const { service } = setup(null, async (url) => {
      log.push(url);
      return url.includes('Rev%201') ? image(Buffer.from('Diddy Kong Racing (USA) (En,Fr).png'), url) : image(PNG, url);
    });
    const art = await service.art({ ...PORT, art: { boxart: `${base}Diddy%20Kong%20Racing%20(USA)%20(En%2CFr)%20(Rev%201).png` } });
    expect(art.cover).toMatch(/^rv-media:.+\.jpg$/);
    expect(log).toHaveLength(2);
  });
});

describe('mensagens claras', () => {
  it('endereço da página do arquivo no GitHub vira o endereço "Raw"', () => {
    expect(toRawGitHubUrl('https://github.com/eu/catalogo/blob/main/catalog.json')).toBe('https://raw.githubusercontent.com/eu/catalogo/main/catalog.json');
    expect(toRawGitHubUrl('https://github.com/eu/catalogo/raw/main/pasta/catalog.json')).toBe(
      'https://raw.githubusercontent.com/eu/catalogo/main/pasta/catalog.json',
    );
    expect(toRawGitHubUrl('https://raw.githubusercontent.com/eu/c/main/catalog.json')).toBe('https://raw.githubusercontent.com/eu/c/main/catalog.json');
    expect(toRawGitHubUrl('https://exemplo.com/catalog.json')).toBe('https://exemplo.com/catalog.json');
  });

  it('erro de validação de um valor só vira uma frase, sem jargão', () => {
    const single = z.string().url().refine((u) => u.startsWith('https://'), 'o catálogo precisa estar num endereço https').safeParse('http://x.com');
    expect(toIpcError(single.error)).toEqual({ code: 'VALIDATION', message: 'O catálogo precisa estar num endereço https.' });
    const many = z.object({ a: z.string(), b: z.number() }).safeParse({});
    expect(toIpcError(many.error).message).toMatch(/^Dados inválidos — a: .*; b: /);
    // Mensagens padrão do zod em português (errors.ts configura o idioma).
    expect(toIpcError(many.error).message).toMatch(/Entrada inválida/);
  });

  it('JSON que não é catálogo explica o formato esperado', () => {
    expect(() => parseCatalog([{ name: 'x' }])).toThrow(/"schemaVersion" e a lista "ports"/);
  });
});

describe('catálogo online', () => {
  const makeStore = (fetchFn: FetchFn) => {
    const cache = new ApiCache(new CacheRepository(openDatabase(':memory:')));
    return new StoreCatalogService({ cache, github: new GitHubClient(cache, () => null, async () => json([])), remoteUrl: () => null, fetchFn });
  };

  it('testRemote explica 404, página HTML e arquivo que não é catálogo', async () => {
    await expect(makeStore(async () => new Response('Not Found', { status: 404 })).testRemote('https://x/catalog.json')).rejects.toMatchObject({
      message: expect.stringMatching(/Raw/),
    });
    await expect(makeStore(async () => new Response('<!doctype html>', { status: 200 })).testRemote('https://x/catalog.json')).rejects.toMatchObject({
      message: expect.stringMatching(/não devolveu um JSON/),
    });
    await expect(makeStore(async () => json({ foo: 1 })).testRemote('https://x/catalog.json')).rejects.toMatchObject({
      message: expect.stringMatching(/não é um catálogo/),
    });
  });

  it('o catálogo exportado volta a ser lido igualzinho (ida e volta)', async () => {
    const store = makeStore(async () => json([]));
    const exported = await store.exportJson();
    const original = (await store.catalog()).ports;
    const reread = parseCatalog(JSON.parse(exported));
    expect(reread.skipped).toEqual([]);
    expect(reread.ports).toEqual(original);
    const remote = makeStore(async () => new Response(exported, { status: 200 }));
    expect(await remote.testRemote('https://raw.githubusercontent.com/eu/catalogo/main/catalog.json')).toEqual({ ports: original.length, skipped: [] });
  });
});
