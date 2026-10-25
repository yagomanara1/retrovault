import { describe, expect, it } from 'vitest';
import { parseArgs, titleFromPath } from './fsUtils';

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
