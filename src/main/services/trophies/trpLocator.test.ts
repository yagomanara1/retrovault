import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTree, useTempDir } from '../../testing/tempDir';
import { readSfoString, TrpLocator } from './trpLocator';

const TRP = 'sce_sys/trophy/trophy00.trp';

/** param.sfo mínimo (formato PSF little-endian) com as chaves pedidas. */
function buildSfo(entries: Record<string, string>): Buffer {
  const keys = Object.keys(entries);
  const keyTable = Buffer.concat(keys.map((k) => Buffer.from(`${k}\0`, 'latin1')));
  const values = keys.map((k) => Buffer.from(`${entries[k]}\0`, 'utf8'));
  const keyTableStart = 0x14 + keys.length * 16;
  const dataTableStart = keyTableStart + keyTable.length;
  const header = Buffer.alloc(0x14);
  header.writeUInt32BE(0x00505346, 0);
  header.writeUInt32LE(keyTableStart, 8);
  header.writeUInt32LE(dataTableStart, 12);
  header.writeUInt32LE(keys.length, 16);
  const index = Buffer.alloc(keys.length * 16);
  let keyOffset = 0;
  let dataOffset = 0;
  keys.forEach((k, i) => {
    index.writeUInt16LE(keyOffset, i * 16);
    index.writeUInt32LE(values[i]!.length, i * 16 + 4);
    index.writeUInt32LE(dataOffset, i * 16 + 12);
    keyOffset += k.length + 1;
    dataOffset += values[i]!.length;
  });
  return Buffer.concat([header, index, keyTable, ...values]);
}

describe('readSfoString', () => {
  it('lê TITLE_ID e TITLE', () => {
    const sfo = buildSfo({ TITLE: 'God of War® III', TITLE_ID: 'CUSA01623' });
    expect(readSfoString(sfo, 'TITLE_ID')).toBe('CUSA01623');
    expect(readSfoString(sfo, 'TITLE')).toBe('God of War® III');
    expect(readSfoString(sfo, 'NADA')).toBeNull();
  });

  it('ignora arquivos que não são PSF', () => {
    expect(readSfoString(Buffer.from('não é sfo'), 'TITLE_ID')).toBeNull();
  });
});

describe('TrpLocator', () => {
  const tmp = useTempDir();
  const locate = (game: { path: string; launchArgs?: string | null }, roots: string[] = []) =>
    new TrpLocator(roots).locate({ path: game.path, launchArgs: game.launchArgs ?? null });

  it('game-path: o arquivo do jogo está dentro do dump (eboot.bin)', async () => {
    await makeTree(tmp(), { [`CUSA00001/${TRP}`]: 'x', 'CUSA00001/eboot.bin': 'x' });
    const r = await locate({ path: path.join(tmp(), 'CUSA00001/eboot.bin') });
    expect(r).toMatchObject({ source: 'game-path', titleId: 'CUSA00001', dumpDir: path.join(tmp(), 'CUSA00001') });
  });

  it('launch-args: shadPS4.exe -g "…\\eboot.bin"', async () => {
    await makeTree(tmp(), { [`Jogos/CUSA00002/${TRP}`]: 'x', 'Jogos/CUSA00002/eboot.bin': 'x', 'Emu/shadPS4.exe': 'x' });
    const eboot = path.join(tmp(), 'Jogos/CUSA00002/eboot.bin');
    const r = await locate({ path: path.join(tmp(), 'Emu/shadPS4.exe'), launchArgs: `-g "${eboot}"` });
    expect(r?.source).toBe('launch-args');
  });

  it('nearby: único dump ao lado do port, sem pistas, é aceito', async () => {
    await makeTree(tmp(), { [`Port/CUSA00003/${TRP}`]: 'x', 'Port/port/Jogo.exe': 'x' });
    const r = await locate({ path: path.join(tmp(), 'Port/port/Jogo.exe') });
    expect(r).toMatchObject({ source: 'nearby', titleId: 'CUSA00003' });
  });

  it('nearby: com vários dumps, escolhe o do Title ID citado nos saves do port', async () => {
    await makeTree(tmp(), {
      [`Lib/CUSA00010/${TRP}`]: 'x',
      [`Lib/CUSA00011/${TRP}`]: 'x',
      'Lib/port/Jogo.exe': 'x',
      'Lib/port/user/savedata/1/CUSA00011/': null,
    });
    const r = await locate({ path: path.join(tmp(), 'Lib/port/Jogo.exe') });
    expect(r?.titleId).toBe('CUSA00011');
  });

  it('launcher-config: dump em outra pasta, apontado pelo settings.json do launcher (caso do GoW3)', async () => {
    const dump = path.join(tmp(), 'Desktop/Gow/CUSA01623_1/CUSA01623');
    await makeTree(tmp(), {
      [`Desktop/Gow/CUSA01623_1/CUSA01623/${TRP}`]: 'x',
      'Desktop/Gow/CUSA01623_1/CUSA01623/sce_sys/param.sfo': buildSfo({ TITLE_ID: 'CUSA01623' }),
      'Desktop/Jogos/gow3-windows/God of War III.exe': 'x',
      'Desktop/Jogos/gow3-windows/user/savedata/1/CUSA01623/': null,
      'AppData/gow3-launcher/settings.json': JSON.stringify({ game_dir: dump }),
    });
    const r = await locate({ path: path.join(tmp(), 'Desktop/Jogos/gow3-windows/God of War III.exe') }, [path.join(tmp(), 'AppData')]);
    expect(r).toMatchObject({ source: 'launcher-config', titleId: 'CUSA01623', dumpDir: dump });
  });

  it('launcher-config: sem saves, aceita quando o nome do launcher bate com um arquivo do port (gow3.ini)', async () => {
    const dump = path.join(tmp(), 'Dumps/CUSA01623');
    await makeTree(tmp(), {
      [`Dumps/CUSA01623/${TRP}`]: 'x',
      'Port/God of War III.exe': 'x',
      'Port/gow3.ini': 'x',
      'AppData/gow3-launcher/settings.json': JSON.stringify({ game_dir: dump }),
    });
    const r = await locate({ path: path.join(tmp(), 'Port/God of War III.exe') }, [path.join(tmp(), 'AppData')]);
    expect(r?.dumpDir).toBe(dump);
  });

  it('não associa o dump de outro launcher a um jogo sem relação (falso positivo)', async () => {
    const dump = path.join(tmp(), 'Dumps/CUSA01623');
    await makeTree(tmp(), {
      [`Dumps/CUSA01623/${TRP}`]: 'x',
      'Outro/Jogo PC/Jogo.exe': 'x',
      'AppData/gow3-launcher/settings.json': JSON.stringify({ game_dir: dump }),
    });
    expect(await locate({ path: path.join(tmp(), 'Outro/Jogo PC/Jogo.exe') }, [path.join(tmp(), 'AppData')])).toBeNull();
  });
});
