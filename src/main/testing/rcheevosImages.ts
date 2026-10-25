// Utilitário só para testes: geradores de imagens dos testes oficiais do rcheevos (test/hash/hash_data.c,
// licença MIT), portados byte a byte. Com eles, os hashes têm que dar exatamente os valores do rcheevos.
/** fill_image do rcheevos: preenchimento pseudoaleatório determinístico pelo tamanho. */
export function fillImage(image: Buffer, offset: number, size: number): void {
  let seed = Number(BigInt.asIntN(32, BigInt(size) ^ (BigInt(size) >> 8n) ^ ((BigInt(size) - 1n) * 25387n)));
  let at = offset;
  let remaining = size;
  while (remaining > 0) {
    let count: number;
    let value: number;
    switch (seed & 0xff) {
      case 0:
        count = ((seed >> 8) & 0x3f) & ~(remaining & 0x0f);
        if (count === 0) count = 1;
        value = 0;
        break;
      case 1:
        count = ((seed >> 8) & 0x07) + 1;
        value = (seed >> 16) & 0xff;
        break;
      case 2:
        count = ((seed >> 8) & 0x03) + 1;
        value = ((seed >> 16) & 0xff) ^ 0xff;
        break;
      case 3:
        count = ((seed >> 8) & 0x03) + 1;
        value = ((seed >> 16) & 0xff) ^ 0xa5;
        break;
      case 4:
        count = ((seed >> 8) & 0x03) + 1;
        value = ((seed >> 16) & 0xff) ^ 0xc3;
        break;
      case 5:
        count = ((seed >> 8) & 0x03) + 1;
        value = ((seed >> 16) & 0xff) ^ 0x96;
        break;
      case 6:
      case 7:
        count = ((seed >> 8) & 0x03) + 1;
        value = ((seed >> 16) & 0xff) ^ 0x78;
        break;
      default:
        count = 1;
        value = ((seed >> 8) ^ (seed >> 16)) & 0xff;
    }
    do {
      image[at++] = value;
      remaining--;
    } while (remaining && --count);
    seed = (Math.imul(seed, 0x41c64e6d) + 12345) & 0x7fffffff;
  }
}

export const genericFile = (size: number) => {
  const b = Buffer.alloc(size);
  fillImage(b, 0, size);
  return b;
};

/** generate_iso9660_bin */
export function iso9660Bin(numSectors: number, label: string): Buffer {
  const image = Buffer.alloc(numSectors * 2048);
  const pvd = 16 * 2048;
  Buffer.from([0x01, 0x43, 0x44, 0x30, 0x30, 0x31, 0x01, 0x00]).copy(image, pvd);
  image.write(label, pvd + 40, 'latin1');
  image[pvd + 80] = image[87] = numSectors & 0xff;
  image[pvd + 81] = image[86] = (numSectors >> 8) & 0xff;
  image[pvd + 82] = image[85] = (numSectors >> 16) & 0xff;
  image[pvd + 83] = image[84] = (numSectors >> 24) & 0xff;
  image[pvd + 128] = 2048 & 0xff;
  image[pvd + 129] = (2048 >> 8) & 0xff;
  image[pvd + 158] = 17;
  image[17 * 2048 - 4] = 18;
  return image;
}

/** generate_iso9660_file: devolve a posição do conteúdo (o chamador pode alterá-lo). */
export function iso9660File(image: Buffer, filename: string, contents: Buffer | null, size: number): number {
  const root = 17 * 2048;
  let entry = root;
  let next = image[root - 4]! | (image[root - 3]! << 8) | (image[root - 2]! << 16);
  let name = filename.startsWith('\\') ? filename.slice(1) : filename;
  for (;;) {
    const sep = name.indexOf('\\');
    if (sep < 0) break;
    const dir = name.slice(0, sep);
    let found = false;
    while (image[entry]) {
      if (image[entry + 25] && image[entry + 33 + dir.length] === 0 && image.toString('latin1', entry + 33, entry + 33 + dir.length) === dir) {
        entry = image[entry + 2]! * 2048;
        found = true;
        break;
      }
      entry += image[entry]!;
    }
    if (!found) {
      image[entry] = (dir.length & 0xff) + 48;
      image[entry + 2] = next & 0xff;
      image[entry + 3] = (next >> 8) & 0xff;
      image[entry + 25] = 1;
      image[entry + 32] = dir.length & 0xff;
      image.write(dir, entry + 33, 'latin1');
      image[entry + 33 + dir.length] = 0;
      entry = next * 2048;
      next++;
    }
    name = name.slice(sep + 1);
  }
  while (image[entry]) entry += image[entry]!;
  image[entry] = (name.length & 0xff) + 48;
  image[entry + 2] = next & 0xff;
  image[entry + 3] = (next >> 8) & 0xff;
  image[entry + 10] = size & 0xff;
  image[entry + 11] = (size >> 8) & 0xff;
  image[entry + 12] = (size >> 16) & 0xff;
  image[entry + 32] = (name.length + 2) & 0xff;
  image.write(`${name};1`, entry + 33, 'latin1');
  const at = next * 2048;
  if (contents) contents.copy(image, at, 0, size);
  else fillImage(image, at, size);
  next += Math.floor((size + 2047) / 2048);
  image[root - 4] = next & 0xff;
  image[root - 3] = (next >> 8) & 0xff;
  image[root - 2] = (next >> 16) & 0xff;
  return at;
}

/** generate_psx_bin (o nome vai para o SYSTEM.CNF como em C: "\\" vira uma barra). */
export function psxBin(binaryName: string, binarySize: number): Buffer {
  const image = iso9660Bin(Math.floor((binarySize + 2047) / 2048) + 20, 'TEST');
  const cnf = Buffer.from(`BOOT=cdrom:\\${binaryName};1\nTCB=4\nEVENT=10\nSTACK=801FFFF0\n`, 'latin1');
  iso9660File(image, 'SYSTEM.CNF', cnf, cnf.length);
  const exe = iso9660File(image, binaryName, null, binarySize);
  image.write('PS-X EXE', exe, 'latin1');
  image.writeUInt32LE(binarySize - 2048, exe + 28);
  return image;
}

/** generate_ps2_bin */
export function ps2Bin(binaryName: string, binarySize: number): Buffer {
  const image = iso9660Bin(Math.floor((binarySize + 2047) / 2048) + 20, 'TEST');
  const cnf = Buffer.from(`BOOT2 = cdrom0:\\${binaryName};1\nVER = 1.0\nVMODE = NTSC\n`, 'latin1');
  iso9660File(image, 'SYSTEM.CNF', cnf, cnf.length);
  const exe = iso9660File(image, binaryName, null, binarySize);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]).copy(image, exe);
  return image;
}

/** generate_nds_file */
export function ndsFile(mb: number, arm9Size: number, arm7Size: number): Buffer {
  const image = genericFile(mb * 1024 * 1024);
  const arm9 = 65536;
  const arm7 = arm9 + arm9Size;
  image.writeUInt32LE(arm9, 0x20);
  image.writeUInt32LE(arm9Size, 0x2c);
  image.writeUInt32LE(arm7, 0x30);
  image.writeUInt32LE(arm7Size, 0x3c);
  image.writeUInt32LE(arm7 + arm7Size, 0x68);
  return image;
}
