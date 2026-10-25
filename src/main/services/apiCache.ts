import type { CacheRepository } from '../db/repositories/cacheRepository';

interface Entry {
  value: unknown;
  expiresAt: number;
}

const MEMORY_LIMIT = 300;

/**
 * Cache de duas camadas para respostas da API:
 *  L1 → memória (LRU simples, acesso O(1))
 *  L2 → SQLite (sobrevive a reinícios, usado para stale-if-error offline)
 * Também deduplica requisições simultâneas para a mesma chave.
 */
export class ApiCache {
  private readonly memory = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(private readonly repo: CacheRepository) {}

  async getOrFetch<T>(
    key: string,
    ttlMs: number,
    fetcher: () => Promise<T>,
    options: { force?: boolean } = {},
  ): Promise<T> {
    if (!options.force) {
      const hit = this.read<T>(key);
      if (hit && hit.expiresAt > Date.now()) return hit.value;
    }

    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;

    const request = (async () => {
      try {
        const value = await fetcher();
        this.write(key, value, ttlMs);
        return value;
      } catch (err) {
        // stale-if-error: melhor mostrar dados antigos do que uma tela de erro.
        const stale = this.read<T>(key);
        if (stale) {
          console.warn(`[cache] usando valor expirado para "${key}"`, err);
          return stale.value;
        }
        throw err;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, request);
    return request;
  }

  /** Último valor guardado, mesmo expirado (ex.: para revalidar com ETag em vez de baixar de novo). */
  peek<T>(key: string): T | null {
    return this.read<T>(key)?.value ?? null;
  }

  /** Guarda um valor direto (ex.: a última versão de cada port já avisada ao usuário). */
  set(key: string, value: unknown, ttlMs: number): void {
    this.write(key, value, ttlMs);
  }

  invalidate(prefix: string): void {
    for (const key of this.memory.keys()) {
      if (key.startsWith(prefix)) this.memory.delete(key);
    }
    this.repo.deletePrefix(prefix);
  }

  purgeExpired(graceMs = 7 * 24 * 60 * 60 * 1000): void {
    this.repo.purgeExpired(graceMs);
  }

  private read<T>(key: string): { value: T; expiresAt: number } | null {
    const mem = this.memory.get(key);
    if (mem) {
      // Reinsere para manter ordem LRU.
      this.memory.delete(key);
      this.memory.set(key, mem);
      return mem as { value: T; expiresAt: number };
    }
    const row = this.repo.get(key);
    if (!row) return null;
    try {
      const entry = { value: JSON.parse(row.value) as T, expiresAt: row.expires_at };
      this.remember(key, entry);
      return entry;
    } catch {
      return null;
    }
  }

  private write(key: string, value: unknown, ttlMs: number): void {
    const entry = { value, expiresAt: Date.now() + ttlMs };
    this.remember(key, entry);
    this.repo.set(key, JSON.stringify(value), entry.expiresAt);
  }

  private remember(key: string, entry: Entry): void {
    this.memory.delete(key);
    this.memory.set(key, entry);
    if (this.memory.size > MEMORY_LIMIT) {
      const oldest = this.memory.keys().next().value;
      if (oldest !== undefined) this.memory.delete(oldest);
    }
  }
}
