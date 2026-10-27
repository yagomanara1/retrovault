import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTree, useTempDir } from '../testing/tempDir';
import { parseArgs, pathExists, titleFromPath } from './fsUtils';

describe('pathExists', () => {
  const tmp = useTempDir();

  it('arquivo e pasta existem; caminho que não existe, não', async () => {
    await makeTree(tmp(), { 'pasta/arquivo.txt': 'oi' });
    expect(await pathExists(path.join(tmp(), 'pasta'))).toBe(true);
    expect(await pathExists(path.join(tmp(), 'pasta', 'arquivo.txt'))).toBe(true);
    expect(await pathExists(path.join(tmp(), 'nada'))).toBe(false);
    expect(await pathExists(path.join(tmp(), 'pasta', 'arquivo.txt', 'dentro'))).toBe(false);
  });
});

describe('parseArgs', () => {
  it('respeita aspas e espaços', () => {
    expect(parseArgs('-fullscreen "--profile=Meu Perfil" -g "C:\\Meus Jogos\\eboot.bin"')).toEqual([
      '-fullscreen',
      '--profile=Meu Perfil',
      '-g',
      'C:\\Meus Jogos\\eboot.bin',
    ]);
    expect(parseArgs(null)).toEqual([]);
    expect(parseArgs('   ')).toEqual([]);
  });
});

describe('titleFromPath', () => {
  it('remove extensão, tags de região e separadores', () => {
    expect(titleFromPath('Super Mario World (USA) [!].sfc')).toBe('Super Mario World');
    expect(titleFromPath('C:\\roms\\zelda_link.to.the.past.smc')).toBe('zelda link to the past');
    expect(titleFromPath('(Beta).sfc')).toBe('(Beta)'); // nada sobra: mantém o nome original
  });
});
