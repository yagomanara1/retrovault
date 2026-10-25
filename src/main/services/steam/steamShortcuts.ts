// Atalhos não-Steam (userdata\<conta>\config\shortcuts.vdf): leitura e montagem, sem acesso a disco.
import path from 'node:path';
import { binInt, binString, type BinNode } from './binaryVdf';

export interface ShortcutSpec {
  appId: number;
  appName: string;
  /** Caminho do executável, sem aspas. */
  exe: string;
  startDir: string;
  /** Argumentos já montados como linha de comando. */
  launchOptions: string;
  /** Arquivo do ícone (vazio = o do executável). */
  icon: string;
}

export interface ExistingShortcut {
  appId: number;
  appName: string;
  /** Sem aspas. */
  exe: string;
}

const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(text: string): number {
  let c = 0xffffffff;
  for (const b of Buffer.from(text, 'utf8')) c = TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Id do atalho. A Steam atual respeita o "appid" gravado no arquivo (os que ela cria são sorteados); o
 * RetroVault usa um id fixo por jogo, com o bit alto ligado como todo atalho não-Steam, para regravar o
 * mesmo atalho (e as mesmas artes em grid\) a cada sincronização.
 */
export function shortcutAppId(key: string): number {
  return (crc32(`retrovault:${key}`) | 0x80000000) >>> 0;
}

/** Argumentos → linha de comando do Windows (aspas só onde precisa). */
export function joinCommandLine(args: readonly string[]): string {
  return args
    .map((a) => (a !== '' && !/[\s"]/.test(a) ? a : `"${a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`))
    .join(' ');
}

const unquote = (s: string) => s.trim().replace(/^"(.*)"$/, '$1');

/** O mapa "shortcuts" da raiz (criado se o arquivo for novo). */
export function shortcutsMap(root: BinNode[]): Extract<BinNode, { type: 'map' }> {
  let map = root.find((n): n is Extract<BinNode, { type: 'map' }> => n.type === 'map' && n.key.toLowerCase() === 'shortcuts');
  if (!map) {
    map = { type: 'map', key: 'shortcuts', children: [] };
    root.push(map);
  }
  return map;
}

export function listShortcuts(root: BinNode[]): ExistingShortcut[] {
  return shortcutsMap(root)
    .children.filter((n) => n.type === 'map')
    .map((n) => ({ appId: binInt(n, 'appid') ?? 0, appName: binString(n, 'AppName') ?? '', exe: unquote(binString(n, 'Exe') ?? '') }));
}

/** Mesmos campos e ordem que a própria Steam grava. */
export function shortcutNode(key: string, s: ShortcutSpec): BinNode {
  const str = (k: string, value: string): BinNode => ({ type: 'string', key: k, value });
  const int = (k: string, value: number): BinNode => ({ type: 'int32', key: k, value });
  return {
    type: 'map',
    key,
    children: [
      int('appid', s.appId),
      str('AppName', s.appName),
      str('Exe', `"${s.exe}"`),
      str('StartDir', `"${s.startDir}"`),
      str('icon', s.icon),
      str('ShortcutPath', ''),
      str('LaunchOptions', s.launchOptions),
      int('IsHidden', 0),
      int('AllowDesktopConfig', 1),
      int('AllowOverlay', 1),
      int('OpenVR', 0),
      int('Devkit', 0),
      str('DevkitGameID', ''),
      int('DevkitOverrideAppID', 0),
      int('LastPlayTime', 0),
      str('FlatpakAppID', ''),
      str('sortas', ''),
      { type: 'map', key: 'tags', children: [str('0', 'RetroVault')] },
    ],
  };
}

/**
 * Tira os atalhos do RetroVault (pelos ids registrados) e põe os novos. Os demais ficam intactos, na
 * mesma ordem e com todos os campos; as chaves ("0", "1"…) são renumeradas como a Steam faz.
 */
export function replaceShortcuts(root: BinNode[], removeIds: ReadonlySet<number>, add: readonly ShortcutSpec[]): void {
  const map = shortcutsMap(root);
  const kept = map.children.filter((n) => !(n.type === 'map' && removeIds.has(binInt(n, 'appid') ?? -1)));
  const all = [...kept, ...add.map((s) => shortcutNode('', s))];
  map.children = all.map((n, i) => ({ ...n, key: String(i) }));
}

/** Mesmo executável (sem diferenciar maiúsculas, com ou sem aspas). */
export const samePath = (a: string, b: string) => path.normalize(unquote(a)).toLowerCase() === path.normalize(unquote(b)).toLowerCase();
