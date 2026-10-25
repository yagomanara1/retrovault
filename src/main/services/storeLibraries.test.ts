import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { makeTree, useTempDir } from '../testing/tempDir';
import { parseRegExport, scanStoreLibraries, type RegistryTree } from './storeLibraries';

const BIG = 'x'.repeat(5000);

describe('registro exportado (.reg)', () => {
  it('chaves, textos com barra e acento, DWORD', () => {
    const text = [
      '\uFEFFWindows Registry Editor Version 5.00',
      '',
      '[HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\1207658924]',
      '"gameName"="Pokémon \\"Edição\\" Teste"',
      '"exe"="C:\\\\GOG Games\\\\Jogo\\\\jogo.exe"',
      '"dependsOn"=""',
      '"buildId"=dword:0000002a',
    ].join('\r\n');
    expect(parseRegExport(text)).toEqual(
      new Map([['HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\1207658924', { gameName: 'Pokémon "Edição" Teste', exe: 'C:\\GOG Games\\Jogo\\jogo.exe', dependsOn: '', buildId: '42' }]]),
    );
  });
});

describe('scanStoreLibraries', () => {
  const tmp = useTempDir();

  it('junta Epic, GOG, Ubisoft, Amazon e itch.io; ignora plugin, DLC, instalação incompleta e jogo desinstalado', async () => {
    const root = tmp();
    const games = path.join(root, 'Jogos');
    const programData = path.join(root, 'ProgramData');
    const localAppData = path.join(root, 'Local');
    const appData = path.join(root, 'Roaming');
    const manifests = 'Epic/EpicGamesLauncher/Data/Manifests';
    const epic = (o: object) => JSON.stringify({ AppCategories: ['public', 'games', 'applications'], ...o });
    await makeTree(root, {
      // Epic: um jogo, um plugin do Unreal e uma instalação pela metade.
      [`ProgramData/${manifests}/A.item`]: epic({ DisplayName: 'Jogo Epic', InstallLocation: path.join(games, 'JogoEpic'), LaunchExecutable: 'Binaries/Win64/JogoEpic.exe' }),
      [`ProgramData/${manifests}/B.item`]: epic({ DisplayName: 'Plugin', InstallLocation: path.join(games, 'Plugin'), AppCategories: ['plugins'] }),
      [`ProgramData/${manifests}/C.item`]: epic({ DisplayName: 'Pela metade', InstallLocation: path.join(games, 'Metade'), bIsIncompleteInstall: true }),
      'Jogos/JogoEpic/Binaries/Win64/JogoEpic.exe': BIG,
      'Jogos/JogoEpic/Binaries/Win64/CrashReportClient.exe': 'x',
      'Jogos/Plugin/x.exe': 'x',
      // GOG
      'Jogos/GOG/Jogo GOG/jogo.exe': BIG,
      // Ubisoft: o registro só diz a pasta; o principal é escolhido (o auxiliar fica de fora).
      'Jogos/Ubisoft/Far Cry Teste/bin/FarCryTeste.exe': BIG,
      'Jogos/Ubisoft/Far Cry Teste/bin/UnityCrashHandler64.exe': 'x',
      'Jogos/Ubisoft/Far Cry Teste/bin/FarCryTeste_launcher.exe': 'x',
      // Amazon: fuel.json diz o executável.
      'Jogos/Amazon/Jogo Amazon/fuel.json': JSON.stringify({ Main: { Command: 'Game/Amazon.exe' } }),
      'Jogos/Amazon/Jogo Amazon/Game/Amazon.exe': BIG,
      'Local/Amazon Games/Data/Games/Sql/': null,
      // itch.io
      'Jogos/itch/jogo-itch/JogoItch.exe': BIG,
      'Roaming/itch/db/': null,
    });

    const amazon = new Database(path.join(localAppData, 'Amazon Games', 'Data', 'Games', 'Sql', 'GameInstallInfo.sqlite'));
    amazon.exec('CREATE TABLE DbSet (ProductTitle TEXT, InstallDirectory TEXT, Installed INTEGER)');
    amazon.prepare('INSERT INTO DbSet VALUES (?, ?, ?)').run('Jogo Amazon', path.join(games, 'Amazon', 'Jogo Amazon'), 1);
    amazon.prepare('INSERT INTO DbSet VALUES (?, ?, ?)').run('Desinstalado', path.join(games, 'Amazon', 'Sumiu'), 0);
    amazon.close();

    const itch = new Database(path.join(appData, 'itch', 'db', 'butler.db'));
    itch.exec(`CREATE TABLE games (id INTEGER, title TEXT); CREATE TABLE install_locations (id TEXT, path TEXT);
               CREATE TABLE caves (id TEXT, game_id INTEGER, install_folder_name TEXT, install_location_id TEXT);`);
    itch.prepare('INSERT INTO games VALUES (1, ?)').run('Jogo do itch');
    itch.prepare('INSERT INTO install_locations VALUES (?, ?)').run('loc', path.join(games, 'itch'));
    itch.prepare('INSERT INTO caves VALUES (?, 1, ?, ?)').run('c1', 'jogo-itch', 'loc');
    itch.close();

    const registry: Record<string, RegistryTree> = {
      'HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games': new Map<string, Record<string, string>>([
        ['HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games', {}],
        ['HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\111', { gameName: 'Jogo GOG', path: path.join(games, 'GOG', 'Jogo GOG'), exe: path.join(games, 'GOG', 'Jogo GOG', 'jogo.exe') }],
        ['HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\222', { gameName: 'DLC do GOG', path: path.join(games, 'GOG', 'Jogo GOG'), dependsOn: '111' }],
        ['HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\333', { gameName: 'Removido', path: path.join(games, 'GOG', 'Removido'), exe: 'x.exe' }],
      ]),
      'HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs': new Map<string, Record<string, string>>([
        ['HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs\\5', { InstallDir: `${path.join(games, 'Ubisoft', 'Far Cry Teste')}/` }],
      ]),
    };

    const library = new Set([path.join(games, 'itch', 'jogo-itch', 'JogoItch.exe').toLowerCase()]);
    const candidates = await scanStoreLibraries({ programData, localAppData, appData, tempDir: root, readRegistry: async (key) => registry[key] ?? new Map() }, library);

    expect(candidates.map((c) => [c.title, c.note, path.relative(games, c.path), c.inLibrary])).toEqual([
      ['Far Cry Teste', 'Ubisoft Connect', path.join('Ubisoft', 'Far Cry Teste', 'bin', 'FarCryTeste.exe'), false],
      ['Jogo Amazon', 'Amazon Games', path.join('Amazon', 'Jogo Amazon', 'Game', 'Amazon.exe'), false],
      ['Jogo do itch', 'itch.io', path.join('itch', 'jogo-itch', 'JogoItch.exe'), true],
      ['Jogo Epic', 'Epic Games', path.join('JogoEpic', 'Binaries', 'Win64', 'JogoEpic.exe'), false],
      ['Jogo GOG', 'GOG', path.join('GOG', 'Jogo GOG', 'jogo.exe'), false],
    ]);
    // O auxiliar de crash fica fora; o "_launcher" da Ubisoft vira alternativa (o usuário pode trocar).
    const ubisoft = candidates.find((c) => c.note === 'Ubisoft Connect')!;
    expect(ubisoft.alternatives.map((a) => path.basename(a))).toEqual(['FarCryTeste_launcher.exe']);
    expect(candidates.find((c) => c.note === 'Epic Games')!.alternatives).toEqual([]);
  });

  it('nenhuma loja instalada: lista vazia, sem erro', async () => {
    const root = tmp();
    expect(await scanStoreLibraries({ programData: root, localAppData: root, appData: root, tempDir: root, readRegistry: async () => new Map() }, new Set())).toEqual([]);
  });
});
