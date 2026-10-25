import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Game } from '@shared/types';
import { makeTree, useTempDir } from '../../testing/tempDir';
import { BinaryVdfError, parseBinaryVdf, serializeBinaryVdf } from './binaryVdf';
import { SteamShortcutService, type SteamShortcutDeps } from './steamShortcutService';
import { joinCommandLine, listShortcuts, shortcutAppId } from './steamShortcuts';

// Monta bytes no formato da Steam, à mão (independente do serializador testado).
const S = (k: string, v: string) => Buffer.concat([Buffer.from([1]), Buffer.from(`${k}\0${v}\0`, 'utf8')]);
const I = (k: string, v: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0);
  return Buffer.concat([Buffer.from([2]), Buffer.from(`${k}\0`, 'utf8'), b]);
};
const M = (k: string, ...children: Buffer[]) => Buffer.concat([Buffer.from([0]), Buffer.from(`${k}\0`, 'utf8'), ...children, Buffer.from([8])]);
/** Um atalho criado pelo usuário na própria Steam (com um campo de 64 bits que o RetroVault não conhece). */
const userShortcut = (key: string, exe: string) =>
  M(
    key,
    I('appid', 4287527652),
    S('AppName', 'God of War III'),
    S('Exe', `"${exe}"`),
    S('StartDir', path.dirname(exe) + '\\'),
    S('icon', ''),
    S('LaunchOptions', ''),
    I('IsHidden', 0),
    Buffer.concat([Buffer.from([7]), Buffer.from('Futuro\0'), Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])]),
    I('LastPlayTime', 1792000000),
    M('tags', S('0', 'Favoritos'), S('1', 'Ação')),
  );
const file = (...shortcuts: Buffer[]) => Buffer.concat([M('shortcuts', ...shortcuts), Buffer.from([8])]);

describe('VDF binário', () => {
  it('lê e regrava byte a byte, inclusive tipos desconhecidos de tamanho fixo e acentos', () => {
    const buf = file(userShortcut('0', 'C:\\Jogos\\Gow\\God of War III.exe'));
    const nodes = parseBinaryVdf(buf);
    expect(serializeBinaryVdf(nodes).equals(buf)).toBe(true);
    expect(listShortcuts(nodes)).toEqual([{ appId: 4287527652, appName: 'God of War III', exe: 'C:\\Jogos\\Gow\\God of War III.exe' }]);
  });

  it('formato inesperado é recusado', () => {
    expect(() => parseBinaryVdf(Buffer.concat([Buffer.from([0x05]), Buffer.from('x\0')]))).toThrow(BinaryVdfError);
    expect(() => parseBinaryVdf(file().subarray(0, 5))).toThrow(BinaryVdfError);
  });

  it('linha de comando com aspas só onde precisa', () => {
    expect(joinCommandLine(['--appendconfig', 'C:\\Users\\Eu\\override.cfg', '-L', 'C:\\RetroArch\\cores\\x.dll', 'D:\\ROMs\\Meu Jogo (USA).sfc'])).toBe(
      '--appendconfig C:\\Users\\Eu\\override.cfg -L C:\\RetroArch\\cores\\x.dll "D:\\ROMs\\Meu Jogo (USA).sfc"',
    );
    expect(joinCommandLine(['-a', '', 'diz "oi"', 'C:\\pasta com espaço\\'])).toBe('-a "" "diz \\"oi\\"" "C:\\pasta com espaço\\\\"');
  });
});

describe('SteamShortcutService', () => {
  const tmp = useTempDir();
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
  const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);

  async function setup(running = false) {
    const root = path.join(tmp(), 'Steam');
    const art = path.join(tmp(), 'art');
    const gow = path.join(tmp(), 'Jogos', 'Gow', 'God of War III.exe');
    const original = file(userShortcut('0', gow));
    await makeTree(tmp(), {
      'Steam/steamapps/': null,
      'Steam/userdata/111/config/shortcuts.vdf': original,
      'Steam/userdata/222/': null,
      'Steam/config/loginusers.vdf': `"users"
{
	"76561197960265839" { "AccountName" "eu" "PersonaName" "Jogador" "MostRecent" "1" "Timestamp" "100" }
	"76561197960265950" { "AccountName" "outro" "PersonaName" "Irmão" "Timestamp" "200" }
}`,
      'art/capa.png': PNG,
      'art/fundo.jpg': JPG,
      'art/icone.png': PNG,
      'art/capa.webp': Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(16)]),
    });
    const g = (id: number, over: Partial<Game>): Game => ({ id, title: `Jogo ${id}`, kind: 'executable', path: `C:\\x\\${id}.exe`, launchArgs: null, steamAppId: null, coverUrl: null, backgroundUrl: null, iconUrl: null, ...over }) as Game;
    const games: Game[] = [
      g(1, { title: 'Hollow Knight', path: 'D:\\Jogos\\HK\\hollow_knight.exe', coverUrl: 'rv-media://artwork/capa.png', backgroundUrl: 'rv-media://artwork/fundo.jpg', iconUrl: 'rv-media://artwork/icone.png' }),
      g(2, { title: 'Super Mario World', kind: 'retroarch', path: 'D:\\ROMs\\Super Mario World (USA).sfc', coverUrl: 'https://media.retroachievements.org/Images/1.png' }),
      g(3, { title: 'Counter-Strike 2', steamAppId: 730 }),
      g(4, { title: 'God of War III', path: gow }),
      g(5, { title: 'Sem core', kind: 'retroarch', path: 'D:\\ROMs\\x.n64' }),
      // Adicionado como executável comum, mas instalado pela Steam; e um com arte .webp (a Steam não garante).
      g(6, { title: 'Onimusha', path: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\OnimushaWotS\\OnimushaWotS.exe' }),
      g(7, { title: 'Com webp', path: 'D:\\Jogos\\W\\w.exe', coverUrl: 'rv-media://artwork/capa.webp' }),
    ];
    const store = new Map<string, unknown>();
    const deps: SteamShortcutDeps = {
      steamRoot: async () => root,
      steamRunning: async () => running,
      games: { list: () => games },
      launchSpecFor: async (game) => {
        if (game.id === 5) throw new Error('Nenhum core válido para "Sem core".');
        return game.kind === 'retroarch'
          ? { command: 'C:\\RetroArch\\retroarch.exe', args: ['-L', 'C:\\RetroArch\\cores\\snes9x_libretro.dll', game.path], cwd: 'C:\\RetroArch' }
          : { command: game.path, args: [], cwd: path.dirname(game.path) };
      },
      artworkFile: (url) => (url.startsWith('rv-media://artwork/') ? path.join(art, url.slice('rv-media://artwork/'.length)) : null),
      downloadImage: async () => ({ data: PNG, ext: 'png' }),
      repo: { get: <T,>(key: string, fallback: T) => (store.has(key) ? (store.get(key) as T) : fallback), set: (key: string, value: unknown) => void store.set(key, structuredClone(value)) } as SteamShortcutDeps['repo'],
      backupDir: path.join(tmp(), 'backups'),
      launcherExe: 'C:\\Program Files\\RetroVault\\RetroVault.exe',
      now: () => new Date('2026-10-25T12:00:00Z'),
    };
    const shortcuts = path.join(root, 'userdata', '111', 'config', 'shortcuts.vdf');
    return { service: new SteamShortcutService(deps), deps, shortcuts, original, grid: path.join(root, 'userdata', '111', 'config', 'grid'), gow };
  }

  it('contas, bloqueios e atalhos do usuário na visão geral', async () => {
    const { service } = await setup();
    const o = await service.overview(null);
    expect(o.accounts).toEqual([
      { id: '111', name: 'Jogador', mostRecent: true },
      { id: '222', name: 'Irmão', mostRecent: false },
    ]);
    expect(o.accountId).toBe('111');
    expect(o.otherShortcuts).toBe(1);
    expect(o.games.map((g) => [g.title, g.inSteam, g.blocked])).toEqual([
      ['Hollow Knight', false, null],
      ['Super Mario World', false, null],
      ['Counter-Strike 2', false, 'Já é um jogo da Steam'],
      ['God of War III', false, 'Você já adicionou este jogo à Steam'],
      ['Sem core', false, null],
      ['Onimusha', false, 'Já é um jogo da Steam'],
      ['Com webp', false, null],
    ]);
  });

  it('adiciona, atualiza e remove só os atalhos do RetroVault; o do usuário fica idêntico', async () => {
    const { service, shortcuts, original, grid } = await setup();
    const first = await service.apply({ accountId: '111', gameIds: [1, 2, 3, 4, 5, 6], includeLauncher: true });
    expect(first).toMatchObject({ added: 3, updated: 0, removed: 0 });
    expect(first.skipped.map((s) => s.title)).toEqual(['Counter-Strike 2', 'God of War III', 'Sem core', 'Onimusha']);
    expect(await fs.readFile(first.backupPath!)).toEqual(original);

    const written = await fs.readFile(shortcuts);
    // O atalho do usuário continua sendo os mesmos bytes (só a chave "0" é a mesma posição).
    expect(written.includes(original.subarray(1 + 'shortcuts\0'.length, original.length - 2))).toBe(true);
    const list = listShortcuts(parseBinaryVdf(written));
    const hk = shortcutAppId('game:1');
    expect(list.map((s) => [s.appName, s.exe])).toEqual([
      ['God of War III', expect.stringContaining('God of War III.exe')],
      ['Hollow Knight', 'D:\\Jogos\\HK\\hollow_knight.exe'],
      ['Super Mario World', 'C:\\RetroArch\\retroarch.exe'],
      ['RetroVault', 'C:\\Program Files\\RetroVault\\RetroVault.exe'],
    ]);
    expect(list.every((s) => s.appId >= 0x80000000)).toBe(true);
    const nodes = parseBinaryVdf(written);
    const sm = JSON.stringify(nodes);
    expect(sm).toContain('-L C:\\\\RetroArch\\\\cores\\\\snes9x_libretro.dll \\"D:\\\\ROMs\\\\Super Mario World (USA).sfc\\"');
    expect((await fs.readdir(grid)).sort()).toEqual(
      [`${hk}_hero.jpg`, `${hk}_icon.png`, `${hk}p.png`, `${shortcutAppId('game:2')}p.png`].sort(),
    );
    expect(sm).toContain(path.join(grid, `${hk}_icon.png`).replace(/\\/g, '\\\\'));

    const overview = await service.overview('111');
    expect(overview.games.filter((g) => g.inSteam).map((g) => g.gameId)).toEqual([1, 2]);
    expect(overview.launcherInSteam).toBe(true);

    // Segunda vez: Mario sai, Hollow Knight é atualizado, o RetroVault sai.
    const second = await service.apply({ accountId: '111', gameIds: [1], includeLauncher: false });
    expect(second).toMatchObject({ added: 0, updated: 1, removed: 2 });
    const after = listShortcuts(parseBinaryVdf(await fs.readFile(shortcuts)));
    expect(after.map((s) => s.appName)).toEqual(['God of War III', 'Hollow Knight']);
    expect((await fs.readdir(grid)).sort()).toEqual([`${hk}_hero.jpg`, `${hk}_icon.png`, `${hk}p.png`].sort());

    // Tirar tudo devolve o arquivo exatamente ao original.
    await service.apply({ accountId: '111', gameIds: [], includeLauncher: false });
    expect(await fs.readFile(shortcuts)).toEqual(original);
    expect(await fs.readdir(grid)).toEqual([]);
  });

  it('conta sem arquivo: cria o shortcuts.vdf do zero, sem backup; arte .webp fica de fora', async () => {
    const { service, deps } = await setup();
    const res = await service.apply({ accountId: '222', gameIds: [7], includeLauncher: false });
    expect(res).toMatchObject({ added: 1, backupPath: null });
    const grid = path.join(await deps.steamRoot().then((r) => r!), 'userdata', '222', 'config', 'grid');
    expect(await fs.readdir(grid)).toEqual([]);
  });

  it('Steam aberta ou arquivo num formato desconhecido: nada é gravado', async () => {
    const running = await setup(true);
    await expect(running.service.apply({ accountId: '111', gameIds: [1], includeLauncher: false })).rejects.toMatchObject({ code: 'STEAM_RUNNING' });
    expect(await fs.readFile(running.shortcuts)).toEqual(running.original);

    const weird = Buffer.concat([running.original.subarray(0, -1), Buffer.from([0x05, 0x41, 0])]);
    await fs.writeFile(running.shortcuts, weird);
    const service = new SteamShortcutService({ ...running.deps, steamRunning: async () => false });
    await expect(service.apply({ accountId: '111', gameIds: [1], includeLauncher: false })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await fs.readFile(running.shortcuts)).toEqual(weird);
  });
});
