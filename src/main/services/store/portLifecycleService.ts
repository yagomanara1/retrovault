import type { PortArt, StorePort } from '@shared/store';

/** Por quanto tempo lembrar que a versão nova de um port já foi avisada (uma notificação por versão). */
const NOTIFIED_TTL_MS = 365 * 24 * 60 * 60_000;

export interface PortLifecycleDeps {
  /** Instalações registradas (qual jogo é de qual port). */
  installs: { gameFor(portId: string): number | null; list(): { portId: string }[] };
  catalog: { port(portId: string): Promise<StorePort> };
  art: { art(port: StorePort): Promise<PortArt> };
  games: { applyArtworkIfMissing(id: number, art: { cover?: string | null; background?: string | null }): unknown };
  categories: { assignPortGame(gameId: number, original: StorePort['original']): boolean };
  roms: { reapply(portId: string): Promise<boolean> };
  /** Versões novas dos ports instalados (o InstallService, criado depois deste serviço). */
  updates(): Promise<Record<string, { tag: string }>>;
  /** Onde fica lembrado o que já foi avisado (cache com validade). */
  notified: { peek<T>(key: string): T | null; set(key: string, value: unknown, ttlMs: number): void };
  notifyPortUpdates(): boolean;
  onGameChanged(gameId: number): void;
  onUpdatesChanged(count: number): void;
  notify(title: string, body: string): void;
}

/** O que acontece com o jogo de um port depois de instalado, e a verificação de fundo das atualizações. */
export class PortLifecycleService {
  constructor(private readonly deps: PortLifecycleDeps) {}

  /** Port instalado: a ROM volta para o lugar, o jogo ganha a arte da Loja e a categoria do console. */
  async afterInstall(portId: string): Promise<void> {
    await this.deps.roms.reapply(portId);
    await this.applyArt(portId);
    await this.categorize(portId);
  }

  /** Capa e fundo da Loja para o jogo do port (só onde ele ainda não tem arte). */
  async applyArt(portId: string): Promise<void> {
    const gameId = this.deps.installs.gameFor(portId);
    if (!gameId) return;
    try {
      const art = await this.deps.art.art(await this.deps.catalog.port(portId));
      if (this.deps.games.applyArtworkIfMissing(gameId, { cover: art.cover, background: art.hero })) this.deps.onGameChanged(gameId);
    } catch (err) {
      console.warn('[store] arte do jogo instalado falhou', portId, err);
    }
  }

  /** Jogo do port na categoria do console original (só se ele ainda não tiver categoria). */
  async categorize(portId: string): Promise<void> {
    const gameId = this.deps.installs.gameFor(portId);
    if (!gameId) return;
    try {
      if (this.deps.categories.assignPortGame(gameId, (await this.deps.catalog.port(portId)).original)) this.deps.onGameChanged(gameId);
    } catch (err) {
      console.warn('[categories] categoria do port falhou', portId, err);
    }
  }

  /** Chave do SteamGridDB recém-conectada: dá capa aos ports que já estavam instalados. */
  async applyArtToLibrary(): Promise<void> {
    for (const install of this.deps.installs.list()) await this.applyArt(install.portId);
  }

  /** Na inicialização: ports já instalados entram na categoria do seu console (os que ainda não têm). */
  async categorizeLibrary(): Promise<void> {
    for (const install of this.deps.installs.list()) await this.categorize(install.portId);
  }

  /**
   * Verificação de fundo das atualizações dos ports instalados (as versões ficam 1 h em cache, com ETag).
   * Avisa a tela sempre; o Windows só uma vez por versão nova de cada port.
   */
  async checkUpdates(): Promise<void> {
    if (this.deps.installs.list().length === 0) return;
    const found = await this.deps.updates();
    this.deps.onUpdatesChanged(Object.keys(found).length);
    if (!this.deps.notifyPortUpdates()) return;
    const fresh: string[] = [];
    for (const [portId, update] of Object.entries(found)) {
      const key = `notified-update:${portId}`;
      if (this.deps.notified.peek<string>(key) === update.tag) continue;
      this.deps.notified.set(key, update.tag, NOTIFIED_TTL_MS);
      fresh.push((await this.deps.catalog.port(portId).catch(() => null))?.name ?? portId);
    }
    if (fresh.length === 1) this.deps.notify(`Atualização disponível: ${fresh[0]}`, 'Uma versão nova está na Loja de ports.');
    else if (fresh.length > 1) {
      this.deps.notify(`${fresh.length} ports com atualização`, `${fresh.slice(0, 3).join(', ')}${fresh.length > 3 ? '…' : ''}. Abra a Loja para atualizar.`);
    }
  }
}
