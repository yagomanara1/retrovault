import type { StorePort } from '@shared/store';
import { foldDiacritics } from '@shared/text';

/**
 * Busca sem acento, maiúsculas nem pontuação: "majoras" acha "Majora's", "zelda64" acha "Zelda 64:".
 * Apóstrofos somem (juntam a palavra); o resto da pontuação vira espaço.
 */
export function searchText(text: string): string {
  return foldDiacritics(text)
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ');
}

export interface PortIndexEntry {
  port: StorePort;
  text: string;
  /** O mesmo texto sem espaços: acha "2ship2" em "2 Ship 2". */
  compact: string;
}

/** Texto pesquisável de cada port, calculado uma vez por catálogo (não a cada tecla). */
export function buildPortIndex(ports: readonly StorePort[]): PortIndexEntry[] {
  return ports.map((port) => {
    const text = searchText(`${port.name} ${port.original.title} ${port.developer} ${port.tags.join(' ')}`);
    return { port, text, compact: text.replace(/ /g, '') };
  });
}

/** Ports em que todas as palavras da busca aparecem; busca vazia devolve todos, na ordem do catálogo. */
export function filterPorts(index: readonly PortIndexEntry[], query: string): StorePort[] {
  const words = searchText(query).split(' ').filter(Boolean);
  return index.filter(({ text, compact }) => words.every((w) => text.includes(w) || compact.includes(w))).map(({ port }) => port);
}
