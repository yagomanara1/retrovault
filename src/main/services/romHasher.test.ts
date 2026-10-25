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
});
