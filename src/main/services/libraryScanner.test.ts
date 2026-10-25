import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ConsoleId } from '@shared/consoles';
import { describe, expect, it } from 'vitest';
import { ps2Bin, psxBin } from '../testing/rcheevosImages';
import { makeTree, useTempDir } from '../testing/tempDir';
import {
  consoleFromFolders,
  isHelperExecutable,
  rankExecutables,
  scanLibraryFolder,
  titleForExecutable,
} from './libraryScanner';

describe('isHelperExecutable', () => {
  it.each(['unins000.exe', 'setup.exe', 'UnityCrashHandler64.exe', 'vc_redist.x64.exe', 'PKGInstall.exe', 'gow3-probe.exe', 'bb-gpu-capabilities.exe', 'bb-fg401-capabilities.exe', 'retroarch.exe', 'BEService_x64.exe', 'DXSETUP.exe'])(
    'exclui %s',
    (name) => expect(isHelperExecutable(name)).toBe(true),
  );

  it.each(['CrashBandicoot.exe', 'Bejeweled3.exe', 'God of War III.exe', 'Beyond.exe', 'main.exe', 'Reporter Simulator.exe'])(
    'mantém o jogo %s (regressão: padrões amplos demais escondiam jogos)',
    (name) => expect(isHelperExecutable(name)).toBe(false),
  );
});

describe('rankExecutables', () => {
  it('prefere o launcher ao "Play X.exe" e o nome parecido com o da pasta', () => {
    const ranked = rankExecutables(
      [
        { file: 'C:\\J\\bbport-windows\\Play Bloodborne.exe', size: 69_000 },
        { file: 'C:\\J\\bbport-windows\\Bloodborne.exe', size: 3_900_000 },
        { file: 'C:\\J\\bbport-windows\\tool.exe', size: 9_000_000 },
      ],
      ['Bloodborne', 'Bloodborne', 'bbport-windows'],
    );
    expect(ranked.map((e) => path.basename(e.file))).toEqual(['Bloodborne.exe', 'Play Bloodborne.exe', 'tool.exe']);
  });
});

describe('titleForExecutable', () => {
  it('usa o nome da pasta para executáveis genéricos, sem tratar ". 2" como extensão', () => {
    expect(titleForExecutable('C:\\Jogos\\Pokemon Platinum\\main.exe')).toBe('Pokemon Platinum');
    expect(titleForExecutable('C:\\Jogos\\Saga Vol. 2\\game.exe')).toBe('Saga Vol 2'); // e não "Saga Vol"
    expect(titleForExecutable('C:\\Jogos\\X\\God of War III.exe')).toBe('God of War III');
  });
});

describe('consoleFromFolders', () => {
  it('usa a pasta mais próxima e não confunde nomes genéricos', () => {
    expect(consoleFromFolders(['ROMs', 'PS1'])).toBe(ConsoleId.PlayStation);
    expect(consoleFromFolders(['SNES', 'Favoritos'])).toBe(ConsoleId.SNES);
    expect(consoleFromFolders(['Mega Drive'])).toBe(ConsoleId.Genesis);
    expect(consoleFromFolders(['Nintendo'])).toBeNull();
  });
});

describe('scanLibraryFolder', () => {
  const tmp = useTempDir();

  it('encontra jogos e ROMs e ignora o que não é jogo', async () => {
    await makeTree(tmp(), {
      'SNES/Chrono Trigger (USA).sfc': 'x',
      'PS1/Crash (USA).cue': 'x',
      'PS1/Crash (USA).bin': 'x',
      'PS1/FF7.m3u': 'x',
      'PS1/FF7 (Disc 1).cue': 'x',
      'PS1/FF7 (Disc 1).bin': 'x',
      'PS1/FF7 (Disc 2).cue': 'x',
      'PS1/Tekken.cue': 'x',
      'PS1/Tekken (Track 1).bin': 'x',
      'PS1/Tekken (Track 2).bin': 'x',
      'Diversos/data.bin': 'x',
      'Diversos/backup.iso': 'x',
      'Discos/Sem Console.chd': 'x',
      'PC/Meu Jogo/Meu Jogo.exe': 'x'.repeat(5000),
      'PC/Meu Jogo/unins000.exe': 'x',
      'PC/Meu Jogo/bin/ferramenta.exe': 'x',
      'PC/Instalador/setup.exe': 'x',
      'Emus/RetroArch/retroarch.exe': 'x',
      'Emus/RetroArch/roms/Mario.sfc': 'x',
      'PS4/CUSA00001/eboot.bin': 'x',
      'PS4/CUSA00001/sce_sys/param.sfo': 'x',
    });
    const library = new Set([path.join(tmp(), 'SNES/Chrono Trigger (USA).sfc').toLowerCase()]);
    const r = await scanLibraryFolder(tmp(), { libraryPaths: library });
    const byRel = Object.fromEntries(r.candidates.map((c) => [path.relative(tmp(), c.path).replace(/\\/g, '/'), c]));

    expect(Object.keys(byRel).sort()).toEqual([
      'Discos/Sem Console.chd',
      'PC/Meu Jogo/Meu Jogo.exe',
      'PS1/Crash (USA).cue',
      'PS1/FF7.m3u',
      'PS1/Tekken.cue',
      'SNES/Chrono Trigger (USA).sfc',
    ]);
    expect(byRel['PS1/FF7.m3u']).toMatchObject({ consoleId: ConsoleId.PlayStation, recommended: true });
    expect(byRel['Discos/Sem Console.chd']).toMatchObject({ consoleId: null, recommended: false });
    expect(byRel['SNES/Chrono Trigger (USA).sfc']).toMatchObject({ inLibrary: true, consoleId: ConsoleId.SNES });
    expect(byRel['PC/Meu Jogo/Meu Jogo.exe']).toMatchObject({ kind: 'executable', alternatives: [] });
  });

  it('imagem de disco solta, sem pista na pasta: o console sai do conteúdo; se não sair, fica de fora', async () => {
    await makeTree(tmp(), { 'Jogos/qualquer.iso': 'x', 'Jogos/data.bin': 'x' });
    await fs.writeFile(path.join(tmp(), 'Jogos', 'Meu Jogo.iso'), ps2Bin('SLUS_200.64', 0x8000));
    await fs.writeFile(path.join(tmp(), 'Jogos', 'Outro.bin'), psxBin('SLUS_007.45', 0x8000));
    const r = await scanLibraryFolder(tmp(), { libraryPaths: new Set() });
    const byName = Object.fromEntries(r.candidates.map((c) => [path.basename(c.path), c]));
    expect(Object.keys(byName).sort()).toEqual(['Meu Jogo.iso', 'Outro.bin']);
    expect(byName['Meu Jogo.iso']).toMatchObject({ consoleId: ConsoleId.PS2, recommended: true, note: 'Console reconhecido pelo conteúdo do disco' });
    expect(byName['Outro.bin']).toMatchObject({ consoleId: ConsoleId.PlayStation, recommended: true });
  });

  it('pode ser cancelado', async () => {
    await makeTree(tmp(), { 'a/b/c.sfc': 'x' });
    const controller = new AbortController();
    controller.abort();
    await expect(scanLibraryFolder(tmp(), { libraryPaths: new Set(), signal: controller.signal })).rejects.toThrow(/cancelada/);
  });

  it('pasta inexistente vira erro claro', async () => {
    await expect(scanLibraryFolder(path.join(tmp(), 'nada'), { libraryPaths: new Set() })).rejects.toThrow(/não encontrada/);
  });
});
