import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Game } from '@shared/types';
import { makeTree, useTempDir } from '../testing/tempDir';
import { ArtworkService } from './artworkService';
import { GameService } from './gameService';

vi.mock('electron', () => ({ app: {}, nativeImage: {}, shell: {} }));

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const C = 'c'.repeat(32);

describe('limpeza de arte com o app aberto', () => {
  const tmp = useTempDir();

  it('apaga só o que não é usado e já é antigo; arquivo recém-gravado fica', async () => {
    const dir = tmp();
    await makeTree(dir, { [`${A}.png`]: 'usado', [`${B}.png`]: 'velho', [`${C}.png`]: 'novo', 'outro.txt': 'não é arte' });
    const old = new Date(Date.now() - 60 * 60_000);
    await fs.utimes(path.join(dir, `${A}.png`), old, old);
    await fs.utimes(path.join(dir, `${B}.png`), old, old);

    await new ArtworkService(dir).collectGarbage([`rv-media://artwork/${A}.png`, null], { minAgeMs: 10 * 60_000 });
    expect((await fs.readdir(dir)).sort()).toEqual([`${A}.png`, `${C}.png`, 'outro.txt']);

    // Sem idade mínima (comportamento de antes), o recente também sai.
    await new ArtworkService(dir).collectGarbage([`rv-media://artwork/${A}.png`]);
    expect((await fs.readdir(dir)).sort()).toEqual([`${A}.png`, 'outro.txt']);
  });
});

describe('ícones antigos na inicialização', () => {
  it('só os de data URL, no máximo 4 extrações ao mesmo tempo; sem ícone não é tentado de novo', async () => {
    const game = (id: number, iconUrl: string | null, kind: Game['kind'] = 'executable') => ({ id, kind, path: `C:\\j\\${id}.exe`, iconUrl }) as Game;
    const games = [
      ...Array.from({ length: 10 }, (_, i) => game(i + 1, 'data:image/png;base64,AAAA')),
      game(20, null), // .exe sem ícone: antes era tentado a cada abertura
      game(21, 'rv-media://artwork/x.png'),
      game(22, 'https://media.retroachievements.org/i.png'),
      game(23, 'data:image/png;base64,AAAA', 'retroarch'),
    ];
    const updated: number[] = [];
    let running = 0;
    let peak = 0;
    const extracted: string[] = [];
    const service = new GameService(
      { list: () => games, update: (id: number) => void updated.push(id) } as never,
      {} as never,
      {} as never,
      {
        extractExecutableIcon: async (p: string) => {
          extracted.push(p);
          running++;
          peak = Math.max(peak, running);
          await new Promise((r) => setTimeout(r, 5));
          running--;
          return p.endsWith('\\3.exe') ? null : 'rv-media://artwork/novo.png';
        },
      } as never,
      {} as never,
    );

    expect(await service.upgradeLegacyIcons()).toBe(9);
    expect(extracted).toHaveLength(10);
    expect(peak).toBe(4);
    expect(updated.sort((a, b) => a - b)).toEqual([1, 2, 4, 5, 6, 7, 8, 9, 10]);
  });
});
