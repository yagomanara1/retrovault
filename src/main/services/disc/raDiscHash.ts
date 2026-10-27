// Hashes de jogos de disco no formato do RetroAchievements (o mesmo do rcheevos, usado pelo RetroArch).
// Algoritmos da documentação pública "Game Identification" do RetroAchievements e do rcheevos (MIT);
// a ideia de trazê-los para o launcher veio do Taiga Launcher, de Taiga (GabrielTaiga, Apache-2.0).
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ConsoleId } from '@shared/consoles';
import { md5Range } from '../fileHash';
import { openDiscImage, type DiscImage } from './discImage';
import { findDiscFile, readDiscFile, type DiscFile } from './iso9660';

/** O rcheevos lê no máximo 64 MB de cada arquivo. */
const MAX_HASH_BYTES = 64 * 1024 * 1024;

export type DiscHashMethod = 'ps1' | 'ps2' | 'psp' | 'sega-disc';

/**
 * Executável de PS1/PS2 apontado pelo SYSTEM.CNF (ex.: `BOOT2 = cdrom0:\SLUS_203.12;1` → `SLUS_203.12`).
 * Exatamente como o rcheevos (rc_hash_find_playstation_executable): a chave no começo da linha, o prefixo
 * com as mesmas maiúsculas, sem as barras iniciais e sem a versão ";1". Qualquer tolerância a mais daria
 * um hash que o RetroAchievements não tem.
 */
export function bootExecutable(systemCnf: string, key: 'BOOT' | 'BOOT2', prefix: 'cdrom:' | 'cdrom0:'): string | null {
  for (const line of systemCnf.split('\n')) {
    if (!line.startsWith(key)) continue;
    let rest = line.slice(key.length).trimStart();
    if (!rest.startsWith('=')) continue; // "BOOT2 = ..." não vale como "BOOT"
    rest = rest.slice(1).trimStart();
    if (rest.startsWith(prefix)) rest = rest.slice(prefix.length);
    rest = rest.replace(/^\\+/, '');
    return rest.match(/^[^\s;]*/)![0].slice(0, 63); // o rcheevos guarda até 63 caracteres
  }
  return null;
}

async function systemCnf(disc: DiscImage): Promise<string | null> {
  const file = await findDiscFile(disc, 'SYSTEM.CNF');
  return file ? (await readDiscFile(disc, file, 2048)).toString('latin1') : null;
}

/** Cabeçalho do setor 0 dos discos da Sega (16 primeiros caracteres). */
async function segaHeader(disc: DiscImage): Promise<string> {
  return (await disc.readSectors(0, 1)).toString('latin1', 0, 16);
}

async function hashPlayStation(disc: DiscImage, method: 'ps1' | 'ps2'): Promise<string | null> {
  const cnf = await systemCnf(disc);
  let name = cnf ? bootExecutable(cnf, method === 'ps1' ? 'BOOT' : 'BOOT2', method === 'ps1' ? 'cdrom:' : 'cdrom0:') : null;
  let file: DiscFile | null = name ? await findDiscFile(disc, name) : null;
  if (!file && method === 'ps1') {
    // Sem SYSTEM.CNF (discos antigos) ou com o executável dele ausente: o executável padrão.
    name = 'PSX.EXE';
    file = await findDiscFile(disc, name);
  }
  if (!name || !file) return null;
  let size = file.size;
  if (method === 'ps1') {
    // O tamanho do "PS-X EXE" vem no cabeçalho (byte 28) e não conta o cabeçalho de 2048 bytes.
    const head = await readDiscFile(disc, file, 2048);
    if (head.toString('latin1', 0, 8) === 'PS-X EXE') size = head.readUInt32LE(28) + 2048;
  }
  const data = await readDiscFile(disc, { ...file, size }, MAX_HASH_BYTES);
  return createHash('md5').update(name, 'latin1').update(data).digest('hex');
}

async function hashPsp(disc: DiscImage): Promise<string | null> {
  const sfo = await findDiscFile(disc, 'PSP_GAME\\PARAM.SFO');
  const eboot = await findDiscFile(disc, 'PSP_GAME\\SYSDIR\\EBOOT.BIN');
  if (!sfo || !eboot) return null;
  return createHash('md5')
    .update(await readDiscFile(disc, sfo, MAX_HASH_BYTES))
    .update(await readDiscFile(disc, eboot, MAX_HASH_BYTES))
    .digest('hex');
}

async function hashSegaDisc(disc: DiscImage): Promise<string | null> {
  const sector = await disc.readSectors(0, 1);
  const header = sector.toString('latin1', 0, 16);
  if (header !== 'SEGADISCSYSTEM  ' && header !== 'SEGA SEGASATURN ') return null;
  return createHash('md5').update(sector.subarray(0, 512)).digest('hex');
}

/** Hash RetroAchievements de uma imagem de disco; null se o disco não tiver o que o método procura. */
export async function hashDisc(file: string, method: DiscHashMethod): Promise<string | null> {
  if (method === 'psp' && path.extname(file).toLowerCase() === '.pbp') {
    // Pacote PBP do PSP: o rcheevos usa o arquivo inteiro (até 64 MB), lido aqui em pedaços.
    const handle = await fs.open(file, 'r');
    try {
      return await md5Range(handle, 0, Math.min((await handle.stat()).size, MAX_HASH_BYTES));
    } finally {
      await handle.close();
    }
  }
  const disc = await openDiscImage(file);
  try {
    if (method === 'psp') return await hashPsp(disc);
    if (method === 'sega-disc') return await hashSegaDisc(disc);
    return await hashPlayStation(disc, method);
  } finally {
    await disc.close();
  }
}

/**
 * Console de uma imagem de disco pelo conteúdo (um .iso/.cue não diz de qual console é).
 * null se não reconhecer ou se o arquivo não abrir.
 */
export async function detectDiscConsole(file: string): Promise<number | null> {
  let disc: DiscImage;
  try {
    disc = await openDiscImage(file);
  } catch {
    return null;
  }
  try {
    // GameCube e Wii: palavra mágica no cabeçalho do disco (0x1C e 0x18), antes de qualquer sistema de arquivos.
    const first = await disc.readSectors(0, 1);
    if (first.length >= 0x20 && first.readUInt32BE(0x1c) === 0xc2339f3d) return ConsoleId.GameCube;
    if (first.length >= 0x20 && first.readUInt32BE(0x18) === 0x5d1c9ea3) return ConsoleId.Wii;
    const header = await segaHeader(disc);
    if (header === 'SEGADISCSYSTEM  ') return ConsoleId.SegaCD;
    if (header === 'SEGA SEGASATURN ') return ConsoleId.Saturn;
    if (await findDiscFile(disc, 'PSP_GAME\\PARAM.SFO')) return ConsoleId.PSP;
    const cnf = await systemCnf(disc);
    if (cnf && bootExecutable(cnf, 'BOOT2', 'cdrom0:')) return ConsoleId.PS2;
    if ((cnf && bootExecutable(cnf, 'BOOT', 'cdrom:')) || (await findDiscFile(disc, 'PSX.EXE'))) return ConsoleId.PlayStation;
    return null;
  } catch {
    return null; // não é ISO 9660 (ex.: disco de áudio) ou imagem corrompida
  } finally {
    await disc.close();
  }
}
