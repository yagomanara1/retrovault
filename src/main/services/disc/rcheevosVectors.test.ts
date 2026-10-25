// Prova contra a referência: as mesmas imagens sintéticas dos testes oficiais do rcheevos
// (test/hash/hash_data.c, test_rc_hash_disc.c e test_rc_hash_rom.c, licença MIT), portadas byte a byte,
// têm que dar exatamente os hashes que o rcheevos espera. Se um dia divergir, o RetroAchievements não
// reconheceria o jogo.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConsoleId } from '@shared/consoles';
import { useTempDir } from '../../testing/tempDir';
import { hashNds, hashRom } from '../romHasher';
import { genericFile, iso9660Bin, iso9660File, ndsFile, ps2Bin, psxBin } from '../../testing/rcheevosImages';
import { hashDisc } from './raDiscHash';

describe('vetores oficiais do rcheevos', () => {
  const tmp = useTempDir();
  const write = async (name: string, data: Buffer) => {
    const file = path.join(tmp(), name);
    await fs.writeFile(file, data);
    return file;
  };

  it('PS1 (test_hash_psx_cd)', async () => {
    expect(await hashDisc(await write('psx.bin', psxBin('SLUS_007.45', 0x07d800)), 'ps1')).toBe('db433fb038cde4fb15c144e8c7dea6e3');
  });

  it('PS1 sem SYSTEM.CNF (test_hash_psx_cd_no_system_cnf)', async () => {
    const size = 0x12000;
    const image = iso9660Bin(Math.floor((size + 2047) / 2048) + 20, 'HOMEBREW');
    const exe = iso9660File(image, 'PSX.EXE', null, size);
    image.write('PS-X EXE', exe, 'latin1');
    image.writeUInt32LE(size - 2048, exe + 28);
    expect(await hashDisc(await write('homebrew.bin', image), 'ps1')).toBe('e494c79a7315be0dc3e8571c45df162c');
  });

  it('PS1 com executável em subpasta e com barra extra (test_hash_psx_cd_exe_in_subfolder / extra_slash)', async () => {
    expect(await hashDisc(await write('sub.bin', psxBin('bin\\SCES_012.37', 0x07d800)), 'ps1')).toBe('674018e23a4052113665dfb264e9c2fc');
    expect(await hashDisc(await write('slash.bin', psxBin('\\SLUS_007.45', 0x07d800)), 'ps1')).toBe('db433fb038cde4fb15c144e8c7dea6e3');
  });

  it('PS2 (test_hash_ps2_iso) e disco de PS1 não gera hash de PS2 (test_hash_ps2_psx)', async () => {
    expect(await hashDisc(await write('ps2.iso', ps2Bin('SLUS_200.64', 0x07d800)), 'ps2')).toBe('01a517e4ad72c6c2654d1b839be7579d');
    expect(await hashDisc(await write('psx2.bin', psxBin('SLUS_007.45', 0x07d800)), 'ps2')).toBeNull();
  });

  it('PSP (test_hash_psp), disco de vídeo sem hash (test_hash_psp_video) e PBP (test_hash_psp_homebrew)', async () => {
    const game = iso9660Bin(160, 'TEST');
    iso9660File(game, 'PSP_GAME\\PARAM.SFO', genericFile(690), 690);
    iso9660File(game, 'PSP_GAME\\SYSDIR\\EBOOT.BIN', genericFile(273470), 273470);
    expect(await hashDisc(await write('psp.iso', game), 'psp')).toBe('27ec2f9b7238b2ef29af31ddd254f201');

    const video = iso9660Bin(160, 'TEST');
    iso9660File(video, 'PSP_GAME\\SYSDIR\\UPDATE\\EBOOT.BIN', genericFile(273470), 273470);
    iso9660File(video, 'UMD_VIDEO\\PARAM.SFO', genericFile(690), 690);
    expect(await hashDisc(await write('video.iso', video), 'psp')).toBeNull();

    const pbp = await write('EBOOT.PBP', genericFile(3532124));
    expect(await hashRom(pbp, ConsoleId.PSP)).toBe('fcde8760893b09e508e5f4fe642eb132');
  });

  it('Sega CD e Saturn (test_hash_sega_cd / test_hash_saturn / *_invalid_header)', async () => {
    const segaCd = genericFile(512);
    segaCd.write('SEGADISCSYSTEM  ', 0, 'latin1');
    const saturn = genericFile(512);
    saturn.write('SEGA SEGASATURN ', 0, 'latin1');
    expect(await hashDisc(await write('scd.bin', segaCd), 'sega-disc')).toBe('574498e1453cb8934df60c4ab906e783');
    expect(await hashDisc(await write('sat.bin', saturn), 'sega-disc')).toBe('4cd9c8e41cd8d137be15bbe6a93ae1d8');
    expect(await hashDisc(await write('nada.bin', genericFile(512)), 'sega-disc')).toBeNull();
  });

  it('Nintendo DS (test_hash_nds) e com cabeçalho do SuperCard (test_hash_nds_supercard)', () => {
    const rom = ndsFile(2, 1234567, 654321);
    expect(hashNds(rom)).toBe('56b30c276cba4affa886bd38e8e34d7e');
    const superCard = Buffer.alloc(512);
    superCard.set([0x2e, 0x00, 0x00, 0xea]);
    superCard.set([0x44, 0x46, 0x96, 0x00], 0xb0);
    expect(hashNds(Buffer.concat([superCard, rom]))).toBe('56b30c276cba4affa886bd38e8e34d7e');
  });
});
