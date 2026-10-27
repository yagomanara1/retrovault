import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../../db/database';
import { CacheRepository } from '../../db/repositories/cacheRepository';
import { ApiCache } from '../apiCache';
import type { FetchFn } from '../http';
import { RetroAchievementsClient } from './client';

const CREDS = { username: 'Jogador', apiKey: 'chave-secreta' };
const CONSOLES = [{ ID: 2, Name: 'Nintendo 64', IconURL: '', Active: true, IsGameSystem: true }];

type Reply = Response | Error;

/** Cliente com fetch e espera de mentira: responde na ordem dada e anota cada espera. */
function setup(replies: Reply[], creds: typeof CREDS | null = CREDS) {
  const urls: string[] = [];
  const waits: number[] = [];
  const fetchFn = (async (url: string) => {
    urls.push(url);
    const next = replies.shift();
    if (!next) throw new Error('requisição a mais');
    if (next instanceof Error) throw next;
    return next;
  }) as FetchFn;
  const client = new RetroAchievementsClient(() => creds, new ApiCache(new CacheRepository(openDatabase(':memory:'))), {
    fetchFn,
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  return { client, urls, waits };
}

const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, ...init });

describe('RetroAchievementsClient: HTTP', () => {
  // O cliente só pode usar o fetch injetado: o global falha para nenhum teste ir à internet.
  beforeEach(() => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('fetch global chamado')));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('manda a Web API Key na consulta e devolve os dados mapeados', async () => {
    const { client, urls } = setup([json(CONSOLES)]);
    const consoles = await client.getConsoles();
    expect(consoles.map((c) => c.name)).toEqual(['Nintendo 64']);
    expect(urls).toHaveLength(1);
    expect(new URL(urls[0]!).searchParams.get('y')).toBe('chave-secreta');
  });

  it('429 espera o Retry-After e tenta de novo', async () => {
    const { client, urls, waits } = setup([new Response('', { status: 429, headers: { 'retry-after': '2' } }), json(CONSOLES)]);
    await client.getConsoles();
    expect(urls).toHaveLength(2);
    expect(waits).toContain(2000);
  });

  it('5xx tenta no máximo 3 vezes a mais e então vira RA_HTTP', async () => {
    const { client, urls } = setup(Array.from({ length: 4 }, () => new Response('', { status: 503 })));
    await expect(client.getConsoles()).rejects.toMatchObject({ code: 'RA_HTTP' });
    expect(urls).toHaveLength(4);
  });

  it('sem internet tenta de novo e, persistindo, vira RA_NETWORK', async () => {
    const { client, urls } = setup(Array.from({ length: 4 }, () => new TypeError('fetch failed')));
    await expect(client.getConsoles()).rejects.toMatchObject({ code: 'RA_NETWORK' });
    expect(urls).toHaveLength(4);
  });

  it('401 vira RA_AUTH na hora, sem tentar de novo', async () => {
    const { client, urls } = setup([new Response('', { status: 401 })]);
    await expect(client.getConsoles()).rejects.toMatchObject({ code: 'RA_AUTH' });
    expect(urls).toHaveLength(1);
  });

  it('404 vira NOT_FOUND', async () => {
    const { client } = setup([new Response('', { status: 404 })]);
    await expect(client.getConsoles()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('resposta que não é JSON vira RA_HTTP', async () => {
    const { client } = setup([new Response('<html>manutenção</html>', { status: 200 })]);
    await expect(client.getConsoles()).rejects.toMatchObject({ code: 'RA_HTTP' });
  });

  it('sem conta configurada nem chega a consultar', async () => {
    const { client, urls } = setup([], null);
    await expect((async () => client.getProfile())()).rejects.toMatchObject({ code: 'RA_NOT_CONFIGURED' });
    expect(urls).toHaveLength(0);
  });
});
