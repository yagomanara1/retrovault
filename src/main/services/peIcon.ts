import { promises as fs } from 'node:fs';

// Extrai o maior ícone embutido em um executável Windows (PE) lendo a seção de recursos.
// app.getFileIcon() do Electron retorna no máximo 32×32 no Windows; aqui obtemos até 256×256.

const RT_ICON = 3;
const RT_GROUP_ICON = 14;
const MAX_RESOURCE_BYTES = 64 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface ExtractedIcon {
  data: Buffer;
  /** Ícones 256px costumam vir como PNG; os demais como DIB, embrulhados aqui em um .ico. */
  format: 'png' | 'ico';
  size: number;
}

interface Section {
  va: number;
  vsize: number;
  rawSize: number;
  rawPtr: number;
}

interface DirEntry {
  id: number | null;
  isDir: boolean;
  offset: number;
}

interface IconCandidate {
  width: number;
  height: number;
  colors: number;
  planes: number;
  bitCount: number;
  id: number;
}

export async function extractLargestIcon(exePath: string): Promise<ExtractedIcon | null> {
  const fh = await fs.open(exePath, 'r');
  // Lê só os trechos necessários: executáveis de jogos podem ter centenas de MB.
  const read = async (position: number, length: number): Promise<Buffer> => {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buffer, 0, length, position);
    return buffer.subarray(0, bytesRead);
  };

  try {
    const dos = await read(0, 64);
    if (dos.length < 64 || dos.readUInt16LE(0) !== 0x5a4d) return null; // "MZ"
    const peOffset = dos.readUInt32LE(0x3c);

    const coff = await read(peOffset, 24);
    if (coff.length < 24 || coff.readUInt32LE(0) !== 0x00004550) return null; // "PE\0\0"
    const sectionCount = coff.readUInt16LE(6);
    const optionalSize = coff.readUInt16LE(20);

    const optional = await read(peOffset + 24, optionalSize);
    if (optional.length < optionalSize) return null;
    const magic = optional.readUInt16LE(0);
    const dataDirs = magic === 0x20b ? 112 : magic === 0x10b ? 96 : -1; // PE32+ / PE32
    if (dataDirs < 0 || dataDirs + 24 > optional.length) return null;
    const resRva = optional.readUInt32LE(dataDirs + 16); // diretório 2 = recursos
    const resSize = optional.readUInt32LE(dataDirs + 20);
    if (!resRva || !resSize || resSize > MAX_RESOURCE_BYTES) return null;

    const table = await read(peOffset + 24 + optionalSize, sectionCount * 40);
    const sections: Section[] = [];
    for (let i = 0; i + 40 <= table.length; i += 40) {
      sections.push({
        vsize: table.readUInt32LE(i + 8),
        va: table.readUInt32LE(i + 12),
        rawSize: table.readUInt32LE(i + 16),
        rawPtr: table.readUInt32LE(i + 20),
      });
    }
    const rvaToOffset = (rva: number): number | null => {
      for (const s of sections) {
        if (rva >= s.va && rva < s.va + Math.max(s.vsize, s.rawSize)) return rva - s.va + s.rawPtr;
      }
      return null;
    };

    const resOffset = rvaToOffset(resRva);
    if (resOffset == null) return null;
    const res = await read(resOffset, resSize);

    const entries = (offset: number): DirEntry[] => {
      if (offset + 16 > res.length) return [];
      const count = res.readUInt16LE(offset + 12) + res.readUInt16LE(offset + 14);
      const list: DirEntry[] = [];
      for (let i = 0; i < count; i++) {
        const at = offset + 16 + i * 8;
        if (at + 8 > res.length) break;
        const name = res.readUInt32LE(at);
        const target = res.readUInt32LE(at + 4);
        list.push({
          id: name >= 0x80000000 ? null : name,
          isDir: target >= 0x80000000,
          offset: target & 0x7fffffff,
        });
      }
      return list;
    };

    // Desce pelos níveis (nome → idioma) até o primeiro IMAGE_RESOURCE_DATA_ENTRY.
    const firstLeaf = (entry: DirEntry): number | null => {
      let current: DirEntry | undefined = entry;
      for (let depth = 0; current?.isDir && depth < 4; depth++) current = entries(current.offset)[0];
      return current && !current.isDir ? current.offset : null;
    };

    const readLeaf = async (leaf: number): Promise<Buffer | null> => {
      if (leaf + 8 > res.length) return null;
      const rva = res.readUInt32LE(leaf);
      const size = res.readUInt32LE(leaf + 4);
      if (!size || size > MAX_RESOURCE_BYTES) return null;
      const local = rva - resRva;
      if (local >= 0 && local + size <= res.length) return res.subarray(local, local + size);
      const offset = rvaToOffset(rva);
      return offset == null ? null : read(offset, size);
    };

    const root = entries(0);
    const groupType = root.find((e) => e.id === RT_GROUP_ICON && e.isDir);
    const iconType = root.find((e) => e.id === RT_ICON && e.isDir);
    if (!groupType || !iconType) return null;

    // O primeiro grupo é o ícone principal (o mesmo que o Explorer mostra).
    const firstGroup = entries(groupType.offset)[0];
    const groupLeaf = firstGroup ? firstLeaf(firstGroup) : null;
    const group = groupLeaf == null ? null : await readLeaf(groupLeaf);
    if (!group || group.length < 6) return null;

    let best: IconCandidate | null = null;
    const count = group.readUInt16LE(4);
    for (let i = 0; i < count; i++) {
      const at = 6 + i * 14;
      if (at + 14 > group.length) break;
      const candidate: IconCandidate = {
        width: group[at] || 256,
        height: group[at + 1] || 256,
        colors: group[at + 2]!,
        planes: group.readUInt16LE(at + 4),
        bitCount: group.readUInt16LE(at + 6),
        id: group.readUInt16LE(at + 12),
      };
      if (
        !best ||
        candidate.width > best.width ||
        (candidate.width === best.width && candidate.bitCount > best.bitCount)
      ) {
        best = candidate;
      }
    }
    if (!best) return null;
    const chosen = best;

    const iconEntry = entries(iconType.offset).find((e) => e.id === chosen.id);
    const iconLeaf = iconEntry ? firstLeaf(iconEntry) : null;
    const image = iconLeaf == null ? null : await readLeaf(iconLeaf);
    if (!image || image.length < 8) return null;

    if (image.subarray(0, 8).equals(PNG_SIGNATURE)) {
      return { data: Buffer.from(image), format: 'png', size: chosen.width };
    }

    // Monta um .ico de uma única imagem (ICONDIR + ICONDIRENTRY + DIB).
    const header = Buffer.alloc(22);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(1, 4);
    header[6] = chosen.width >= 256 ? 0 : chosen.width;
    header[7] = chosen.height >= 256 ? 0 : chosen.height;
    header[8] = chosen.colors;
    header[9] = 0;
    header.writeUInt16LE(chosen.planes, 10);
    header.writeUInt16LE(chosen.bitCount, 12);
    header.writeUInt32LE(image.length, 14);
    header.writeUInt32LE(22, 18);
    return { data: Buffer.concat([header, image]), format: 'ico', size: chosen.width };
  } catch {
    return null;
  } finally {
    await fh.close();
  }
}
