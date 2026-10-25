import { createCipheriv, createDecipheriv } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { TrophyGrade } from '@shared/types';
import { AppError } from '../../errors';

// Leitor do pacote de troféus do PS4 (sce_sys/trophy/trophy00.trp).
// Formato e criptografia equivalentes ao shadPS4 (src/core/file_format/trp.cpp):
//   trpKey = AES-128-CBC(key = trophy key, iv = 0)(NPCommID com padding de zeros até 16 bytes)
//   XML    = AES-128-CBC(key = trpKey, iv = 16 primeiros bytes da entrada)(restante da entrada)

const TRP_MAGIC = 0xdca24d00;
const HEADER_SIZE = 0x60;
const MAX_ENTRIES = 4096;

export interface TrpEntry {
  name: string;
  offset: number;
  size: number;
}

export interface ParsedTrophy {
  id: number;
  hidden: boolean;
  grade: TrophyGrade;
  name: string;
  detail: string;
}

export interface TrophyPackage {
  title: string | null;
  trophies: ParsedTrophy[];
  /** PNGs do pacote por nome (ICON0.PNG, TROP000.PNG, …). */
  images: Map<string, Buffer>;
}

export function readTrpEntries(data: Buffer): TrpEntry[] {
  const invalid = () => new AppError('VALIDATION', 'Arquivo .trp inválido ou corrompido.');
  if (data.length < HEADER_SIZE || data.readUInt32BE(0) !== TRP_MAGIC) throw invalid();
  const count = data.readUInt32BE(16);
  const entrySize = data.readUInt32BE(20);
  if (count > MAX_ENTRIES || entrySize < 52) throw invalid();

  const entries: TrpEntry[] = [];
  for (let i = 0; i < count; i++) {
    const at = HEADER_SIZE + i * entrySize;
    if (at + 48 > data.length) throw invalid();
    const name = data.subarray(at, at + 32).toString('latin1').replace(/\0.*$/s, '');
    const offset = Number(data.readBigUInt64BE(at + 32));
    const size = Number(data.readBigUInt64BE(at + 40));
    if (offset + size > data.length) throw invalid();
    entries.push({ name: name.toUpperCase(), offset, size });
  }
  return entries;
}

export function decryptEsfm(entry: Buffer, trophyKey: Buffer, npCommId: string): Buffer {
  if (entry.length <= 32) throw new AppError('VALIDATION', 'Entrada criptografada do .trp é pequena demais.');

  const np = Buffer.alloc(16);
  np.write(npCommId.slice(0, 16), 'latin1');
  const keyCipher = createCipheriv('aes-128-cbc', trophyKey, Buffer.alloc(16)).setAutoPadding(false);
  const trpKey = Buffer.concat([keyCipher.update(np), keyCipher.final()]);

  const iv = entry.subarray(0, 16);
  const body = entry.subarray(16, 16 + Math.floor((entry.length - 16) / 16) * 16);
  const decipher = createDecipheriv('aes-128-cbc', trpKey, iv).setAutoPadding(false);
  const xml = Buffer.concat([decipher.update(body), decipher.final()]);

  // Igual ao shadPS4: descarta o padding após o último '>'.
  const end = xml.lastIndexOf(0x3e);
  return end >= 0 ? xml.subarray(0, end + 1) : xml;
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, code: string) => {
      if (code[0] === '#') {
        const n = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : match;
      }
      return XML_ENTITIES[code.toLowerCase()] ?? match;
    })
    .trim();
}

const tag = (xml: string, name: string) => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? decodeXml(m[1]!) : null;
};
const attr = (attrs: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1] ?? null;

export function parseTrophyXml(xml: string): { title: string | null; trophies: ParsedTrophy[] } {
  const trophies: ParsedTrophy[] = [];
  // TROPCONF usa tags autofechadas (<trophy id="000" ttype="P"/>); os arquivos de idioma
  // (TROP, TROP_17…) usam <trophy …><name>…</name><detail>…</detail></trophy>.
  for (const match of xml.matchAll(/<trophy\b([^>]*?)(?:\/>|>([\s\S]*?)<\/trophy>)/g)) {
    const [, attrs = '', body = ''] = match;
    const id = Number(attr(attrs, 'id'));
    if (!Number.isInteger(id)) continue;
    const ttype = attr(attrs, 'ttype');
    trophies.push({
      id,
      hidden: attr(attrs, 'hidden') === 'yes',
      grade: ttype === 'P' || ttype === 'G' || ttype === 'S' ? ttype : 'B',
      name: tag(body, 'name') ?? `Troféu ${id}`,
      detail: tag(body, 'detail') ?? '',
    });
  }
  return { title: tag(xml, 'title-name'), trophies };
}

/** O NPCommID (NPWRxxxxx_xx) fica em sce_sys/npbind.dat, uma pasta acima de sce_sys/trophy. */
export async function findNpCommId(trpPath: string): Promise<string | null> {
  const dir = path.dirname(trpPath);
  for (const candidate of [path.join(dir, '..', 'npbind.dat'), path.join(dir, 'npbind.dat')]) {
    try {
      const text = (await fs.readFile(candidate)).toString('latin1');
      const match = /NPWR\d{5}_\d{2}/.exec(text);
      if (match) return match[0];
    } catch {
      // tenta o próximo
    }
  }
  return null;
}

/**
 * Lê um pacote de troféus. As entradas .SFM vêm em texto puro; as .ESFM exigem a trophy key.
 * @param languages arquivos de idioma por prioridade (ex.: TROP_17 = Português do Brasil).
 */
export function readTrophyPackage(
  data: Buffer,
  trophyKey: Buffer | null,
  npCommId: string | null,
  languages: readonly string[],
): TrophyPackage {
  const entries = readTrpEntries(data);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const raw = (e: TrpEntry) => data.subarray(e.offset, e.offset + e.size);

  const readXml = (base: string): string | null => {
    const plain = byName.get(`${base}.SFM`);
    if (plain) return raw(plain).toString('utf8');
    const encrypted = byName.get(`${base}.ESFM`);
    if (!encrypted) return null;
    if (!trophyKey) {
      throw new AppError('TROPHY_KEY_MISSING', 'Este pacote é criptografado. Informe sua trophy key do PS4 em Configurações.');
    }
    if (!npCommId) {
      throw new AppError('VALIDATION', 'NPCommID não encontrado (sce_sys/npbind.dat). Selecione o .trp dentro do dump do jogo.');
    }
    return decryptEsfm(raw(encrypted), trophyKey, npCommId).toString('utf8');
  };

  const conf = readXml('TROPCONF');
  if (!conf) throw new AppError('VALIDATION', 'O pacote não contém TROPCONF (lista de troféus).');
  if (!/<trophyconf/i.test(conf)) {
    throw new AppError('TROPHY_KEY_INVALID', 'A trophy key não conseguiu decifrar este pacote. Confira a chave em Configurações.');
  }
  const confParsed = parseTrophyXml(conf);

  let localized: ReturnType<typeof parseTrophyXml> | null = null;
  for (const lang of languages) {
    const xml = readXml(lang);
    if (xml && /<trophy\b/.test(xml)) {
      localized = parseTrophyXml(xml);
      break;
    }
  }

  const names = new Map((localized?.trophies ?? []).map((t) => [t.id, t]));
  const trophies = confParsed.trophies.map((t) => {
    const text = names.get(t.id);
    return { ...t, name: text?.name ?? t.name, detail: text?.detail ?? t.detail };
  });

  const images = new Map<string, Buffer>();
  for (const e of entries) {
    if (e.name.endsWith('.PNG')) images.set(e.name, Buffer.from(raw(e)));
  }

  return { title: localized?.title ?? confParsed.title, trophies, images };
}
