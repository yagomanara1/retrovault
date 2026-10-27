// Ícones das categorias: símbolos próprios que remetem a cada console (não são os logotipos
// oficiais, que são marcas registradas). Este arquivo é compartilhado: o main valida a chave e o
// renderer desenha (components/categories/CategoryIcon.tsx).
//
// `glyph` reaproveita o desenho de outro ícone e `badge` escreve um selo curto no canto: assim cada
// geração de uma família (PS2, PS3, PS4…) tem o seu ícone sem inventar silhuetas ilegíveis em 18 px.
import { getConsoleCategory } from './consoleCategories';
import { foldDiacritics } from './text';

interface IconDef {
  label: string;
  color: string;
  glyph?: string;
  badge?: string;
}

export const CATEGORY_ICONS = {
  // Sony
  playstation: { label: 'PlayStation', color: '#0070d1' },
  ps2: { label: 'PlayStation 2', color: '#1f3a93', glyph: 'playstation', badge: '2' },
  ps3: { label: 'PlayStation 3', color: '#3a3a3c', glyph: 'playstation', badge: '3' },
  ps4: { label: 'PlayStation 4', color: '#003791', glyph: 'playstation', badge: '4' },
  psp: { label: 'PSP', color: '#00439c' },
  vita: { label: 'PS Vita', color: '#1d4fa3' },
  // Nintendo
  nes: { label: 'NES', color: '#b11a21' },
  snes: { label: 'Super Nintendo', color: '#6f5fb0' },
  n64: { label: 'Nintendo 64', color: '#2e8b3e' },
  gamecube: { label: 'GameCube', color: '#5b4fc2' },
  wii: { label: 'Wii', color: '#0095d9' },
  wiiu: { label: 'Wii U', color: '#009ac7' },
  switch: { label: 'Nintendo Switch', color: '#e60012' },
  gameboy: { label: 'Game Boy', color: '#7f8c4a' },
  gbc: { label: 'Game Boy Color', color: '#6b2fa0', glyph: 'gameboy', badge: 'C' },
  gba: { label: 'Game Boy Advance', color: '#4b3c9e' },
  ds: { label: 'Nintendo DS', color: '#e60012' },
  n3ds: { label: 'Nintendo 3DS', color: '#d1001c' },
  virtualboy: { label: 'Virtual Boy', color: '#c4001a' },
  pokemini: { label: 'Pokémon Mini', color: '#d4a100' },
  // Microsoft
  xbox: { label: 'Xbox', color: '#107c10' },
  xbox360: { label: 'Xbox 360', color: '#5dae1e' },
  // Sega
  sega: { label: 'Mega Drive', color: '#1e5bd6' },
  mastersystem: { label: 'Master System', color: '#c8102e', glyph: 'sega', badge: 'MS' },
  gamegear: { label: 'Game Gear', color: '#2d2d30', glyph: 'gba', badge: 'GG' },
  sg1000: { label: 'SG-1000', color: '#8a1c1c', glyph: 'sega', badge: 'SG' },
  sega32x: { label: 'Sega 32X', color: '#b8860b', glyph: 'sega', badge: '32X' },
  segacd: { label: 'Sega CD', color: '#3a6fe0' },
  saturn: { label: 'Sega Saturn', color: '#4f5bd5' },
  dreamcast: { label: 'Dreamcast', color: '#f26722' },
  // Outros consoles
  pcengine: { label: 'PC Engine', color: '#e04b2f' },
  pcenginecd: { label: 'PC Engine CD', color: '#c2410c', glyph: 'pcengine', badge: 'CD' },
  atari2600: { label: 'Atari 2600', color: '#a0522d' },
  atari7800: { label: 'Atari 7800', color: '#57534e', glyph: 'atari2600', badge: '7800' },
  lynx: { label: 'Atari Lynx', color: '#d9480f' },
  ngp: { label: 'Neo Geo Pocket', color: '#1b6ec2' },
  wonderswan: { label: 'WonderSwan', color: '#0f9d8a' },
  colecovision: { label: 'ColecoVision', color: '#44403c' },
  vectrex: { label: 'Vectrex', color: '#1c1917' },
  msx: { label: 'MSX', color: '#475569' },
  arcade: { label: 'Arcade', color: '#e8590c' },
  pc: { label: 'PC', color: '#636366' },
  // Genéricos
  gamepad: { label: 'Controle', color: '#5e5ce6' },
  star: { label: 'Estrela', color: '#f5a623' },
  heart: { label: 'Coração', color: '#ff375f' },
  trophy: { label: 'Troféu', color: '#c8901f' },
  folder: { label: 'Pasta', color: '#0a84ff' },
  flag: { label: 'Bandeira', color: '#30a46c' },
} as const satisfies Record<string, IconDef>;

export type CategoryIconKey = keyof typeof CATEGORY_ICONS;

export const CATEGORY_ICON_KEYS = Object.keys(CATEGORY_ICONS) as CategoryIconKey[];

export function isCategoryIconKey(value: string): value is CategoryIconKey {
  return Object.prototype.hasOwnProperty.call(CATEGORY_ICONS, value);
}

/** Desenho e selo efetivos de um ícone (o desenho pode ser emprestado de outro). */
export function iconParts(key: CategoryIconKey): { glyph: CategoryIconKey; badge: string | null } {
  const def: IconDef = CATEGORY_ICONS[key];
  return { glyph: def.glyph && isCategoryIconKey(def.glyph) ? def.glyph : key, badge: def.badge ?? null };
}

/** Ordem importa: o mais específico antes (Vita antes de PSP, PS2 antes de PlayStation, GBC antes de Game Boy…). */
const AUTO: [RegExp, CategoryIconKey][] = [
  [/\bvita\b/, 'vita'],
  [/playstation portable|\bpsp\b/, 'psp'],
  [/playstation ?2|\bps ?2\b/, 'ps2'],
  [/playstation ?3|\bps ?3\b/, 'ps3'],
  [/playstation ?4|\bps ?4\b/, 'ps4'],
  [/playstation|\bps ?[15x]?\b|\bps ?one\b/, 'playstation'],
  [/\b3ds\b|nintendo 3ds/, 'n3ds'],
  [/\bdsi?\b|nintendo ds/, 'ds'],
  [/switch/, 'switch'],
  [/game ?cube|\bngc\b/, 'gamecube'],
  [/wii ?u\b/, 'wiiu'],
  [/\bwii\b/, 'wii'],
  [/game ?boy advance|\bgba\b/, 'gba'],
  [/game ?boy colou?r|\bgbc\b/, 'gbc'],
  [/game ?boy|\bgb\b/, 'gameboy'],
  [/virtual ?boy/, 'virtualboy'],
  [/pokemon mini/, 'pokemini'],
  [/super nintendo|\bsnes\b|super famicom|\bsfc\b/, 'snes'],
  [/nintendo 64|\bn64\b/, 'n64'],
  [/\bnes\b|famicom|nintendo entertainment/, 'nes'],
  [/dreamcast/, 'dreamcast'],
  [/saturn/, 'saturn'],
  [/sega ?cd|mega ?cd/, 'segacd'],
  [/\b32x\b/, 'sega32x'],
  [/game ?gear/, 'gamegear'],
  [/master system/, 'mastersystem'],
  [/sg-?1000/, 'sg1000'],
  [/mega ?drive|genesis|\bsega\b/, 'sega'],
  [/xbox ?360/, 'xbox360'],
  [/xbox/, 'xbox'],
  [/pc engine cd|turbografx-?cd|turbo ?cd/, 'pcenginecd'],
  [/pc engine|turbografx/, 'pcengine'],
  [/\blynx\b/, 'lynx'],
  [/atari 7800/, 'atari7800'],
  [/atari 2600|\batari\b/, 'atari2600'],
  [/neo ?geo pocket|\bngpc?\b/, 'ngp'],
  [/wonder ?swan/, 'wonderswan'],
  [/coleco/, 'colecovision'],
  [/vectrex/, 'vectrex'],
  [/\bmsx\b/, 'msx'],
  [/arcade|\bmame\b|neo ?geo|fbneo|fliperama/, 'arcade'],
  [/\bpc\b|windows|steam|computador/, 'pc'],
  [/favorit|preferid/, 'star'],
  [/zerad|platin|complet|100 ?%/, 'trophy'],
];

const normalize = foldDiacritics;

/** Ícone sugerido pelo nome ("PlayStation 4" → ps4); sem correspondência, um controle genérico. */
export function autoCategoryIcon(name: string): CategoryIconKey {
  const n = normalize(name);
  for (const [pattern, key] of AUTO) if (pattern.test(n)) return key;
  return 'gamepad';
}

/** Ícone efetivo: o escolhido pelo usuário, o do console ligado à categoria ou o automático pelo nome. */
export function categoryIconOf(category: { name: string; icon: string | null; console?: string | null }): CategoryIconKey {
  if (category.icon && isCategoryIconKey(category.icon)) return category.icon;
  return getConsoleCategory(category.console)?.icon ?? autoCategoryIcon(category.name);
}
