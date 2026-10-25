import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { Game } from '@shared/types';
import { isDiscordImage } from './discordConfig';
import { DiscordPresenceService } from './discordPresence';
import { decodeFrames, DiscordRpc, encodeFrame, Op } from './discordRpc';

/**
 * Discord falso no mesmo protocolo, num canal de teste (nunca o do Discord de verdade). Recusa o ID "recusado",
 * responde SET_ACTIVITY com o mesmo nonce e guarda o que recebeu.
 */
async function fakeDiscord() {
  const pipe = `\\\\?\\pipe\\rv-test-discord-${randomUUID()}`;
  const received: Record<string, unknown>[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    let buffer: Buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      const { frames, rest } = decodeFrames(Buffer.concat([buffer, chunk]));
      buffer = rest;
      for (const { op, data } of frames) {
        received.push({ op, ...data });
        if (op === Op.Handshake) {
          if (data.client_id === 'recusado') socket.end(encodeFrame(Op.Close, { code: 4000, message: 'Invalid Client ID' }));
          else socket.write(encodeFrame(Op.Frame, { cmd: 'DISPATCH', evt: 'READY', data: { v: 1 } }));
        } else if (op === Op.Frame && data.cmd === 'SET_ACTIVITY') {
          socket.write(encodeFrame(Op.Frame, { cmd: 'SET_ACTIVITY', evt: null, nonce: data.nonce, data: (data.args as { activity?: unknown }).activity ?? null }));
        } else if (op === Op.Pong) {
          received.push({ pong: true });
        }
      }
    });
    socket.on('error', () => {});
  });
  await new Promise<void>((resolve) => server.listen(pipe, resolve));
  return {
    pipe,
    received,
    activities: () => received.filter((r) => r.cmd === 'SET_ACTIVITY').map((r) => (r.args as { activity?: Record<string, unknown> }).activity ?? null),
    ping: () => {
      for (const s of sockets) s.write(encodeFrame(Op.Ping, { n: 1 }));
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

const missingPipe = () => `\\\\?\\pipe\\rv-test-nada-${randomUUID()}`;
const game = (over: Partial<Game> = {}) => ({ id: 7, title: 'God of War III', kind: 'executable', raGameId: null, ...over }) as Game;
const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
};

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

describe('quadros do protocolo', () => {
  it('codifica e decodifica, guardando o quadro pela metade para depois', () => {
    const a = encodeFrame(Op.Frame, { cmd: 'X', n: 1 });
    const b = encodeFrame(Op.Ping, { y: 'ç' });
    const both = Buffer.concat([a, b]);
    const partial = decodeFrames(both.subarray(0, a.length + 5));
    expect(partial.frames).toEqual([{ op: Op.Frame, data: { cmd: 'X', n: 1 } }]);
    const restDecoded = decodeFrames(Buffer.concat([partial.rest, both.subarray(a.length + 5)]));
    expect(restDecoded.frames).toEqual([{ op: Op.Ping, data: { y: 'ç' } }]);
    expect(restDecoded.rest.length).toBe(0);
  });
});

describe('DiscordRpc', () => {
  it('pula o canal que não existe, faz o aperto de mão e define e limpa a atividade', async () => {
    const discord = await fakeDiscord();
    cleanups.push(discord.close);
    const rpc = new DiscordRpc('123');
    cleanups.push(() => rpc.close());
    expect(await rpc.connect([missingPipe(), discord.pipe])).toBe(true);
    expect(discord.received[0]).toMatchObject({ op: Op.Handshake, v: 1, client_id: '123' });
    await rpc.setActivity({ details: 'Jogo' }, 42);
    await rpc.setActivity(null, 42);
    expect(discord.received.filter((r) => r.cmd === 'SET_ACTIVITY').map((r) => r.args)).toEqual([{ pid: 42, activity: { details: 'Jogo' } }, { pid: 42 }]);
    discord.ping();
    await until(() => discord.received.some((r) => r.pong));
    expect(discord.received.some((r) => r.pong)).toBe(true); // respondeu o ping
  });

  it('Discord fechado ou ID recusado: connect devolve false, sem exceção', async () => {
    expect(await new DiscordRpc('123').connect([missingPipe()])).toBe(false);
    const discord = await fakeDiscord();
    cleanups.push(discord.close);
    expect(await new DiscordRpc('recusado').connect([discord.pipe])).toBe(false);
  });
});

describe('DiscordPresenceService', () => {
  async function setup(opts: { enabled?: boolean; clientId?: string | null; pipes?: string[]; image?: string | null } = {}) {
    const discord = await fakeDiscord();
    cleanups.push(discord.close);
    let enabled = opts.enabled ?? true;
    const service = new DiscordPresenceService({
      clientId: opts.clientId === undefined ? '123' : opts.clientId,
      enabled: () => enabled,
      describe: async () => ({ platform: 'PlayStation 4', imageUrl: opts.image === undefined ? null : opts.image }),
      fallbackImageUrl: 'https://exemplo/icone.png',
      pipes: opts.pipes ?? [discord.pipe],
      now: () => 1_700_000_000_123,
      retryMs: 30,
    });
    cleanups.push(() => service.stop());
    return { discord, service, setEnabled: (v: boolean) => (enabled = v) };
  }

  it('jogo aberto: nome, plataforma, hora de início e o ícone do RetroVault; jogo fechado: limpa', async () => {
    const { discord, service } = await setup();
    service.gameStarted(game());
    await service.flush();
    expect(discord.activities()).toEqual([
      {
        details: 'God of War III',
        state: 'PlayStation 4',
        timestamps: { start: 1_700_000_000_000 },
        assets: { large_image: 'https://exemplo/icone.png', large_text: 'God of War III' },
      },
    ]);
    service.gameEnded(game());
    await service.flush();
    expect(discord.activities()).toHaveLength(2);
    expect(discord.activities()[1]).toBeNull();
  });

  it('com capa pública, ela é a imagem grande e o ícone do RetroVault fica pequeno', async () => {
    const { discord, service } = await setup({ image: 'https://media.retroachievements.org/Images/1.png' });
    service.gameStarted(game({ title: 'X' })); // 1 caractere: o Discord exige 2
    await service.flush();
    expect(discord.activities()[0]).toMatchObject({
      details: 'X ',
      assets: { large_image: 'https://media.retroachievements.org/Images/1.png', small_image: 'https://exemplo/icone.png', small_text: 'RetroVault' },
    });
  });

  it('desligado nas Configurações ou sem ID do aplicativo: nem conecta', async () => {
    for (const opts of [{ enabled: false }, { clientId: null }]) {
      const { discord, service } = await setup(opts);
      service.gameStarted(game());
      await service.flush();
      expect(discord.received).toEqual([]);
    }
  });

  it('desligar no meio do jogo limpa o perfil; religar mostra de novo', async () => {
    const { discord, service, setEnabled } = await setup();
    service.gameStarted(game());
    await service.flush();
    setEnabled(false);
    service.settingsChanged();
    await service.flush();
    setEnabled(true);
    service.settingsChanged();
    await service.flush();
    expect(discord.activities().map((a) => (a ? a.details : null))).toEqual(['God of War III', null, 'God of War III']);
  });

  it('Discord aberto depois do jogo: tenta de novo e mostra', async () => {
    const pipe = missingPipe();
    const { service } = await setup({ pipes: [pipe] });
    service.gameStarted(game());
    await service.flush(); // sem Discord: nada quebra
    const lateSockets = new Set<net.Socket>();
    const late = net.createServer((socket) => {
      lateSockets.add(socket);
      socket.on('data', (chunk) => {
        for (const { op, data } of decodeFrames(chunk).frames) {
          if (op === Op.Handshake) socket.write(encodeFrame(Op.Frame, { cmd: 'DISPATCH', evt: 'READY' }));
          else if (data.cmd === 'SET_ACTIVITY') {
            shown.push((data.args as { activity: { details: string } }).activity.details);
            socket.write(encodeFrame(Op.Frame, { cmd: 'SET_ACTIVITY', nonce: data.nonce }));
          }
        }
      });
      socket.on('error', () => {});
    });
    const shown: string[] = [];
    await new Promise<void>((resolve) => late.listen(pipe, resolve));
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          for (const s of lateSockets) s.destroy();
          late.close(() => resolve());
        }),
    );
    await until(() => shown.length > 0);
    expect(shown).toEqual(['God of War III']);
  });
});

describe('imagens que o Discord mostra', () => {
  it('só https de imagem comum', () => {
    expect(isDiscordImage('https://media.retroachievements.org/Images/012345.png')).toBe(true);
    expect(isDiscordImage('https://raw.githubusercontent.com/a/b/HEAD/logo.jpg?x=1')).toBe(true);
    expect(isDiscordImage('https://raw.githubusercontent.com/a/b/HEAD/icon.ico')).toBe(false);
    expect(isDiscordImage('rv-media://artwork/abc.png')).toBe(false);
    expect(isDiscordImage(null)).toBe(false);
  });
});
