import { describe, expect, it } from 'vitest';
import { showsConsoleHome } from './useLibraryView';

describe('showsConsoleHome', () => {
  it('tela de console só com jogos: biblioteca vazia, carregando ou com erro fica na grade (com o menu de cima)', () => {
    expect(showsConsoleHome('console', 3)).toBe(true);
    expect(showsConsoleHome('console', 0)).toBe(false); // instalação nova: precisa do menu para chegar à Loja e às Configurações
    expect(showsConsoleHome('console', undefined)).toBe(false); // carregando ou erro
    expect(showsConsoleHome('grid', 3)).toBe(false);
  });
});
