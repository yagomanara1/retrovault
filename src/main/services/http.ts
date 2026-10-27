// Acesso HTTP comum aos clientes de APIs externas (GitHub, GameBanana, SteamGridDB, RetroAchievements…):
// mesmo User-Agent, mesmo prazo e falha de rede virando o erro amigável de cada serviço. O que cada
// status significa (404, 401, limite de consultas) continua com o cliente, porque muda de API para API.
import type { ErrorCode } from '@shared/ipc';
import { AppError } from '../errors';

export const USER_AGENT = 'RetroVault/0.1 (+desktop launcher)';
export const REQUEST_TIMEOUT_MS = 20_000;

export type FetchFn = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;

/** O fetch de verdade, resolvido na hora da chamada (os testes podem trocar o global). */
export const defaultFetch: FetchFn = (url, init) => fetch(url, init);

export interface HttpGetOptions {
  headers?: Record<string, string>;
  /** Erro para quando não há resposta nenhuma (sem internet, DNS, prazo esgotado). */
  offline: { code: ErrorCode; message: string };
}

/** GET com o User-Agent do app e prazo de 20 s. Resposta de erro HTTP volta normalmente; só falha de rede lança. */
export async function httpGet(fetchFn: FetchFn, url: string, options: HttpGetOptions): Promise<Response> {
  try {
    return await fetchFn(url, {
      headers: { 'User-Agent': USER_AGENT, ...options.headers },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new AppError(options.offline.code, options.offline.message, { cause: err });
  }
}
