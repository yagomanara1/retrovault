import { describe, expect, it } from 'vitest';
import { autoCategoryIcon, CATEGORY_ICON_KEYS, categoryIconOf, iconParts, isCategoryIconKey } from './categoryIcons';

describe('autoCategoryIcon', () => {
  it.each([
    ['PlayStation', 'playstation'],
    ['PS1', 'playstation'],
    ['PlayStation 4', 'ps4'],
    ['PS3', 'ps3'],
    ['ps2', 'ps2'],
    ['PSP', 'psp'],
    ['PlayStation Vita', 'vita'],
    ['Nintendo DS', 'ds'],
    ['Nintendo 3DS', 'n3ds'],
    ['3DS', 'n3ds'],
    ['Nintendo Switch', 'switch'],
    ['GameCube', 'gamecube'],
    ['Wii', 'wii'],
    ['Wii U', 'wiiu'],
    ['Game Boy Advance', 'gba'],
    ['Game Boy Color', 'gbc'],
    ['Game Boy', 'gameboy'],
    ['Super Nintendo', 'snes'],
    ['NES', 'nes'],
    ['Nintendo 64', 'n64'],
    ['Mega Drive / Genesis', 'sega'],
    ['Master System', 'mastersystem'],
    ['Sega Saturn', 'saturn'],
    ['Sega CD', 'segacd'],
    ['Dreamcast', 'dreamcast'],
    ['Xbox', 'xbox'],
    ['Xbox 360', 'xbox360'],
    ['PC Engine CD', 'pcenginecd'],
    ['PC Engine / TurboGrafx-16', 'pcengine'],
    ['Atari 7800', 'atari7800'],
    ['Atari Lynx', 'lynx'],
    ['Neo Geo Pocket (Color)', 'ngp'],
    ['Arcade', 'arcade'],
    ['PC', 'pc'],
    ['Favoritos', 'star'],
    ['Platinados', 'trophy'],
    ['Jogos da infância', 'gamepad'],
  ])('%s → %s', (name, icon) => {
    expect(autoCategoryIcon(name)).toBe(icon);
  });

  it('não confunde: "Sem categoria" e nomes com "ps" no meio não viram PlayStation', () => {
    expect(autoCategoryIcon('Lapsos')).toBe('gamepad');
    expect(autoCategoryIcon('Pseudo')).toBe('gamepad');
  });
});

describe('categoryIconOf', () => {
  it('ícone escolhido vence o automático; chave desconhecida volta para o automático', () => {
    expect(categoryIconOf({ name: 'PlayStation 4', icon: 'heart' })).toBe('heart');
    expect(categoryIconOf({ name: 'PlayStation 4', icon: null })).toBe('ps4');
    expect(categoryIconOf({ name: 'PlayStation 4', icon: 'removido-numa-versao-futura' })).toBe('ps4');
  });

  it('categoria ligada a um console usa o ícone dele, mesmo renomeada', () => {
    expect(categoryIconOf({ name: 'Meus jogos de 360', icon: null, console: 'xbox360' })).toBe('xbox360');
    expect(categoryIconOf({ name: 'Meus jogos de 360', icon: 'heart', console: 'xbox360' })).toBe('heart');
  });

  it('ícone com selo empresta um desenho que existe e não tem selo (sem corrente de empréstimos)', () => {
    for (const key of CATEGORY_ICON_KEYS) {
      const { glyph, badge } = iconParts(key);
      expect(isCategoryIconKey(glyph), key).toBe(true);
      if (glyph !== key) expect(iconParts(glyph), key).toEqual({ glyph, badge: null });
      if (badge) expect(badge.length, key).toBeLessThanOrEqual(4);
    }
  });

  it('todas as chaves do catálogo são válidas', () => {
    for (const key of CATEGORY_ICON_KEYS) expect(isCategoryIconKey(key)).toBe(true);
    expect(isCategoryIconKey('toString')).toBe(false); // não aceita propriedades herdadas
  });
});
