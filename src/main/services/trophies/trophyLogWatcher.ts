import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { WatchedSet } from '../../db/repositories/trophyRepository';
import { DEFAULT_LOG_PATTERN, type TrophyService } from './trophyService';

const POLL_INTERVAL_MS = 2000;
/** A cada 15 leituras (~30 s) procura logs que surgiram depois da importação. */
const ATTACH_EVERY_TICKS = 15;
const TAIL_BYTES = 1024;
const MAX_CHUNK_BYTES = 16 * 1024 * 1024;

const md5 = (data: Buffer) => createHash('md5').update(data).digest('hex');

async function readRange(file: string, start: number, end: number): Promise<Buffer> {
  const length = Math.max(0, end - start);
  if (length === 0) return Buffer.alloc(0);
  const fh = await fs.open(file, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/**
 * Vigia em segundo plano os logs configurados e desbloqueia troféus ao ver
 * linhas como `Runtime: trophy 12 unlocked`. Independe do processo do jogo:
 * funciona mesmo se o jogo for aberto fora do RetroVault (launcher do port, Steam…).
 *
 * O port trunca e reescreve o mesmo arquivo a cada partida (mesma data de criação e
 * mesmo cabeçalho), então detectamos "arquivo novo" por: tamanho menor que o cursor
 * OU hash do trecho final já lido diferente do salvo.
 */
export class TrophyLogWatcher {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private ticks = 0;

  constructor(private readonly trophies: TrophyService) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      if (this.ticks++ % ATTACH_EVERY_TICKS === 0) {
        await this.trophies.attachMissingLogs().catch((err) => console.warn('[trophies] falha ao detectar logs', err));
      }
      for (const set of this.trophies.watchedSets()) {
        try {
          await this.scan(set);
        } catch (err) {
          console.warn(`[trophies] falha ao ler ${set.logPath}`, err);
        }
      }
    } finally {
      this.busy = false;
    }
  }

  private async scan(set: WatchedSet): Promise<void> {
    const stat = await fs.stat(set.logPath).catch(() => null);
    if (!stat?.isFile() || stat.size === set.cursor) return;

    let start = set.cursor;
    if (stat.size < start) {
      start = 0;
    } else if (start > 0 && set.tailHash) {
      const tail = await readRange(set.logPath, Math.max(0, start - TAIL_BYTES), start);
      if (md5(tail) !== set.tailHash) start = 0; // arquivo reescrito por uma nova partida
    }

    const end = Math.min(stat.size, start + MAX_CHUNK_BYTES);
    const chunk = await readRange(set.logPath, start, end);
    // Processa só linhas completas; a linha parcial fica para a próxima leitura.
    const lastNewline = chunk.lastIndexOf(0x0a);
    if (lastNewline < 0) return;
    const cursor = start + lastNewline + 1;
    const text = chunk.subarray(0, lastNewline + 1).toString('utf8');

    const ids = new Set<number>();
    let pattern: RegExp;
    try {
      pattern = new RegExp(set.logPattern || DEFAULT_LOG_PATTERN, 'gi');
    } catch {
      pattern = new RegExp(DEFAULT_LOG_PATTERN, 'gi');
    }
    for (const match of text.matchAll(pattern)) {
      const id = Number(match[1]);
      if (Number.isInteger(id) && id >= 0) ids.add(id);
    }

    const tail = await readRange(set.logPath, Math.max(0, cursor - TAIL_BYTES), cursor);
    this.trophies.applyLogProgress(set.gameId, cursor, md5(tail), [...ids]);
  }
}
