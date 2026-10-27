// Assinatura dos formatos de imagem que o app guarda. Sem dependências (nem do Electron): serve ao main
// inteiro, inclusive nos testes.

export type ImageFormat = 'png' | 'jpg' | 'webp' | 'gif';

/** Confere a assinatura do arquivo: a extensão sozinha não garante que é uma imagem. */
export function hasImageSignature(data: Buffer, format: ImageFormat): boolean {
  switch (format) {
    case 'png':
      return data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    case 'jpg':
      return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
    case 'gif':
      return data.subarray(0, 4).toString('latin1') === 'GIF8';
    case 'webp':
      return data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP';
  }
}
