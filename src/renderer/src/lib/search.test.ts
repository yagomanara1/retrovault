import { describe, expect, it } from 'vitest';
import type { StorePort } from '@shared/store';
import { buildPortIndex, filterPorts, searchText } from './search';

const port = (id: string, name: string, title: string, developer = 'Equipe', tags: string[] = []) =>
  ({ id, name, original: { title }, developer, tags }) as StorePort;

const INDEX = buildPortIndex([
  port('soh', 'Ship of Harkinian', 'The Legend of Zelda: Ocarina of Time', 'HarbourMasters', ['Zelda']),
  port('mm', '2 Ship 2 Harkinian', "The Legend of Zelda: Majora's Mask", 'HarbourMasters'),
  port('poke', 'Pokémon Recomp', 'Pokémon Snap', 'Equipe Ação', ['Recompilação']),
]);
const ids = (query: string) => filterPorts(INDEX, query).map((p) => p.id);

describe('busca da Loja', () => {
  it.each([
    ["Majora's Mask", 'majoras mask'],
    ['Pokémon: Edição Ação!', 'pokemon edicao acao '],
    ['Zelda 64:', 'zelda 64 '],
  ])('searchText(%j) tira acento, apóstrofo e pontuação', (input, expected) => {
    expect(searchText(input)).toBe(expected);
  });

  it('sem busca, todos os ports, na ordem do catálogo', () => {
    expect(ids('')).toEqual(['soh', 'mm', 'poke']);
    expect(ids('   ')).toEqual(['soh', 'mm', 'poke']);
  });

  it('todas as palavras precisam aparecer (nome, jogo original, equipe ou etiqueta)', () => {
    expect(ids('zelda')).toEqual(['soh', 'mm']);
    expect(ids('zelda ocarina')).toEqual(['soh']);
    expect(ids('harbourmasters')).toEqual(['soh', 'mm']);
    expect(ids('recompilacao')).toEqual(['poke']);
    expect(ids('zelda snap')).toEqual([]);
  });

  it('acha com apóstrofo, sem acento e com palavras grudadas', () => {
    expect(ids('majoras')).toEqual(['mm']);
    expect(ids("MAJORA'S")).toEqual(['mm']);
    expect(ids('pokemon')).toEqual(['poke']);
    expect(ids('2ship2')).toEqual(['mm']);
    expect(ids('shipofharkinian')).toEqual(['soh']);
  });
});
