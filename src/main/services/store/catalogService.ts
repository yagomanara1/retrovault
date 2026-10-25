import type { StoreCatalog, StorePort, StoreRelease } from '@shared/store';
import { AppError } from '../../errors';
import type { ApiCache } from '../apiCache';
import { CATALOG_SCHEMA_VERSION, parseCatalog } from './catalogSchema';
import type { FetchFn, GitHubClient } from './githubClient';
import { SEED_CATALOG } from './seedCatalog';

const CATALOG_TTL_MS = 6 * 60 * 60_000;
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;

interface StoreCatalogDeps {
  cache: ApiCache;
  github: GitHubClient;
  /** URL https de um catalog.json (ex.: raw.githubusercontent.com de um repositório próprio); null = só o embutido. */
  remoteUrl: () => string | null;
  /** Ports adicionados pelo usuário (entram depois dos do catálogo). */
  customPorts?: () => StorePort[];
  fetchFn?: FetchFn;
}

/**
 * Catálogo da Loja. Ordem de preferência: remoto (cache de 6 h, stale-if-error) → embutido no app.
 * O renderer nunca informa repositórios ou URLs: pede pelo id do port e o main resolve aqui.
 */
export class StoreCatalogService {
  private embedded: StorePort[] | null = null;
  private readonly fetchFn: FetchFn;

  constructor(private readonly deps: StoreCatalogDeps) {
    this.fetchFn = deps.fetchFn ?? ((url, init) => fetch(url, init));
  }

  /** Catálogo (remoto ou embutido) + os ports adicionados pelo usuário. */
  async catalog(force = false): Promise<StoreCatalog> {
    const base = await this.baseCatalog(force);
    const custom = this.deps.customPorts?.() ?? [];
    if (custom.length === 0) return base;
    // Se o catálogo passar a trazer o mesmo projeto (ou o mesmo id), vale o do catálogo.
    const ids = new Set(base.ports.map((p) => p.id));
    const repos = new Set(base.ports.map((p) => p.source.repo.toLowerCase()));
    const extra = custom.filter((p) => !ids.has(p.id) && !repos.has(p.source.repo.toLowerCase()));
    return { ...base, ports: [...base.ports, ...extra] };
  }

  /** Só o catálogo (remoto ou embutido), sem os ports adicionados pelo usuário. */
  async baseCatalog(force = false): Promise<StoreCatalog> {
    const url = this.deps.remoteUrl();
    if (url) {
      try {
        const ports = await this.deps.cache.getOrFetch(`store:catalog:${url}`, CATALOG_TTL_MS, async () => (await this.fetchRemote(url)).ports, { force });
        return { ports, source: 'remote' };
      } catch (err) {
        console.warn('[store] catálogo remoto indisponível; usando o embutido', err);
      }
    }
    return { ports: this.embeddedPorts(), source: 'embedded' };
  }

  /**
   * Testa uma URL de catálogo antes de salvar: baixa, valida e diz quantos ports vieram (e quantos
   * foram ignorados). Não usa cache, para o resultado refletir o arquivo de agora.
   */
  async testRemote(url: string): Promise<{ ports: number; skipped: string[] }> {
    const { ports, skipped } = await this.fetchRemote(url);
    return { ports: ports.length, skipped };
  }

  /** URL trocada: o catálogo é buscado de novo. */
  invalidate(): void {
    this.deps.cache.invalidate('store:catalog:');
  }

  /**
   * O catálogo atual no formato do catalog.json, pronto para subir num repositório (o mesmo que o
   * `npm run catalog:repo` gera; o $schema liga as sugestões do editor ao catalog.schema.json ao lado).
   */
  async exportJson(): Promise<string> {
    // Os adicionados pelo usuário também vão (é assim que se leva um deles para o repositório do catálogo),
    // sem a marca "custom", que não faz parte do formato.
    const ports = (await this.catalog()).ports.map(({ custom: _custom, ...port }) => port);
    return `${JSON.stringify({ $schema: './catalog.schema.json', schemaVersion: CATALOG_SCHEMA_VERSION, ports }, null, 2)}\n`;
  }

  async port(portId: string): Promise<StorePort> {
    const port = (await this.catalog()).ports.find((p) => p.id === portId);
    if (!port) throw new AppError('NOT_FOUND', 'Port não encontrado no catálogo.');
    return port;
  }

  async releases(portId: string, force = false): Promise<StoreRelease[]> {
    const port = await this.port(portId);
    return this.deps.github.listReleases(port.source.repo, port.assets.windows, force);
  }

  private embeddedPorts(): StorePort[] {
    if (!this.embedded) {
      const { ports, skipped } = parseCatalog(SEED_CATALOG);
      if (skipped.length) console.warn('[store] itens inválidos no catálogo embutido', skipped);
      this.embedded = ports;
    }
    return this.embedded;
  }

  private async fetchRemote(url: string): Promise<{ ports: StorePort[]; skipped: string[] }> {
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'RetroVault/0.1 (+desktop launcher)' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new AppError('STORE_NETWORK', 'Não foi possível acessar o endereço do catálogo.', { cause: err });
    }
    if (response.status === 404) throw new AppError('NOT_FOUND', 'Nenhum catálogo neste endereço (404). Confira o link "Raw" do arquivo.');
    if (!response.ok) throw new AppError('STORE_HTTP', `O catálogo respondeu com erro ${response.status}.`);
    const text = await response.text();
    if (text.length > MAX_CATALOG_BYTES) throw new AppError('VALIDATION', 'Catálogo grande demais.');
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new AppError('VALIDATION', 'O endereço não devolveu um JSON (use o link "Raw" do catalog.json, não a página do GitHub).');
    }
    let parsed: { ports: StorePort[]; skipped: string[] };
    try {
      parsed = parseCatalog(raw);
    } catch (err) {
      throw new AppError('VALIDATION', `O arquivo não é um catálogo da Loja: ${err instanceof Error ? err.message : 'formato inválido'}.`);
    }
    if (parsed.skipped.length) console.warn('[store] itens ignorados no catálogo remoto', parsed.skipped);
    if (parsed.ports.length === 0) throw new AppError('VALIDATION', 'Catálogo remoto sem nenhum port válido.');
    return parsed;
  }
}
