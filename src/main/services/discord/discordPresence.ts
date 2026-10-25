import type { Game } from '@shared/types';
import { DiscordRpc, type Connector, type DiscordActivity } from './discordRpc';

/** O que o Discord mostra sobre o jogo: plataforma e uma imagem pública (https), se houver. */
export interface GameDescription {
  platform: string | null;
  imageUrl: string | null;
}

interface PresenceDeps {
  /** ID público do aplicativo "RetroVault" no portal de desenvolvedores do Discord; null desliga tudo. */
  clientId: string | null;
  enabled: () => boolean;
  describe: (game: Game) => Promise<GameDescription>;
  /** Imagem quando o jogo não tem uma pública (o ícone do RetroVault). */
  fallbackImageUrl: string;
  connector?: Connector;
  pipes?: readonly string[];
  now?: () => number;
  /** Nova tentativa enquanto um jogo está aberto e o Discord não (ex.: abriu o Discord depois do jogo). */
  retryMs?: number;
}

/** Texto aceito pelo Discord: de 2 a 128 caracteres. */
function discordText(text: string | null | undefined): string | undefined {
  const t = (text ?? '').trim();
  if (!t) return undefined;
  return (t.length < 2 ? `${t} ` : t).slice(0, 128);
}

/**
 * "Jogando RetroVault — <jogo>" no perfil do Discord enquanto um jogo aberto pelo RetroVault roda.
 * Sem Discord aberto, desligado nas Configurações ou sem ID do aplicativo: não faz nada (e nunca atrapalha
 * o jogo: toda falha é engolida).
 */
export class DiscordPresenceService {
  private rpc: DiscordRpc | null = null;
  private current: { game: Game; startedAt: number } | null = null;
  private retry: NodeJS.Timeout | null = null;
  /** Fila: um envio por vez, na ordem (abrir e fechar rápido não pode inverter). */
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly deps: PresenceDeps) {}

  gameStarted(game: Game): void {
    this.current = { game, startedAt: (this.deps.now ?? Date.now)() };
    this.schedule();
  }

  gameEnded(game: Game): void {
    if (this.current?.game.id !== game.id) return;
    this.current = null;
    this.schedule();
  }

  /** Configuração mudou: liga mostrando o jogo atual, ou desliga limpando o perfil. */
  settingsChanged(): void {
    this.schedule();
  }

  /** Fecha a conexão (ao sair do app); o Discord limpa a atividade sozinho. */
  stop(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.rpc?.close();
    this.rpc = null;
  }

  /** Para os testes: espera os envios pendentes. */
  flush(): Promise<void> {
    return this.queue;
  }

  private schedule(): void {
    this.queue = this.queue.then(() => this.sync()).catch((err) => console.warn('[discord]', err instanceof Error ? err.message : err));
  }

  private async sync(): Promise<void> {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    const want = this.deps.clientId && this.deps.enabled() ? this.current : null;
    if (!want) {
      // Nada para mostrar: limpa e solta o Discord.
      if (this.rpc?.connected) {
        await this.rpc.setActivity(null).catch(() => {});
        console.info('[discord] atividade limpa');
      }
      this.stop();
      return;
    }
    if (!this.rpc) {
      this.rpc = new DiscordRpc(this.deps.clientId!, this.deps.connector);
      this.rpc.onClosed(() => {
        // Discord fechado no meio do jogo: tenta de novo mais tarde.
        this.rpc = null;
        if (this.current) this.retryLater();
      });
    }
    if (!(await this.rpc.connect(this.deps.pipes))) {
      this.rpc = null;
      this.retryLater();
      return;
    }
    const activity = await this.activity(want.game, want.startedAt);
    await this.rpc.setActivity(activity);
    console.info(`[discord] mostrando "${activity.details}" (${activity.state ?? 'sem plataforma'})`);
  }

  private retryLater(): void {
    if (this.retry || !this.current) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      this.schedule();
    }, this.deps.retryMs ?? 60_000);
    this.retry.unref?.();
  }

  private async activity(game: Game, startedAt: number): Promise<DiscordActivity> {
    const { platform, imageUrl } = await this.deps.describe(game).catch(() => ({ platform: null, imageUrl: null }));
    const title = discordText(game.title);
    return {
      details: title,
      state: discordText(platform),
      timestamps: { start: Math.floor(startedAt / 1000) * 1000 },
      assets: {
        large_image: imageUrl ?? this.deps.fallbackImageUrl,
        large_text: title,
        ...(imageUrl ? { small_image: this.deps.fallbackImageUrl, small_text: 'RetroVault' } : {}),
      },
    };
  }
}
