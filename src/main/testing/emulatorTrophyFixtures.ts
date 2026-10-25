import path from 'node:path';
import { makeTree } from './tempDir';

// Utilitário só para testes: pastas de troféus do RPCS3 e do Vita3K com o mesmo layout dos emuladores.

export interface FixtureTrophy {
  id: number;
  grade: 'P' | 'G' | 'S' | 'B';
  name: string;
  hidden?: boolean;
}

const pad = (id: number) => String(id).padStart(3, '0');

/** TROPCONF.SFM (nomes em inglês, como no pacote). */
export function tropconf(title: string, trophies: readonly FixtureTrophy[]): string {
  const items = trophies
    .map((t) => `<trophy id="${pad(t.id)}" hidden="${t.hidden ? 'yes' : 'no'}" ttype="${t.grade}" pid="-1"><name>${t.name}</name><detail>EN ${t.name}</detail></trophy>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<trophyconf version="1.0"><npcommid>NPWR00000_00</npcommid><title-name>${title}</title-name>\n${items}\n</trophyconf>`;
}

/** TROP_17.SFM (português do Brasil). */
export function tropLocalized(title: string, trophies: readonly FixtureTrophy[]): string {
  const items = trophies.map((t) => `<trophy id="${pad(t.id)}"><name>PT ${t.name}</name><detail>Faça ${t.name}</detail></trophy>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<trophyconf version="1.0"><title-name>${title} (PT)</title-name>\n${items}\n</trophyconf>`;
}

/** Microssegundos desde o ano 1 (CellRtcTick do PS3) de uma data. */
export const rtcTick = (date: Date) => BigInt(date.getTime() + 62_135_596_800_000) * 1000n;

/**
 * TROPUSR.DAT do RPCS3, como o TROPUSRLoader::Generate grava: cabeçalho de 48 bytes, 2 tabelas
 * (tipo 4 com 96 bytes por troféu, tipo 6 com 112), tudo big-endian.
 */
export function rpcs3Tropusr(trophies: readonly FixtureTrophy[], unlocked: ReadonlyMap<number, Date | null> = new Map()): Buffer {
  const header = Buffer.alloc(48);
  header.writeUInt32BE(0x818f54ad, 0);
  header.writeUInt32BE(0x00010000, 4);
  header.writeUInt32BE(2, 8);
  const table4 = Buffer.alloc(trophies.length * 96);
  const table6 = Buffer.alloc(trophies.length * 112);
  trophies.forEach((t, i) => {
    const e4 = i * 96;
    table4.writeUInt32BE(4, e4);
    table4.writeUInt32BE(96 - 16, e4 + 4);
    table4.writeUInt32BE(i, e4 + 8);
    table4.writeUInt32BE(t.id, e4 + 16);
    table4.writeUInt32BE({ P: 1, G: 2, S: 3, B: 4 }[t.grade], e4 + 20);
    table4.writeInt32BE(-1, e4 + 24);
    const e6 = i * 112;
    table6.writeUInt32BE(6, e6);
    table6.writeUInt32BE(112 - 16, e6 + 4);
    table6.writeUInt32BE(i, e6 + 8);
    table6.writeUInt32BE(t.id, e6 + 16);
    if (unlocked.has(t.id)) {
      table6.writeUInt32BE(1, e6 + 20);
      const when = unlocked.get(t.id);
      const tick = when ? rtcTick(when) : 0n;
      table6.writeBigUInt64BE(tick, e6 + 32);
      table6.writeBigUInt64BE(tick, e6 + 40);
    }
  });
  const tables = Buffer.alloc(64);
  const offset4 = 48 + 64;
  const offset6 = offset4 + table4.length;
  for (const [i, type, size, offset] of [
    [0, 4, 96 - 16, offset4],
    [1, 6, 112 - 16, offset6],
  ] as const) {
    tables.writeUInt32BE(type, i * 32);
    tables.writeUInt32BE(size, i * 32 + 4);
    tables.writeUInt32BE(1, i * 32 + 8);
    tables.writeUInt32BE(trophies.length, i * 32 + 12);
    tables.writeBigUInt64BE(BigInt(offset), i * 32 + 16);
  }
  return Buffer.concat([header, tables, table4, table6]);
}

/** TROPUSR.DAT do Vita3K (context.cpp, save_trophy_progress_file). */
export function vita3kTropusr(trophies: readonly FixtureTrophy[], unlocked: ReadonlyMap<number, Date | null> = new Map()): Buffer {
  const out = Buffer.alloc(4 + 16 + 16 + 4 + 4 + 4 + 64 + 128 * 8 + 128 * 4);
  out.writeUInt32LE(0x12d5819a, 0);
  for (const [id, when] of unlocked) {
    out.writeUInt32LE((out.readUInt32LE(4 + (id >> 5) * 4) | (1 << (id & 31))) >>> 0, 4 + (id >> 5) * 4);
    if (when) out.writeBigUInt64LE(BigInt(Math.floor(when.getTime() / 1000)), 112 + id * 8);
  }
  out.writeUInt32LE(trophies.length, 4 + 16 + 16 + 4);
  return out;
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);

/** Pasta de troféus (TROPCONF, idioma, ícones) com o TROPUSR.DAT dado (ou nenhum). */
export function trophyFolderTree(rel: string, title: string, trophies: readonly FixtureTrophy[], progress: Buffer | null, progressRel?: string) {
  const tree: Record<string, string | Buffer | null> = {
    [`${rel}/TROPCONF.SFM`]: tropconf(title, trophies),
    [`${rel}/TROP_17.SFM`]: tropLocalized(title, trophies),
    [`${rel}/ICON0.PNG`]: PNG,
  };
  for (const t of trophies) tree[`${rel}/TROP${pad(t.id)}.PNG`] = PNG;
  if (progress) tree[progressRel ?? `${rel}/TROPUSR.DAT`] = progress;
  return tree;
}

/** RPCS3 instalado em `root` com um jogo de disco em `gameDir` (PS3_GAME\TROPDIR\<npwr>). */
export async function makeRpcs3(root: string, gameDir: string, npwr: string, title: string, trophies: readonly FixtureTrophy[], progress: Buffer | null) {
  await makeTree(root, {
    'rpcs3.exe': 'x',
    ...trophyFolderTree(`dev_hdd0/home/00000001/trophy/${npwr}`, title, trophies, progress),
  });
  await makeTree(gameDir, {
    'PS3_GAME/USRDIR/EBOOT.BIN': 'x',
    [`PS3_GAME/TROPDIR/${npwr}/TROPHY.TRP`]: 'x',
  });
  return { exe: path.join(root, 'rpcs3.exe'), eboot: path.join(gameDir, 'PS3_GAME', 'USRDIR', 'EBOOT.BIN') };
}

/** Vita3K com a pasta de dados em `pref` e o jogo `titleId` instalado. */
export async function makeVita3k(pref: string, titleId: string, npwr: string, title: string, trophies: readonly FixtureTrophy[], progress: Buffer | null) {
  await makeTree(pref, {
    [`ux0/app/${titleId}/sce_sys/trophy/${npwr}/TROPHY.TRP`]: 'x',
    ...trophyFolderTree(`ux0/user/00/trophy/conf/${npwr}`, title, trophies, progress, `ux0/user/00/trophy/data/${npwr}/TROPUSR.DAT`),
  });
}
