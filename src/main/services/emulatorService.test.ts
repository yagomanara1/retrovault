import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConsoleId } from '@shared/consoles';
import { EMULATORS, getEmulator } from '@shared/emulators';
import type { Game } from '@shared/types';
import { openDatabase } from '../db/database';
import { SettingsRepository } from '../db/repositories/settingsRepository';
import { makeTree, useTempDir } from '../testing/tempDir';
import { detectConsole } from './romHasher';
import { EmulatorService } from './emulatorService';

const rom = (consoleId: number, file = 'C:\\ROMs\\jogo.iso') => ({ id: 1, kind: 'retroarch', path: file, consoleId, title: 'Jogo' }) as Game;

describe('parâmetros de cada emulador (conferidos no código deles)', () => {
  it('modo batch (fecha junto com o jogo), tela cheia e o arquivo no fim', () => {
    const rom = 'C:\\R\\j.iso';
    expect(getEmulator('pcsx2')!.args(rom, true)).toEqual(['-batch', '-fullscreen', '--', rom]);
    expect(getEmulator('duckstation')!.args(rom, false)).toEqual(['-batch', '--', rom]);
    expect(getEmulator('dolphin')!.args(rom, true)).toEqual(['-b', '-C', 'Dolphin.Display.Fullscreen=True', '-e', rom]);
    expect(getEmulator('ppsspp')!.args(rom, true)).toEqual(['--fullscreen', '--escape-exit', rom]);
    expect(getEmulator('melonds')!.args(rom, true)).toEqual(['-f', rom]);
    expect(getEmulator('mgba')!.args(rom, false)).toEqual([rom]);
  });

  it('todo emulador tem console, executável e pasta de instalação', () => {
    for (const e of EMULATORS) {
      expect(e.consoles.length, e.id).toBeGreaterThan(0);
      expect(e.exeNames.every((n) => n.toLowerCase().endsWith('.exe')), e.id).toBe(true);
      expect(e.installDirs.length, e.id).toBeGreaterThan(0);
    }
  });
});

describe('EmulatorService', () => {
  const tmp = useTempDir();

  function setup(cores: string[] = []) {
    const programs = path.join(tmp(), 'Program Files');
    const service = new EmulatorService({
      repo: new SettingsRepository(openDatabase(':memory:')),
      installRoots: [programs, path.join(tmp(), 'Programs')],
      homeDir: path.join(tmp(), 'home'),
      retroArchCores: async () => cores,
    });
    return { service, programs };
  }

  it('acha nas pastas de instalação e no Scoop; sem nada, o RetroArch abre tudo', async () => {
    const { service, programs } = setup(['pcsx2']);
    await makeTree(programs, { 'PCSX2/pcsx2-qt.exe': 'x' });
    await makeTree(tmp(), { 'home/scoop/apps/dolphin/current/Dolphin.exe': 'x' });
    const overview = await service.refresh();
    expect(overview.emulators.find((e) => e.id === 'pcsx2')?.detectedPath).toBe(path.join(programs, 'PCSX2', 'pcsx2-qt.exe'));
    expect(overview.emulators.find((e) => e.id === 'dolphin')?.path).toBe(path.join(tmp(), 'home', 'scoop', 'apps', 'dolphin', 'current', 'Dolphin.exe'));
    expect(overview.emulators.find((e) => e.id === 'ppsspp')?.path).toBeNull();
    // PS2 tem core no RetroArch: o automático continua nele. GameCube não tem: vai para o Dolphin instalado.
    expect(overview.consoles.find((c) => c.consoleId === ConsoleId.PS2)).toMatchObject({ choice: null, effective: 'retroarch', retroArchCore: true });
    expect(overview.consoles.find((c) => c.consoleId === ConsoleId.GameCube)).toMatchObject({ choice: null, effective: 'dolphin', retroArchCore: false });
    expect(overview.consoles.find((c) => c.consoleId === ConsoleId.PSP)).toMatchObject({ effective: 'retroarch' }); // nada instalado
    expect(await service.launchSpec(rom(ConsoleId.PS2))).toBeNull(); // RetroArch
    expect(await service.launchSpec(rom(ConsoleId.GameCube, 'C:\\ROMs\\zelda.rvz'))).toEqual({
      command: path.join(tmp(), 'home', 'scoop', 'apps', 'dolphin', 'current', 'Dolphin.exe'),
      args: ['-b', '-C', 'Dolphin.Display.Fullscreen=True', '-e', 'C:\\ROMs\\zelda.rvz'],
      cwd: path.join(tmp(), 'home', 'scoop', 'apps', 'dolphin', 'current'),
    });
  });

  it('escolha por console vale mesmo com core no RetroArch; tela cheia desligada muda os parâmetros', async () => {
    const { service, programs } = setup(['pcsx2']);
    await makeTree(programs, { 'PCSX2/pcsx2-qt.exe': 'x' });
    await service.setForConsole(ConsoleId.PS2, 'pcsx2');
    await service.setFullscreen(false);
    expect((await service.launchSpec(rom(ConsoleId.PS2)))?.args).toEqual(['-batch', '--', 'C:\\ROMs\\jogo.iso']);
    await service.setForConsole(ConsoleId.PS2, 'retroarch');
    expect(await service.launchSpec(rom(ConsoleId.PS2))).toBeNull();
    await service.setForConsole(ConsoleId.PS2, null);
    expect((await service.overview()).consoles.find((c) => c.consoleId === ConsoleId.PS2)?.choice).toBeNull();
  });

  it('emulador escolhido mas não instalado: erro claro (não abre em outro sem avisar)', async () => {
    const { service } = setup();
    await service.setForConsole(ConsoleId.PSP, 'ppsspp');
    await expect(service.launchSpec(rom(ConsoleId.PSP))).rejects.toMatchObject({ code: 'EMULATOR_NOT_FOUND', message: expect.stringMatching(/PPSSPP/) });
  });

  it('recusa emulador de outro console e arquivo que não é .exe; caminho indicado à mão tem prioridade', async () => {
    const { service, programs } = setup();
    await expect(service.setForConsole(ConsoleId.PS2, 'dolphin')).rejects.toThrow(/não roda/);
    await expect(service.setForConsole(ConsoleId.PS2, 'nada')).rejects.toThrow(/desconhecido/);
    await makeTree(tmp(), { 'meu/pcsx2.txt': 'x', 'meu/PCSX2 nightly/pcsx2-qtx64-avx2.exe': 'x' });
    await expect(service.setPath('pcsx2', path.join(tmp(), 'meu', 'pcsx2.txt'))).rejects.toThrow(/executável/);
    await makeTree(programs, { 'PCSX2/pcsx2-qt.exe': 'x' });
    const mine = path.join(tmp(), 'meu', 'PCSX2 nightly', 'pcsx2-qtx64-avx2.exe');
    const overview = await service.setPath('pcsx2', mine);
    expect(overview.emulators.find((e) => e.id === 'pcsx2')).toMatchObject({ configuredPath: mine, path: mine });
    // Arquivo indicado apagado: volta a valer o encontrado sozinho.
    await fs.rm(mine);
    expect((await service.overview()).emulators.find((e) => e.id === 'pcsx2')?.path).toBe(path.join(programs, 'PCSX2', 'pcsx2-qt.exe'));
  });

  it('jogo que não é ROM, ou console sem emulador próprio: sempre pelo caminho de antes', async () => {
    const { service } = setup();
    expect(await service.launchSpec({ ...rom(ConsoleId.PS2), kind: 'executable' } as Game)).toBeNull();
    expect(await service.launchSpec(rom(ConsoleId.SNES, 'C:\\R\\m.sfc'))).toBeNull();
  });
});

describe('GameCube e Wii pela assinatura do disco', () => {
  const tmp = useTempDir();

  it('.iso de GameCube (0x1C) e de Wii (0x18) viram o console certo', async () => {
    const gc = Buffer.alloc(64 * 1024);
    gc.writeUInt32BE(0xc2339f3d, 0x1c);
    const wii = Buffer.alloc(64 * 1024);
    wii.writeUInt32BE(0x5d1c9ea3, 0x18);
    await fs.writeFile(path.join(tmp(), 'gc.iso'), gc);
    await fs.writeFile(path.join(tmp(), 'wii.iso'), wii);
    expect(await detectConsole(path.join(tmp(), 'gc.iso'))).toBe(ConsoleId.GameCube);
    expect(await detectConsole(path.join(tmp(), 'wii.iso'))).toBe(ConsoleId.Wii);
    expect(await detectConsole(path.join(tmp(), 'x.gcm'))).toBe(ConsoleId.GameCube); // pela extensão
  });
});
