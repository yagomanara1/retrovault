import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ConsoleId } from '@shared/consoles';
import { useTempDir } from '../../testing/tempDir';
import { detectConsole, hashNds, hashRom } from '../romHasher';
import { parseCue, parseM3u } from './discImage';
import { bootExecutable, detectDiscConsole, hashDisc } from './raDiscHash';

const md5 = (...parts: (Buffer | string)[]) => {
  const h = createHash('md5');
  for (const p of parts) h.update(p);
  return h.digest('hex');
};
const SECTOR = 2048;
const bytes = (n: number, seed = 7) => Buffer.from(Array.from({ length: n }, (_, i) => (i * seed + 13) % 251));

// ---------- Imagem ISO 9660 mínima, com o mesmo layout de um disco de verdade ----------

type Tree = { [name: string]: Buffer | Tree };

function dirRecord(name: Buffer, lba: number, size: number, isDir: boolean): Buffer {
  const len = 33 + name.length + (name.length % 2 === 0 ? 1 : 0);
  const r = Buffer.alloc(len);
  r[0] = len;
  r.writeUInt32LE(lba, 2);
  r.writeUInt32BE(lba, 6);
  r.writeUInt32LE(size, 10);
  r.writeUInt32BE(size, 14);
  r[25] = isDir ? 0x02 : 0;
  r[32] = name.length;
  name.copy(r, 33);
  return r;
}

/** Monta a imagem (setores de 2048): área do sistema (setor 0 opcional), descritor no 16, pastas e arquivos. */
function buildIso(tree: Tree, sector0?: Buffer): Buffer {
  const sectors: Buffer[] = [];
  const alloc = (n: number) => {
    const at = sectors.length;
    for (let i = 0; i < n; i++) sectors.push(Buffer.alloc(SECTOR));
    return at;
  };
  alloc(18); // 0–15 sistema, 16 descritor, 17 terminador
  if (sector0) sector0.copy(sectors[0]!);
  const writeDir = (node: Tree, parentLba: number): { lba: number; size: number } => {
    const lba = alloc(1); // pastas de teste cabem num setor
    const records: Buffer[] = [dirRecord(Buffer.from([0]), lba, SECTOR, true), dirRecord(Buffer.from([1]), parentLba || lba, SECTOR, true)];
    for (const [name, value] of Object.entries(node)) {
      if (Buffer.isBuffer(value)) {
        const at = alloc(Math.max(1, Math.ceil(value.length / SECTOR)));
        for (let i = 0; i * SECTOR < value.length; i++) value.copy(sectors[at + i]!, 0, i * SECTOR, (i + 1) * SECTOR);
        records.push(dirRecord(Buffer.from(`${name};1`, 'latin1'), at, value.length, false));
      } else {
        const sub = writeDir(value, lba);
        records.push(dirRecord(Buffer.from(name, 'latin1'), sub.lba, sub.size, true));
      }
    }
    Buffer.concat(records).copy(sectors[lba]!);
    return { lba, size: SECTOR };
  };
  const root = writeDir(tree, 0);
  const pvd = sectors[16]!;
  pvd[0] = 1;
  pvd.write('CD001', 1, 'latin1');
  dirRecord(Buffer.from([0]), root.lba, root.size, true).copy(pvd, 156);
  sectors[17]![0] = 255;
  return Buffer.concat(sectors);
}

/** Mesma imagem em setores crus de CD (2352): sincronismo + cabeçalho + dados (+ correção de erros zerada). */
function toRaw(iso: Buffer, mode: 1 | 2): Buffer {
  const out: Buffer[] = [];
  for (let i = 0; i * SECTOR < iso.length; i++) {
    const raw = Buffer.alloc(2352);
    Buffer.from([0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00]).copy(raw);
    raw[15] = mode;
    iso.copy(raw, mode === 2 ? 24 : 16, i * SECTOR, (i + 1) * SECTOR);
    out.push(raw);
  }
  return Buffer.concat(out);
}

/** CSO v1: índice de blocos; os pares são comprimidos (deflate), os ímpares guardados inteiros. */
function toCso(iso: Buffer): Buffer {
  const blocks = Math.ceil(iso.length / SECTOR);
  const header = Buffer.alloc(24);
  header.write('CISO', 0, 'latin1');
  header.writeUInt32LE(24, 4);
  header.writeBigUInt64LE(BigInt(iso.length), 8);
  header.writeUInt32LE(SECTOR, 16);
  header[20] = 1;
  const index = Buffer.alloc((blocks + 1) * 4);
  const data: Buffer[] = [];
  let at = 24 + index.length;
  for (let b = 0; b < blocks; b++) {
    const block = iso.subarray(b * SECTOR, (b + 1) * SECTOR);
    const stored = b % 2 === 0 ? deflateRawSync(block) : block;
    index.writeUInt32LE((at | (b % 2 === 0 ? 0 : 0x80000000)) >>> 0, b * 4);
    data.push(stored);
    at += stored.length;
  }
  index.writeUInt32LE(at, blocks * 4);
  return Buffer.concat([header, index, ...data]);
}

/** Executável de PS1: cabeçalho "PS-X EXE" diz o tamanho do código (sem os 2048 do cabeçalho). */
function psxExe(codeSize: number, fileSize: number): Buffer {
  const exe = bytes(fileSize, 3);
  exe.write('PS-X EXE', 0, 'latin1');
  exe.writeUInt32LE(codeSize, 28);
  return exe;
}

describe('SYSTEM.CNF', () => {
  it('acha o executável como o rcheevos: sem prefixo, barras e ";1"; BOOT2 não vale como BOOT', () => {
    expect(bootExecutable('BOOT = cdrom:\\SLUS_007.43;1\r\nTCB = 4', 'BOOT', 'cdrom:')).toBe('SLUS_007.43');
    expect(bootExecutable('BOOT2 = cdrom0:\\SLES_523.05;1\nVER = 1.00', 'BOOT2', 'cdrom0:')).toBe('SLES_523.05');
    expect(bootExecutable('BOOT2 = cdrom0:\\SLES_523.05;1', 'BOOT', 'cdrom:')).toBeNull();
    expect(bootExecutable('BOOT=cdrom:\\GAME\\MAIN.EXE;1', 'BOOT', 'cdrom:')).toBe('GAME\\MAIN.EXE');
    expect(bootExecutable('VMODE = NTSC', 'BOOT', 'cdrom:')).toBeNull();
  });
});

describe('índices de disco', () => {
  it('.cue: primeira trilha de dados, no arquivo dela e com o modo certo; não sai da pasta', () => {
    const cue = 'FILE "Jogo (Track 1).bin" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\nFILE "Jogo (Track 2).bin" BINARY\n  TRACK 02 AUDIO\n    INDEX 01 00:02:00\n';
    expect(parseCue(cue, 'C:\\jogos')).toEqual({ file: path.join('C:\\jogos', 'Jogo (Track 1).bin'), start: 0, sectorSize: 2352, dataOffset: 24 });
    expect(parseCue('FILE "..\\..\\fora.bin" BINARY\nTRACK 01 MODE1/2048\nINDEX 01 00:00:00', 'C:\\jogos')?.file).toBe(path.join('C:\\jogos', 'fora.bin'));
    expect(parseCue('FILE "a.bin" BINARY\nTRACK 01 AUDIO\nINDEX 01 00:00:00', 'C:\\jogos')).toBeNull();
  });

  it('.m3u: primeiro disco, ignorando comentários', () => {
    expect(parseM3u('#EXTM3U\n\nJogo (Disc 1).cue\nJogo (Disc 2).cue', 'C:\\jogos')).toBe(path.join('C:\\jogos', 'Jogo (Disc 1).cue'));
    expect(parseM3u('# só comentário', 'C:\\jogos')).toBeNull();
  });
});

describe('hash de disco (RetroAchievements)', () => {
  const tmp = useTempDir();
  const write = async (name: string, data: Buffer | string) => {
    const file = path.join(tmp(), name);
    await fs.writeFile(file, data);
    return file;
  };

  const exe = psxExe(4096, 9000); // o hash usa 4096 + 2048 bytes, não o arquivo inteiro
  const ps1Iso = buildIso({ 'SYSTEM.CNF': Buffer.from('BOOT = cdrom:\\SLUS_007.43;1\r\nTCB = 4\r\n'), 'SLUS_007.43': exe, 'DATA.BIN': bytes(5000) });
  const ps1Hash = md5('SLUS_007.43', exe.subarray(0, 4096 + 2048));

  it('PS1: nome do executável + tamanho do cabeçalho PS-X EXE, em ISO, BIN cru (CUE) e M3U', async () => {
    const iso = await write('ps1.iso', ps1Iso);
    expect(await hashDisc(iso, 'ps1')).toBe(ps1Hash);
    await write('ps1 (Track 1).bin', toRaw(ps1Iso, 2));
    const cue = await write('ps1.cue', 'FILE "ps1 (Track 1).bin" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\n');
    expect(await hashDisc(cue, 'ps1')).toBe(ps1Hash);
    const m3u = await write('ps1.m3u', 'ps1.cue\n');
    expect(await hashDisc(m3u, 'ps1')).toBe(ps1Hash);
    // BIN cru sem .cue: o modo sai do próprio setor.
    expect(await hashDisc(await write('solto.bin', toRaw(ps1Iso, 2)), 'ps1')).toBe(ps1Hash);
    expect(await detectDiscConsole(cue)).toBe(ConsoleId.PlayStation);
    expect(await hashRom(cue, ConsoleId.PlayStation)).toBe(ps1Hash);
  });

  it('PS1 sem SYSTEM.CNF: usa o PSX.EXE', async () => {
    const old = psxExe(2048, 4096);
    const file = await write('antigo.iso', buildIso({ 'PSX.EXE': old }));
    expect(await hashDisc(file, 'ps1')).toBe(md5('PSX.EXE', old.subarray(0, 4096)));
    expect(await detectDiscConsole(file)).toBe(ConsoleId.PlayStation);
  });

  it('PS2: nome + executável inteiro, também em Mode 1 cru', async () => {
    const elf = bytes(70_000, 5);
    const iso = buildIso({ 'SYSTEM.CNF': Buffer.from('BOOT2 = cdrom0:\\SLES_523.05;1\nVER = 1.00\n'), 'SLES_523.05': elf });
    const expected = md5('SLES_523.05', elf);
    expect(await hashDisc(await write('ps2.iso', iso), 'ps2')).toBe(expected);
    expect(await hashDisc(await write('ps2.bin', toRaw(iso, 1)), 'ps2')).toBe(expected);
    expect(await detectDiscConsole(path.join(tmp(), 'ps2.iso'))).toBe(ConsoleId.PS2);
    expect(await hashDisc(path.join(tmp(), 'ps2.iso'), 'ps1')).toBeNull(); // disco de PS2 não tem BOOT de PS1
  });

  it('PSP: PARAM.SFO + EBOOT.BIN, em ISO e em CSO comprimido; pastas sem diferença de maiúsculas', async () => {
    const sfo = bytes(600, 11);
    const eboot = bytes(12_345, 17);
    const iso = buildIso({ PSP_GAME: { 'PARAM.SFO': sfo, SYSDIR: { 'EBOOT.BIN': eboot } }, UMD_DATA: { 'X.BIN': bytes(10) } });
    const expected = md5(sfo, eboot);
    expect(await hashDisc(await write('psp.iso', iso), 'psp')).toBe(expected);
    const cso = await write('psp.cso', toCso(iso));
    expect(await hashDisc(cso, 'psp')).toBe(expected);
    expect(await detectDiscConsole(cso)).toBe(ConsoleId.PSP);
    expect(await hashRom(cso, ConsoleId.PSP)).toBe(expected);
  });

  it('Sega CD e Saturn: 512 bytes do setor 0', async () => {
    const segaCd = Buffer.concat([Buffer.from('SEGADISCSYSTEM  ', 'latin1'), bytes(1000)]);
    const saturn = Buffer.concat([Buffer.from('SEGA SEGASATURN ', 'latin1'), bytes(1000, 9)]);
    const cdFile = await write('scd.iso', buildIso({ 'A.BIN': bytes(10) }, segaCd));
    const satFile = await write('sat.bin', toRaw(buildIso({ 'A.BIN': bytes(10) }, saturn), 1));
    expect(await hashDisc(cdFile, 'sega-disc')).toBe(md5(segaCd.subarray(0, 512)));
    expect(await hashDisc(satFile, 'sega-disc')).toBe(md5(saturn.subarray(0, 512)));
    expect(await detectDiscConsole(cdFile)).toBe(ConsoleId.SegaCD);
    expect(await detectDiscConsole(satFile)).toBe(ConsoleId.Saturn);
  });

  it('disco desconhecido ou arquivo que não é disco: sem console e sem hash', async () => {
    const other = await write('outro.iso', buildIso({ 'README.TXT': Buffer.from('oi') }));
    expect(await detectDiscConsole(other)).toBeNull();
    expect(await hashDisc(other, 'ps1')).toBeNull();
    const notDisc = await write('nada.iso', bytes(50_000));
    expect(await detectDiscConsole(notDisc)).toBeNull();
    expect(await detectConsole(notDisc)).toBeNull();
    expect(await detectConsole(path.join(tmp(), 'nao-existe.cue'))).toBeNull();
  });
});

describe('Nintendo DS', () => {
  /** ROM mínima: cabeçalho com ARM9, ARM7 e ícone em posições conhecidas. */
  function ndsRom(): { rom: Buffer; expected: string } {
    const rom = bytes(0x8000, 23);
    rom.writeUInt32LE(0x1000, 0x20); // ARM9
    rom.writeUInt32LE(0x800, 0x2c);
    rom.writeUInt32LE(0x2000, 0x30); // ARM7
    rom.writeUInt32LE(0x400, 0x3c);
    rom.writeUInt32LE(0x4000, 0x68); // ícone
    rom[0] = 0x41; // não é o cabeçalho do SuperCard
    const expected = md5(rom.subarray(0, 0x160), rom.subarray(0x1000, 0x1800), rom.subarray(0x2000, 0x2400), rom.subarray(0x4000, 0x4a00));
    return { rom, expected };
  }

  it('cabeçalho + ARM9 + ARM7 + ícone; com o cabeçalho do SuperCard, o mesmo hash', () => {
    const { rom, expected } = ndsRom();
    expect(hashNds(rom)).toBe(expected);
    const superCard = Buffer.alloc(0x200);
    superCard.set([0x2e, 0, 0, 0xea]);
    superCard.set([0x44, 0x46, 0x96, 0], 0xb0);
    expect(hashNds(Buffer.concat([superCard, rom]))).toBe(expected);
  });

  it('tamanho absurdo de código: não é ROM de DS', () => {
    const { rom } = ndsRom();
    rom.writeUInt32LE(20 * 1024 * 1024, 0x2c);
    expect(hashNds(rom)).toBeNull();
  });
});
