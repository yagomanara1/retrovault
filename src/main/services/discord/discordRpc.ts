// Cliente mínimo do Rich Presence do Discord pelo canal local do app (IPC por named pipe no Windows).
// Protocolo público do Discord: quadros [operação int32 LE][tamanho int32 LE][JSON]. Nada sai pela internet
// daqui; se o Discord estiver fechado, a conexão só falha. Ideia trazida do Taiga Launcher (GabrielTaiga).
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import type { Duplex } from 'node:stream';

export const Op = { Handshake: 0, Frame: 1, Close: 2, Ping: 3, Pong: 4 } as const;
export type Op = (typeof Op)[keyof typeof Op];

/** Atividade "Jogando…" (campos de texto do Discord: 2 a 128 caracteres). */
export interface DiscordActivity {
  details?: string;
  state?: string;
  timestamps?: { start?: number };
  assets?: { large_image?: string; large_text?: string; small_image?: string; small_text?: string };
}

export function encodeFrame(op: Op, data: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(data), 'utf8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

/** Quadros completos do começo do buffer e o que sobrou (quadro pela metade). */
export function decodeFrames(buffer: Buffer): { frames: { op: Op; data: Record<string, unknown> }[]; rest: Buffer } {
  const frames: { op: Op; data: Record<string, unknown> }[] = [];
  let at = 0;
  while (buffer.length - at >= 8) {
    const op = buffer.readInt32LE(at) as Op;
    const len = buffer.readInt32LE(at + 4);
    if (len < 0 || len > 1024 * 1024) throw new Error('quadro do Discord inválido');
    if (buffer.length - at - 8 < len) break;
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(buffer.toString('utf8', at + 8, at + 8 + len)) as Record<string, unknown>;
    } catch {
      // quadro sem JSON: ignora
    }
    frames.push({ op, data });
    at += 8 + len;
  }
  return { frames, rest: buffer.subarray(at) };
}

/** Os canais que o Discord abre (o primeiro livre de 0 a 9). */
export const DISCORD_PIPES = Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`);

export type Connector = (pipe: string) => Duplex;

const defaultConnector: Connector = (pipe) => net.connect(pipe);
const TIMEOUT_MS = 5000;

/**
 * Uma conexão com o Discord: aperto de mão com o ID do aplicativo, depois SET_ACTIVITY. Os pedidos levam
 * um "nonce" e esperam a resposta com o mesmo nonce (erro do Discord vira exceção).
 */
export class DiscordRpc {
  private socket: Duplex | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private readonly pending = new Map<string, { resolve: () => void; reject: (err: Error) => void }>();
  private onReady: ((err?: Error) => void) | null = null;
  private closedListener: (() => void) | null = null;

  constructor(
    private readonly clientId: string,
    private readonly connector: Connector = defaultConnector,
  ) {}

  get connected(): boolean {
    return this.socket !== null;
  }

  /** Avisado quando o Discord fecha a conexão (ex.: o app do Discord foi fechado). */
  onClosed(listener: () => void): void {
    this.closedListener = listener;
  }

  /** Conecta no primeiro canal que responder. false se o Discord não estiver aberto ou recusar o ID. */
  async connect(pipes: readonly string[] = DISCORD_PIPES): Promise<boolean> {
    if (this.socket) return true;
    for (const pipe of pipes) {
      if (await this.tryPipe(pipe)) return true;
    }
    return false;
  }

  private tryPipe(pipe: string): Promise<boolean> {
    return new Promise((resolve) => {
      let socket: Duplex;
      try {
        socket = this.connector(pipe);
      } catch {
        resolve(false);
        return;
      }
      const timer = setTimeout(() => finish(new Error('o Discord não respondeu')), TIMEOUT_MS);
      const finish = (err?: Error) => {
        clearTimeout(timer);
        this.onReady = null;
        if (err) {
          socket.removeAllListeners();
          socket.on('error', () => {});
          socket.destroy();
          if (this.socket === socket) this.socket = null;
          resolve(false);
        } else resolve(true);
      };
      socket.on('error', (err: Error) => (this.onReady ? finish(err) : this.drop()));
      socket.on('close', () => (this.onReady ? finish(new Error('o Discord fechou a conexão')) : this.drop()));
      socket.on('data', (chunk: Buffer) => this.receive(socket, chunk));
      this.socket = socket;
      this.buffer = Buffer.alloc(0);
      this.onReady = finish;
      socket.write(encodeFrame(Op.Handshake, { v: 1, client_id: this.clientId }));
    });
  }

  private receive(socket: Duplex, chunk: Buffer): void {
    let decoded;
    try {
      decoded = decodeFrames(Buffer.concat([this.buffer, chunk]));
    } catch {
      this.drop();
      return;
    }
    this.buffer = decoded.rest;
    for (const { op, data } of decoded.frames) {
      if (op === Op.Ping) socket.write(encodeFrame(Op.Pong, data));
      else if (op === Op.Close) this.onReady ? this.onReady(new Error(String(data.message ?? 'recusado'))) : this.drop();
      else if (op === Op.Frame) {
        if (data.cmd === 'DISPATCH' && data.evt === 'READY') this.onReady?.();
        const waiting = typeof data.nonce === 'string' ? this.pending.get(data.nonce) : undefined;
        if (waiting) {
          this.pending.delete(data.nonce as string);
          if (data.evt === 'ERROR') waiting.reject(new Error(String((data.data as { message?: string } | undefined)?.message ?? 'erro do Discord')));
          else waiting.resolve();
        }
      }
    }
  }

  /** Define (ou, com null, limpa) a atividade do RetroVault no perfil. */
  setActivity(activity: DiscordActivity | null, pid = process.pid): Promise<void> {
    const socket = this.socket;
    if (!socket) return Promise.reject(new Error('sem conexão com o Discord'));
    const nonce = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(nonce);
        reject(new Error('o Discord não respondeu'));
      }, TIMEOUT_MS);
      this.pending.set(nonce, {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      socket.write(encodeFrame(Op.Frame, { cmd: 'SET_ACTIVITY', args: activity ? { pid, activity } : { pid }, nonce }));
    });
  }

  close(): void {
    const socket = this.socket;
    if (!socket) return;
    socket.removeAllListeners();
    socket.on('error', () => {});
    try {
      socket.write(encodeFrame(Op.Close, {}));
    } catch {
      // já fechado
    }
    socket.destroy();
    this.drop(false);
  }

  private drop(notify = true): void {
    if (!this.socket) return;
    this.socket = null;
    for (const { reject } of this.pending.values()) reject(new Error('conexão com o Discord perdida'));
    this.pending.clear();
    if (notify) this.closedListener?.();
  }
}
