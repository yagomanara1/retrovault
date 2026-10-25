import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { StorePort } from '@shared/store';
import { openDatabase } from '../../db/database';
import { GameRepository } from '../../db/repositories/gameRepository';
import { StoreInstallRepository } from '../../db/repositories/storeInstallRepository';
import { useTempDir } from '../../testing/tempDir';
import { n64ByteOrder } from '../romHasher';
import { parseCatalog } from './catalogSchema';
import { describeRom, inspectRom, matchAccepted, RomService } from './romService';
import { SEED_CATALOG } from './seedCatalog';

/** ROM .z64 sintética com cabeçalho de N64 (nome interno, código do cartucho e revisão). */
function makeRom(title: string, code: string, version: number, seed = 1): Buffer {
  const rom = Buffer.alloc(0x2000);
  for (let i = 0x40; i < rom.length; i++) rom[i] = (i * 31 + seed * 7) & 0xff;
  rom.writeUInt32BE(0x80371240, 0);
  rom.write(title.padEnd(20, ' '), 0x20, 'latin1');
  rom.write(code, 0x3b, 'latin1');
  rom[0x3f] = version;
  return rom;
}
const toV64 = (z64: Buffer) => Buffer.from(z64).swap16();
const toN64 = (z64: Buffer) => Buffer.from(z64).swap32();
const sha1 = (b: Buffer) => createHash('sha1').update(b).digest('hex');
const md5 = (b: Buffer) => createHash('md5').update(b).digest('hex');

describe('ROM de N64: formato, hashes e cabeçalho', () => {
  const tmp = useTempDir();
  const banjo = makeRom('BANJO-KAZOOIE', 'NBKE', 0);

  it('reconhece .z64, .v64 e .n64 e recusa o que não é N64', () => {
    expect(n64ByteOrder(banjo)).toBe('z64');
    expect(n64ByteOrder(toV64(banjo))).toBe('v64');
    expect(n64ByteOrder(toN64(banjo))).toBe('n64');
    expect(n64ByteOrder(Buffer.from('não é rom'.repeat(20)))).toBeNull();
  });

  it('os três formatos dão os mesmos hashes (calculados sobre o .z64) e o mesmo cabeçalho', async () => {
    const results = [];
    for (const [name, data] of [['a.z64', banjo], ['a.v64', toV64(banjo)], ['a.n64', toN64(banjo)]] as const) {
      const file = path.join(tmp(), name);
      await fs.writeFile(file, data);
      results.push(await inspectRom(file));
    }
    for (const info of results) {
      expect(info).toMatchObject({ sha1: sha1(banjo), md5: md5(banjo), code: 'NBKE', version: 0, title: 'BANJO-KAZOOIE' });
      expect(info.data.equals(banjo)).toBe(true);
    }
    expect(results.map((r) => r.format)).toEqual(['z64', 'v64', 'n64']);
    expect(describeRom(results[0]!)).toBe('BANJO-KAZOOIE (EUA, revisão 0)');
  });

  it('arquivo que não é ROM ou que não existe vira erro claro', async () => {
    const file = path.join(tmp(), 'foto.jpg');
    await fs.writeFile(file, Buffer.alloc(0x1000, 0xff));
    await expect(inspectRom(file)).rejects.toMatchObject({ code: 'VALIDATION', message: expect.stringMatching(/não é uma ROM/) });
    await expect(inspectRom(path.join(tmp(), 'nada.z64'))).rejects.toMatchObject({ code: 'FILE_MISSING' });
  });

  it('confere por SHA-1, MD5 ou código do cartucho', () => {
    const info = { sha1: sha1(banjo), md5: md5(banjo), code: 'NBKE', version: 0 };
    expect(matchAccepted(info, [{ name: 'por sha1', sha1: sha1(banjo) }])?.name).toBe('por sha1');
    expect(matchAccepted(info, [{ name: 'por md5', md5: md5(banjo) }])?.name).toBe('por md5');
    const sha256 = createHash('sha256').update(banjo).digest('hex');
    expect(matchAccepted({ ...info, sha256 }, [{ name: 'por sha256', sha256 }])?.name).toBe('por sha256');
    expect(matchAccepted(info, [{ name: 'EUA 1.0', header: { code: 'NBKE', version: 0 } }])?.name).toBe('EUA 1.0');
    expect(matchAccepted({ ...info, version: 1 }, [{ name: 'EUA 1.0', header: { code: 'NBKE', version: 0 } }])).toBeNull();
    expect(matchAccepted(info, [{ name: 'outra', sha1: '0'.repeat(40) }])).toBeNull();
  });
});

/** ROM de DS sintética: título, código do jogo, revisão e o CRC do logo da Nintendo no cabeçalho. */
function makeNds(title: string, code: string, version: number): Buffer {
  const rom = Buffer.alloc(0x4000);
  for (let i = 0x200; i < rom.length; i++) rom[i] = (i * 13) & 0xff;
  rom.write(title.padEnd(12, '\0'), 0, 'latin1');
  rom.write(code, 0x0c, 'latin1');
  rom[0x1e] = version;
  rom.writeUInt16LE(0xcf56, 0x15c);
  return rom;
}

describe('ROM de Nintendo DS', () => {
  const tmp = useTempDir();

  it('reconhece pelo cabeçalho e lê código e revisão (Metroid Prime Hunters EUA 1.1)', async () => {
    const file = path.join(tmp(), 'mph.nds');
    const rom = makeNds('METROIDPRIME', 'AMHE', 1);
    await fs.writeFile(file, rom);
    const info = await inspectRom(file);
    expect(info).toMatchObject({ format: 'nds', code: 'AMHE', version: 1, title: 'METROIDPRIME', sha1: sha1(rom) });
    expect(describeRom(info)).toBe('METROIDPRIME (EUA, revisão 1)');
    const accepted = [
      { name: 'EUA 1.0', header: { code: 'AMHE', version: 0 } },
      { name: 'EUA 1.1', header: { code: 'AMHE', version: 1 } },
    ];
    expect(matchAccepted(info, accepted)?.name).toBe('EUA 1.1');
    expect(matchAccepted({ ...info, code: 'AMHP' }, accepted)).toBeNull(); // europeia: não aceita
  });

  it('sem o CRC do logo não é ROM de DS nem de N64', async () => {
    const file = path.join(tmp(), 'falso.nds');
    const rom = makeNds('X', 'AMHE', 0);
    rom.writeUInt16LE(0, 0x15c);
    await fs.writeFile(file, rom);
    await expect(inspectRom(file)).rejects.toMatchObject({ message: expect.stringMatching(/Nintendo DS/) });
  });
});

describe('RomService', () => {
  const tmp = useTempDir();
  const good = makeRom('PERFECT DARK', 'NPDE', 1);
  const other = makeRom('PERFECT DARK', 'NPDP', 0, 2); // versão europeia: não aceita

  const port = (method: 'copy' | 'in-app'): StorePort => ({
    id: 'pd',
    name: 'Perfect Dark',
    original: { title: 'Perfect Dark', platform: 'n64' },
    developer: 'x',
    summary: 's',
    description: '',
    tags: [],
    source: { type: 'github', repo: 'a/b' },
    assets: { windows: 'x' },
    requires: { kind: 'rom', label: 'ROM de Perfect Dark' },
    setup: {
      method,
      target: method === 'copy' ? 'data/pd.ntsc-final.z64' : undefined,
      instructions: 'i',
      accepted: [{ name: 'EUA 1.1', md5: md5(good) }],
    },
  });

  function setup(method: 'copy' | 'in-app', installed = true) {
    const db = openDatabase(':memory:');
    const repo = new StoreInstallRepository(db);
    const installDir = path.join(tmp(), 'Ports', 'pd', 'v1');
    if (installed) {
      const game = new GameRepository(db).create({
        title: 'PD', kind: 'executable', path: path.join(installDir, 'pd.exe'), corePath: null, launchArgs: null, consoleId: null, raGameId: null, romHash: null, coverUrl: null, backgroundUrl: null, iconUrl: null,
      });
      repo.save('pd', { kind: 'archive', tag: 'v1', assetName: 'a.zip', sha256: 'x', verified: true, installDir, exePath: path.join(installDir, 'pd.exe'), sizeBytes: 1, installedAt: '' }, null, game.id);
    }
    const service = new RomService({ store: { port: async () => port(method) }, repo });
    return { service, repo, installDir };
  }

  async function write(name: string, data: Buffer) {
    const file = path.join(tmp(), name);
    await fs.writeFile(file, data);
    return file;
  }

  it('copy: confere e coloca a ROM em .z64 no destino do port, mesmo vinda em .v64', async () => {
    const { service, installDir } = setup('copy');
    expect((await service.status('pd'))?.state).toBe('missing');
    const result = await service.setup('pd', await write('minha.v64', toV64(good)));
    expect(result).toMatchObject({ action: 'copied', status: { state: 'ready', versionName: 'EUA 1.1' } });
    expect((await fs.readFile(path.join(installDir, 'data', 'pd.ntsc-final.z64'))).equals(good)).toBe(true);
  });

  it('recusa a versão errada dizendo o que foi escolhido e o que é aceito', async () => {
    const { service, installDir } = setup('copy');
    await expect(service.setup('pd', await write('eu.z64', other))).rejects.toMatchObject({
      code: 'VALIDATION',
      message: expect.stringMatching(/PERFECT DARK \(Europa, revisão 0\).*EUA 1\.1/),
    });
    await expect(fs.access(path.join(installDir, 'data'))).rejects.toThrow(); // nada foi gravado
  });

  it('in-app: .z64 só é conferida; .n64 ganha uma cópia .z64 para selecionar', async () => {
    const { service, installDir } = setup('in-app');
    const z64 = await write('ok.z64', good);
    expect(await service.setup('pd', z64)).toMatchObject({ action: 'verified', status: { state: 'verified', fileToSelect: path.resolve(z64) } });

    const n64 = await write('ok.n64', toN64(good));
    const converted = await service.setup('pd', n64);
    const prepared = path.join(installDir, 'rom-retrovault', 'pd.z64');
    expect(converted).toMatchObject({ action: 'converted', status: { fileToSelect: prepared } });
    expect((await fs.readFile(prepared)).equals(good)).toBe(true);
  });

  it('reapply recoloca a ROM lembrada numa instalação nova', async () => {
    const { service, repo, installDir } = setup('copy');
    await service.setup('pd', await write('minha.z64', good));
    // "Atualização": a instalação passa a apontar para outra pasta, ainda sem ROM.
    const newDir = path.join(path.dirname(installDir), 'v2');
    const install = repo.get('pd')!;
    repo.save('pd', { ...install, tag: 'v2', installDir: newDir, exePath: path.join(newDir, 'pd.exe') }, null, install.gameId!);
    expect((await service.status('pd'))?.state).toBe('missing');
    expect(await service.reapply('pd')).toBe(true);
    expect((await service.status('pd'))?.state).toBe('ready');
    expect((await fs.readFile(path.join(newDir, 'data', 'pd.ntsc-final.z64'))).equals(good)).toBe(true);
  });

  it('sem instalação, ou sem ROM lembrada, não faz nada de errado', async () => {
    const { service } = setup('copy', false);
    await expect(service.setup('pd', await write('minha.z64', good))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await service.reapply('pd')).toBe(false);
  });
});

describe('RomService: consoles sem cabeçalho conhecido (SNES)', () => {
  const tmp = useTempDir();
  const rom = Buffer.alloc(0x8000);
  for (let i = 0; i < rom.length; i++) rom[i] = (i * 7) & 0xff;
  const sha256 = createHash('sha256').update(rom).digest('hex');

  function setup() {
    const db = openDatabase(':memory:');
    const repo = new StoreInstallRepository(db);
    const installDir = path.join(tmp(), 'Ports', 'z3', 'v1');
    const game = new GameRepository(db).create({
      title: 'Z3', kind: 'executable', path: path.join(installDir, 'z3.exe'), corePath: null, launchArgs: null, consoleId: null, raGameId: null, romHash: null, coverUrl: null, backgroundUrl: null, iconUrl: null,
    });
    repo.save('z3', { kind: 'archive', tag: 'v1', assetName: 'a.zip', sha256: 'x', verified: true, installDir, exePath: path.join(installDir, 'z3.exe'), sizeBytes: 1, installedAt: '' }, null, game.id);
    const port: StorePort = {
      id: 'z3', name: 'Zelda 3', original: { title: 'A Link to the Past', platform: 'snes' }, developer: 'x', summary: 's', description: '', tags: [],
      source: { type: 'github', repo: 'a/b' }, assets: { windows: 'x' }, requires: { kind: 'rom', label: 'ROM' },
      setup: { method: 'copy', target: 'zelda3.sfc', instructions: 'i', accepted: [{ name: 'EUA', sha256 }] },
    };
    return { service: new RomService({ store: { port: async () => port }, repo }), installDir };
  }

  it('confere pelo hash e entrega sem o cabeçalho de copiadora (.smc de 512 bytes a mais)', async () => {
    const { service, installDir } = setup();
    const file = path.join(tmp(), 'Zelda.smc');
    await fs.writeFile(file, Buffer.concat([Buffer.alloc(512), rom]));
    expect(await service.setup('z3', file)).toMatchObject({ action: 'copied', status: { state: 'ready', versionName: 'EUA' } });
    expect((await fs.readFile(path.join(installDir, 'zelda3.sfc'))).equals(rom)).toBe(true);
  });

  it('outro arquivo é recusado dizendo o nome do que foi escolhido', async () => {
    const { service } = setup();
    const file = path.join(tmp(), 'outro.sfc');
    await fs.writeFile(file, Buffer.alloc(0x8000, 1));
    await expect(service.setup('z3', file)).rejects.toMatchObject({ code: 'VALIDATION', message: expect.stringMatching(/outro\.sfc.*EUA/) });
  });
});

describe('catálogo embutido: assistente de ROM', () => {
  it('todo port de N64 diz como recebe a ROM e quais versões aceita', () => {
    for (const p of parseCatalog(SEED_CATALOG).ports) {
      // Jogo gratuito: não há cópia do usuário para receber.
      if (p.requires.kind === 'none') {
        expect(p.setup, p.id).toBeUndefined();
        continue;
      }
      expect(p.setup, p.id).toBeDefined();
      if (p.original.platform === 'n64') expect(p.setup!.accepted?.length, p.id).toBeGreaterThan(0);
      if (p.setup!.method === 'copy') expect(p.setup!.target, p.id).toBeTruthy();
    }
  });
});
