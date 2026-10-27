import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ConsoleId } from '@shared/consoles';
import { describe, expect, it } from 'vitest';
import { useTempDir } from '../testing/tempDir';
import { buildZip } from '../testing/zip';
import { canAutoMatch, consoleFromExtension, hashRom, normalizeRom } from './romHasher';

const md5 = (b: Buffer) => createHash('md5').update(b).digest('hex');
const body = Buffer.from(Array.from({ length: 8192 }, (_, i) => i % 251));

describe('consoleFromExtension / canAutoMatch', () => {
  it('identifica pela extensão específica; .zip abre, .7z/.rar e discos compactados não', () => {
    expect(consoleFromExtension('x.sfc')).toBe(ConsoleId.SNES);
    expect(consoleFromExtension('x.bin')).toBeNull();
    expect(canAutoMatch('x.sfc', ConsoleId.SNES)).toBe(true);
    expect(canAutoMatch('x.zip', ConsoleId.SNES)).toBe(true);
    expect(canAutoMatch('x.7z', ConsoleId.SNES)).toBe(false);
    expect(canAutoMatch('x.bin', ConsoleId.Genesis)).toBe(true); // .bin de Mega Drive é cartucho
    expect(canAutoMatch('x.nds', ConsoleId.NDS)).toBe(true);
    expect(canAutoMatch('x.cue', ConsoleId.PlayStation)).toBe(true);
    expect(canAutoMatch('x.iso', ConsoleId.PS2)).toBe(true);
    expect(canAutoMatch('x.cso', ConsoleId.PSP)).toBe(true);
    expect(canAutoMatch('x.cso', ConsoleId.PlayStation)).toBe(false); // CSO é só de PSP
    expect(canAutoMatch('x.chd', ConsoleId.PlayStation)).toBe(false);
    expect(canAutoMatch('x.pbp', ConsoleId.PlayStation)).toBe(false);
    expect(canAutoMatch('x.gdi', ConsoleId.Dreamcast)).toBe(false);
  });
});

describe('normalizeRom (mesmo hash do rcheevos)', () => {
  it('NES: remove o cabeçalho iNES de 16 bytes', () => {
    const headered = Buffer.concat([Buffer.from('NES\x1a', 'latin1'), Buffer.alloc(12), body]);
    expect(md5(normalizeRom(headered, ConsoleId.NES))).toBe(md5(body));
  });

  it('SNES: remove o cabeçalho de copiadora de 512 bytes', () => {
    expect(md5(normalizeRom(Buffer.concat([Buffer.alloc(512), body]), ConsoleId.SNES))).toBe(md5(body));
    expect(normalizeRom(body, ConsoleId.SNES)).toBe(body);
  });

  it('N64: .v64 (byte-swap) e .n64 (little-endian) viram .z64', () => {
    const z64 = Buffer.concat([Buffer.from([0x80, 0x37, 0x12, 0x40]), body]);
    const v64 = Buffer.from(z64).swap16();
    const n64 = Buffer.from(z64).swap32();
    expect(md5(normalizeRom(v64, ConsoleId.N64))).toBe(md5(z64));
    expect(md5(normalizeRom(n64, ConsoleId.N64))).toBe(md5(z64));
  });
});

describe('hashRom', () => {
  const tmp = useTempDir();

  it('lê o arquivo e aplica a normalização do console', async () => {
    const file = path.join(tmp(), 'jogo.nes');
    await fs.writeFile(file, Buffer.concat([Buffer.from('NES\x1a', 'latin1'), Buffer.alloc(12), body]));
    expect(await hashRom(file, ConsoleId.NES)).toBe(md5(body));
  });

  it('.zip: a ROM de dentro, com a extensão do console, e a mesma normalização (zip com um arquivo só aceita qualquer nome)', async () => {
    const rom = Buffer.concat([Buffer.alloc(512), body]); // SNES com cabeçalho de copiadora
    const zip = path.join(tmp(), 'jogo.zip');
    await fs.writeFile(zip, buildZip([{ name: 'leia-me.txt', content: 'oi' }, { name: 'pasta/', content: null }, { name: 'pasta/Jogo (USA).sfc', content: rom }]));
    expect(await hashRom(zip, ConsoleId.SNES)).toBe(md5(body));
    const single = path.join(tmp(), 'um.zip');
    await fs.writeFile(single, buildZip([{ name: 'rom.bin', content: body }]));
    expect(await hashRom(single, ConsoleId.Genesis)).toBe(md5(body));
    const none = path.join(tmp(), 'nada.zip');
    await fs.writeFile(none, buildZip([{ name: 'a.txt', content: 'a' }, { name: 'b.txt', content: 'b' }]));
    expect(await hashRom(none, ConsoleId.SNES)).toBeNull();
  });

  it('Arcade: hash do nome do arquivo, não do conteúdo', async () => {
    expect(await hashRom('C:\\roms\\sf2.zip', ConsoleId.Arcade)).toBe(md5(Buffer.from('sf2')));
  });

  it('leitura em pedaços dá o mesmo hash da ROM inteira na memória, em todos os layouts (arquivos > 1 MB)', async () => {
    // Conteúdo pseudoaleatório de ~3,5 MB: atravessa várias fronteiras de pedaço de 1 MB.
    const big = (n: number) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 2654435761) >>> 24));
    const body3m = big(3 * 1024 * 1024 + 8192);
    const z64 = Buffer.concat([Buffer.from([0x80, 0x37, 0x12, 0x40]), body3m]);
    const cases: [string, number, Buffer][] = [
      ['nes', ConsoleId.NES, Buffer.concat([Buffer.from('NES\x1a', 'latin1'), Buffer.alloc(12), body3m])],
      ['sfc', ConsoleId.SNES, Buffer.concat([Buffer.alloc(512), body3m])],
      ['pce', ConsoleId.PCEngine, Buffer.concat([Buffer.alloc(512), big(3 * 131072)])],
      ['lnx', ConsoleId.Lynx, Buffer.concat([Buffer.from('LYNX\0', 'latin1'), Buffer.alloc(59), body3m])],
      ['a78', ConsoleId.Atari7800, Buffer.concat([Buffer.from('\x01ATARI7800', 'latin1'), Buffer.alloc(118), body3m])],
      ['z64', ConsoleId.N64, z64],
      ['v64', ConsoleId.N64, Buffer.from(z64).swap16()],
      ['n64', ConsoleId.N64, Buffer.from(z64).swap32()],
      ['md', ConsoleId.Genesis, body3m],
    ];
    for (const [ext, consoleId, rom] of cases) {
      const file = path.join(tmp(), `rom.${ext}`);
      await fs.writeFile(file, rom);
      expect(await hashRom(file, consoleId), ext).toBe(md5(normalizeRom(rom, consoleId)));
    }
    // As três ordens do N64 dão o mesmo jogo.
    expect(md5(normalizeRom(Buffer.from(z64).swap16(), ConsoleId.N64))).toBe(md5(z64));
  });

  it('Nintendo DS grande (300 MB): identificado lendo só o cabeçalho e três trechos', async () => {
    const rom = Buffer.alloc(0x8000, 7);
    rom.writeUInt32LE(0x1000, 0x20);
    rom.writeUInt32LE(0x800, 0x2c);
    rom.writeUInt32LE(0x2000, 0x30);
    rom.writeUInt32LE(0x400, 0x3c);
    rom.writeUInt32LE(0x4000, 0x68);
    const file = path.join(tmp(), 'grande.nds');
    await fs.writeFile(file, rom);
    await fs.truncate(file, 300 * 1024 * 1024); // estende com zeros sem escrever 300 MB
    const expected = createHash('md5').update(rom.subarray(0, 0x160)).update(rom.subarray(0x1000, 0x1800)).update(rom.subarray(0x2000, 0x2400)).update(rom.subarray(0x4000, 0x4a00)).digest('hex');
    expect(await hashRom(file, ConsoleId.NDS)).toBe(expected);
  });
});
