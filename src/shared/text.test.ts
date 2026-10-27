import { describe, expect, it } from 'vitest';
import { compactKey, foldDiacritics, wordKey } from './text';

describe('normalização de texto', () => {
  it.each([
    ['Pokémon Édition', 'pokemon edition'],
    ['ÇÃO  Ñ', 'cao  n'],
    ['Zelda: Ocarina', 'zelda: ocarina'],
  ])('foldDiacritics(%j) tira acentos e põe em minúsculas, sem mexer no resto', (input, expected) => {
    expect(foldDiacritics(input)).toBe(expected);
  });

  it.each([
    ['God of War III', 'godofwariii'],
    ['Crash™ Team Racing®', 'crashteamracing'],
    ['  Pokémon: Edição Ouro! ', 'pokemonedicaoouro'],
    ['', ''],
  ])('compactKey(%j) deixa só letras e números', (input, expected) => {
    expect(compactKey(input)).toBe(expected);
  });

  it.each([
    ['The Legend of Zelda: Ocarina of Time', 'the legend of zelda ocarina of time'],
    ['  Sonic -- Mania!! ', 'sonic mania'],
    ['Pokémon', 'pokemon'],
    ['***', ''],
  ])('wordKey(%j) separa as palavras por um espaço só', (input, expected) => {
    expect(wordKey(input)).toBe(expected);
  });
});
