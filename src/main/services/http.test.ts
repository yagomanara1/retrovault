import { describe, expect, it } from 'vitest';
import { AppError } from '../errors';
import { type FetchFn, httpGet, USER_AGENT } from './http';

describe('httpGet', () => {
  it('manda o User-Agent do app, os cabeçalhos pedidos e um prazo', async () => {
    let seen: Parameters<FetchFn>[1] | undefined;
    const fetchFn: FetchFn = async (_url, init) => {
      seen = init;
      return new Response('ok');
    };
    const response = await httpGet(fetchFn, 'https://exemplo.test/x', {
      headers: { Accept: 'application/json' },
      offline: { code: 'STORE_NETWORK', message: 'Sem conexão.' },
    });
    expect(await response.text()).toBe('ok');
    expect(seen?.headers).toEqual({ 'User-Agent': USER_AGENT, Accept: 'application/json' });
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
  });

  it('falha de rede vira o AppError do serviço, guardando a causa', async () => {
    const cause = new TypeError('fetch failed');
    const fetchFn: FetchFn = async () => {
      throw cause;
    };
    const error = await httpGet(fetchFn, 'https://exemplo.test/x', { offline: { code: 'RA_NETWORK', message: 'Sem RA.' } }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'RA_NETWORK', message: 'Sem RA.', cause });
  });

  it('resposta de erro HTTP não é exceção: cada serviço decide o que ela significa', async () => {
    const fetchFn: FetchFn = async () => new Response('', { status: 500 });
    const response = await httpGet(fetchFn, 'https://exemplo.test/x', { offline: { code: 'STORE_NETWORK', message: 'x' } });
    expect(response.status).toBe(500);
  });
});
