// KeyValues binário da Valve (shortcuts.vdf). Cada item é: tipo (1 byte), chave (UTF-8 terminada em 0), valor.
// Lido e regravado preservando tudo o que a Steam escreveu, inclusive campos que o RetroVault não conhece:
// quem chama confere que serialize(parse(arquivo)) devolve exatamente o arquivo antes de gravar qualquer coisa.

export type BinNode =
  | { type: 'map'; key: string; children: BinNode[] }
  | { type: 'string'; key: string; value: string }
  /** Guardado como os 32 bits sem sinal (ids de atalho usam o bit alto). */
  | { type: 'int32'; key: string; value: number }
  /** Tipos de tamanho fixo que o RetroVault só copia (float, ponteiro, cor, inteiros de 64 bits). */
  | { type: 'raw'; key: string; tag: number; bytes: Buffer };

const MAP = 0x00;
const STRING = 0x01;
const INT32 = 0x02;
const END = 0x08;
/** Tamanho dos tipos que só são copiados. */
const FIXED: Record<number, number> = { 0x03: 4, 0x04: 4, 0x06: 4, 0x07: 8, 0x0a: 8 };

export class BinaryVdfError extends Error {}

/** Lê os itens da raiz. Formato desconhecido (ex.: texto UTF-16) é erro: melhor não gravar do que corromper. */
export function parseBinaryVdf(buf: Buffer): BinNode[] {
  let i = 0;
  const cstring = (): string => {
    const end = buf.indexOf(0, i);
    if (end < 0) throw new BinaryVdfError('texto sem terminação');
    const s = buf.subarray(i, end).toString('utf8');
    i = end + 1;
    return s;
  };
  const readList = (nested: boolean): BinNode[] => {
    const nodes: BinNode[] = [];
    while (i < buf.length) {
      const tag = buf[i++]!;
      if (tag === END) return nodes;
      const key = cstring();
      if (tag === MAP) nodes.push({ type: 'map', key, children: readList(true) });
      else if (tag === STRING) nodes.push({ type: 'string', key, value: cstring() });
      else if (tag === INT32) {
        if (i + 4 > buf.length) throw new BinaryVdfError('número cortado');
        nodes.push({ type: 'int32', key, value: buf.readUInt32LE(i) });
        i += 4;
      } else if (FIXED[tag]) {
        const size = FIXED[tag]!;
        if (i + size > buf.length) throw new BinaryVdfError('valor cortado');
        nodes.push({ type: 'raw', key, tag, bytes: Buffer.from(buf.subarray(i, i + size)) });
        i += size;
      } else throw new BinaryVdfError(`tipo desconhecido 0x${tag.toString(16)}`);
    }
    if (nested) throw new BinaryVdfError('bloco sem fechamento');
    return nodes;
  };
  const root = readList(false);
  if (i !== buf.length) throw new BinaryVdfError('sobrou conteúdo depois do fim');
  return root;
}

export function serializeBinaryVdf(root: readonly BinNode[]): Buffer {
  const parts: Buffer[] = [];
  const cstring = (s: string) => parts.push(Buffer.from(s, 'utf8'), Buffer.from([0]));
  const writeList = (nodes: readonly BinNode[]) => {
    for (const n of nodes) {
      switch (n.type) {
        case 'map':
          parts.push(Buffer.from([MAP]));
          cstring(n.key);
          writeList(n.children);
          break;
        case 'string':
          parts.push(Buffer.from([STRING]));
          cstring(n.key);
          cstring(n.value);
          break;
        case 'int32': {
          parts.push(Buffer.from([INT32]));
          cstring(n.key);
          const b = Buffer.alloc(4);
          b.writeUInt32LE(n.value >>> 0);
          parts.push(b);
          break;
        }
        case 'raw':
          parts.push(Buffer.from([n.tag]));
          cstring(n.key);
          parts.push(n.bytes);
          break;
      }
    }
    parts.push(Buffer.from([END]));
  };
  writeList(root);
  return Buffer.concat(parts);
}

/** Item filho pela chave, sem diferenciar maiúsculas (a Steam grava "AppName", ferramentas antigas "appname"). */
export function binChild(node: BinNode | undefined, key: string): BinNode | undefined {
  if (!node || node.type !== 'map') return undefined;
  const lower = key.toLowerCase();
  return node.children.find((c) => c.key.toLowerCase() === lower);
}

export function binString(node: BinNode | undefined, key: string): string | undefined {
  const c = binChild(node, key);
  return c?.type === 'string' ? c.value : undefined;
}

export function binInt(node: BinNode | undefined, key: string): number | undefined {
  const c = binChild(node, key);
  return c?.type === 'int32' ? c.value : undefined;
}
