import { createHash } from 'node:crypto';
import { createWriteStream, promises as fs, type WriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { AppError } from '../../errors';
import { defaultFetch, type FetchFn } from '../http';

/** Downloads dos ports só destes hosts (o GitHub redireciona os arquivos das versões para o CDN dele). */
export const GITHUB_HOSTS: ReadonlySet<string> = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
/**
 * Mods: gamebanana.com/dl/<id> redireciona para files.gamebanana.com e dali para um servidor de cache
 * numerado (filecache44.gamebanana.com…). Item começando com "." = qualquer subdomínio daquele domínio.
 */
export const GAMEBANANA_HOSTS: ReadonlySet<string> = new Set(['gamebanana.com', '.gamebanana.com']);
const PROGRESS_INTERVAL_MS = 200;
const IDLE_TIMEOUT_MS = 60_000;

export interface DownloadProgress {
  received: number;
  total: number;
}

export interface DownloadOptions {
  expectedSize: number;
  /** SHA-256 publicado pelo GitHub; sem ele a conferência é só pelo tamanho. */
  expectedSha256: string | null;
  /** MD5 publicado (o GameBanana publica MD5); conferido além do tamanho. */
  expectedMd5?: string | null;
  /** Hosts permitidos (padrão: GitHub). Vale também para o endereço final depois de redirecionar. */
  hosts?: ReadonlySet<string>;
  signal?: AbortSignal;
  onProgress?: (p: DownloadProgress) => void;
  fetchFn?: FetchFn;
}

export function isAllowedDownloadUrl(url: string, hosts: ReadonlySet<string> = GITHUB_HOSTS): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    if (hosts.has(u.hostname)) return true;
    // ".gamebanana.com" aceita "filecache44.gamebanana.com", mas não "evilgamebanana.com".
    return [...hosts].some((h) => h.startsWith('.') && u.hostname.endsWith(h));
  } catch {
    return false;
  }
}

/**
 * Baixa `url` para `dest` sem carregar o arquivo na memória, calculando o SHA-256 no caminho.
 * Grava em `dest.part` e só renomeia para `dest` se tamanho e hash baterem; em qualquer falha
 * (ou cancelamento) o `.part` é apagado.
 */
export async function downloadFile(url: string, dest: string, options: DownloadOptions): Promise<{ sha256: string }> {
  const hosts = options.hosts ?? GITHUB_HOSTS;
  if (!isAllowedDownloadUrl(url, hosts)) throw new AppError('FORBIDDEN', 'Endereço de download fora dos sites permitidos.');
  const fetchFn = options.fetchFn ?? defaultFetch;
  const part = `${dest}.part`;

  // Sem dados por 60 s = conexão travada (o tempo total pode ser longo em internet lenta).
  const idle = new AbortController();
  let idleTimer = setTimeout(() => idle.abort(), IDLE_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, idle.signal]) : idle.signal;
  let out: WriteStream | null = null;

  try {
    let response: Response;
    try {
      response = await fetchFn(url, { headers: { 'User-Agent': 'RetroVault/0.1 (+desktop launcher)' }, signal });
    } catch (err) {
      if (options.signal?.aborted) throw err;
      throw new AppError('STORE_NETWORK', 'Não foi possível baixar o arquivo. Verifique a internet e tente de novo.', { cause: err });
    }
    if (response.url && !isAllowedDownloadUrl(response.url, hosts)) throw new AppError('FORBIDDEN', 'O download foi redirecionado para fora dos sites permitidos.');
    if (!response.ok || !response.body) throw new AppError('STORE_HTTP', `O download respondeu com erro ${response.status}.`);

    const hash = createHash('sha256');
    const md5 = options.expectedMd5 ? createHash('md5') : null;
    let received = 0;
    let lastReport = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, callback) {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => idle.abort(), IDLE_TIMEOUT_MS);
        received += chunk.length;
        if (received > options.expectedSize) {
          callback(new AppError('VALIDATION', 'O arquivo baixado é maior do que o publicado; o download foi interrompido.'));
          return;
        }
        hash.update(chunk);
        md5?.update(chunk);
        const now = Date.now();
        if (now - lastReport >= PROGRESS_INTERVAL_MS) {
          lastReport = now;
          options.onProgress?.({ received, total: options.expectedSize });
        }
        callback(null, chunk);
      },
    });

    try {
      out = createWriteStream(part);
      await pipeline(Readable.fromWeb(response.body as WebReadableStream<Uint8Array>), meter, out, { signal });
    } catch (err) {
      if (err instanceof AppError || options.signal?.aborted) throw err;
      throw new AppError('STORE_NETWORK', 'O download foi interrompido. Tente de novo.', { cause: err });
    }
    options.onProgress?.({ received, total: options.expectedSize });

    if (received !== options.expectedSize) {
      throw new AppError('VALIDATION', 'O download veio incompleto. Tente de novo.');
    }
    const sha256 = hash.digest('hex');
    if (options.expectedSha256 && sha256 !== options.expectedSha256.toLowerCase()) {
      throw new AppError('VALIDATION', 'O arquivo baixado não confere com o publicado pelo projeto (SHA-256 diferente) e foi descartado.');
    }
    if (md5 && options.expectedMd5 && md5.digest('hex') !== options.expectedMd5.toLowerCase()) {
      throw new AppError('VALIDATION', 'O arquivo baixado não confere com o publicado (MD5 diferente) e foi descartado.');
    }
    await fs.rename(part, dest);
    return { sha256 };
  } catch (err) {
    // O arquivo abre de forma assíncrona: cancelado antes de abrir, ele seria criado (vazio) depois do
    // rm. Espera fechar e só então apaga.
    const stream = out;
    if (stream && !stream.closed) await new Promise<void>((resolve) => stream.once('close', () => resolve()));
    await fs.rm(part, { force: true }).catch(() => undefined);
    throw err;
  } finally {
    clearTimeout(idleTimer);
  }
}
