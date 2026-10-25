import { createCipheriv } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptEsfm, parseTrophyXml, readTrophyPackage, readTrpEntries } from './trp';

// Chave e NPCommID inventados: o teste exercita a mesma criptografia do PS4 sem nenhuma chave real.
const KEY = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
const NP = 'NPWR99999_00';
const LANGS = ['TROP_17', 'TROP'] as const;

const TROPCONF = `<!--assinatura-->
<trophyconf version="1.1" platform="ps4">
 <npcommid>${NP}</npcommid>
 <title-name>Jogo de Teste</title-name>
 <trophy id="000" hidden="no" ttype="P" pid="-1"/>
 <trophy id="001" hidden="yes" ttype="B" pid="000"/>
 <trophy id="002" hidden="no" ttype="G" pid="000"/>
</trophyconf>`;

const TROP_17 = `<trophyconf>
 <title-name>Jogo de Teste (PT)</title-name>
 <trophy id="000" hidden="no" ttype="P"><name>Platina &amp; Glória</name><detail>Tudo</detail></trophy>
 <trophy id="001" hidden="yes" ttype="B"><name><![CDATA[Oculto <1>]]></name><detail>Segredo</detail></trophy>
 <trophy id="002" hidden="no" ttype="G"><name>Ouro &#233;pico</name><detail>Difícil</detail></trophy>
</trophyconf>`;

function encryptEsfm(xml: string, key = KEY, np = NP): Buffer {
  const npBuf = Buffer.alloc(16);
  npBuf.write(np, 'latin1');
  const k = createCipheriv('aes-128-cbc', key, Buffer.alloc(16)).setAutoPadding(false);
  const trpKey = Buffer.concat([k.update(npBuf), k.final()]);
  const iv = Buffer.from('0102030405060708090a0b0c0d0e0f10', 'hex');
  const plain = Buffer.from(xml, 'utf8');
  const padded = Buffer.concat([plain, Buffer.alloc((16 - (plain.length % 16)) % 16)]);
  const c = createCipheriv('aes-128-cbc', trpKey, iv).setAutoPadding(false);
  return Buffer.concat([iv, c.update(padded), c.final()]);
}

/** Monta um trophy00.trp: cabeçalho 0x60, entradas de 64 bytes (nome, offset e tamanho big-endian). */
function buildTrp(files: Record<string, Buffer>): Buffer {
  const names = Object.keys(files);
  const entrySize = 64;
  let offset = 0x60 + names.length * entrySize;
  const header = Buffer.alloc(0x60);
  header.writeUInt32BE(0xdca24d00, 0);
  header.writeUInt32BE(names.length, 16);
  header.writeUInt32BE(entrySize, 20);
  const table = Buffer.alloc(names.length * entrySize);
  const bodies: Buffer[] = [];
  names.forEach((name, i) => {
    const at = i * entrySize;
    table.write(name, at, 32, 'latin1');
    table.writeBigUInt64BE(BigInt(offset), at + 32);
    table.writeBigUInt64BE(BigInt(files[name]!.length), at + 40);
    bodies.push(files[name]!);
    offset += files[name]!.length;
  });
  return Buffer.concat([header, table, ...bodies]);
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe('parseTrophyXml', () => {
  it('lê tags autofechadas do TROPCONF (regressão: a lista base saía vazia)', () => {
    const { trophies, title } = parseTrophyXml(TROPCONF);
    expect(title).toBe('Jogo de Teste');
    expect(trophies.map((t) => [t.id, t.grade, t.hidden])).toEqual([
      [0, 'P', false],
      [1, 'B', true],
      [2, 'G', false],
    ]);
    expect(trophies[0]!.name).toBe('Troféu 0'); // sem nome no TROPCONF: nome provisório
  });

  it('lê elementos completos com entidades e CDATA', () => {
    const { trophies } = parseTrophyXml(TROP_17);
    expect(trophies.map((t) => t.name)).toEqual(['Platina & Glória', 'Oculto <1>', 'Ouro épico']);
    expect(trophies[2]!.detail).toBe('Difícil');
  });

  it('aceita as duas formas misturadas e ignora ids inválidos', () => {
    const { trophies } = parseTrophyXml('<trophy id="5" ttype="S"/><trophy id="x"/><trophy id="6"><name>N</name></trophy>');
    expect(trophies.map((t) => [t.id, t.grade, t.name])).toEqual([
      [5, 'S', 'Troféu 5'],
      [6, 'B', 'N'],
    ]);
  });
});

describe('readTrpEntries', () => {
  it('rejeita arquivos sem a assinatura do .trp', () => {
    expect(() => readTrpEntries(Buffer.alloc(0x100))).toThrow(/inválido/);
  });

  it('rejeita entradas que apontam para fora do arquivo', () => {
    const trp = buildTrp({ 'A.PNG': PNG });
    trp.writeBigUInt64BE(BigInt(trp.length + 10), 0x60 + 40);
    expect(() => readTrpEntries(trp)).toThrow(/inválido/);
  });
});

describe('decryptEsfm', () => {
  it('decifra o XML e descarta o padding após o último ">"', () => {
    const xml = decryptEsfm(encryptEsfm(TROPCONF), KEY, NP).toString('utf8');
    expect(xml).toBe(TROPCONF);
  });
});

describe('readTrophyPackage', () => {
  it('pacote em texto (.SFM) não precisa de chave', () => {
    const trp = buildTrp({ 'TROPCONF.SFM': Buffer.from(TROPCONF), 'TROP.SFM': Buffer.from(TROP_17), 'TROP001.PNG': PNG });
    const pkg = readTrophyPackage(trp, null, null, LANGS);
    expect(pkg.trophies).toHaveLength(3);
    expect(pkg.trophies[0]!.name).toBe('Platina & Glória');
    expect(pkg.images.get('TROP001.PNG')).toEqual(PNG);
  });

  it('pacote criptografado: nomes vêm do idioma preferido (TROP_17 = pt-BR)', () => {
    const trp = buildTrp({
      'TROPCONF.ESFM': encryptEsfm(TROPCONF),
      'TROP.ESFM': encryptEsfm(TROP_17.replace('Platina &amp; Glória', 'Platinum')),
      'TROP_17.ESFM': encryptEsfm(TROP_17),
    });
    const pkg = readTrophyPackage(trp, KEY, NP, LANGS);
    expect(pkg.title).toBe('Jogo de Teste (PT)');
    expect(pkg.trophies.map((t) => t.name)).toEqual(['Platina & Glória', 'Oculto <1>', 'Ouro épico']);
    expect(pkg.trophies.map((t) => t.grade)).toEqual(['P', 'B', 'G']); // grau sempre do TROPCONF
  });

  it('sem chave: TROPHY_KEY_MISSING', () => {
    const trp = buildTrp({ 'TROPCONF.ESFM': encryptEsfm(TROPCONF) });
    expect(() => readTrophyPackage(trp, null, NP, LANGS)).toThrow(expect.objectContaining({ code: 'TROPHY_KEY_MISSING' }));
  });

  it('chave errada: TROPHY_KEY_INVALID', () => {
    const trp = buildTrp({ 'TROPCONF.ESFM': encryptEsfm(TROPCONF) });
    const wrong = Buffer.alloc(16, 7);
    expect(() => readTrophyPackage(trp, wrong, NP, LANGS)).toThrow(expect.objectContaining({ code: 'TROPHY_KEY_INVALID' }));
  });

  it('sem NPCommID (npbind.dat ausente): erro de validação', () => {
    const trp = buildTrp({ 'TROPCONF.ESFM': encryptEsfm(TROPCONF) });
    expect(() => readTrophyPackage(trp, KEY, null, LANGS)).toThrow(/NPCommID/);
  });
});
