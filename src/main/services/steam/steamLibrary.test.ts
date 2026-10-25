import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTree, useTempDir } from '../../testing/tempDir';
import { scanStoreLibraries, type RegistryTree } from '../storeLibraries';
import { findSteamApp, parseVdf, steamApps, steamArtwork, steamGameDir, steamPlaytime, steamRunUrl, vdfGet } from './steamLibrary';

const BIG = 'x'.repeat(5000);
const OWNER = '76561198177262911'; // conta 216997183 em userdata

const manifest = (appid: number, name: string, installdir: string, flags = 4, extra = '') => `"AppState"
{
	"appid"		"${appid}"
	"name"		"${name}"
	"StateFlags"		"${flags}"
	"installdir"		"${installdir}"
	"LastPlayed"		"1700000000"
	"LastOwner"		"${OWNER}"
	${extra}
}`;

describe('parseVdf', () => {
  it('blocos, escapes, comentários, condicionais e chaves sem diferenciar maiúsculas', () => {
    const vdf = parseVdf(`// comentário
"Raiz"
{
	"caminho"		"D:\\\\SteamLibrary"
	"aspas"		"Diz \\"oi\\""
	"so_win"		"1"	[$WIN32]
	"Apps" { "730" { "Playtime" "42" } }
}`);
    expect(vdfGet(vdf, 'raiz', 'CAMINHO')).toBe('D:\\SteamLibrary');
    expect(vdfGet(vdf, 'Raiz', 'aspas')).toBe('Diz "oi"');
    expect(vdfGet(vdf, 'Raiz', 'so_win')).toBe('1');
    expect(vdfGet(vdf, 'Raiz', 'apps', '730', 'playtime')).toBe('42');
  });

  it('texto truncado devolve o que deu para ler', () => {
    expect(vdfGet(parseVdf('"a" { "b" "1" "c" { "d"'), 'a', 'b')).toBe('1');
  });
});

describe('biblioteca da Steam', () => {
  const tmp = useTempDir();

  async function steamFixture() {
    const root = tmp();
    const steam = path.join(root, 'Steam');
    const other = path.join(root, 'SteamLibrary');
    await makeTree(root, {
      'Steam/steamapps/libraryfolders.vdf': `"libraryfolders"
{
	"0" { "path" "${steam.replace(/\\/g, '\\\\')}" "apps" { "730" "1" } }
	"1" { "path" "${other.replace(/\\/g, '\\\\')}" "apps" { "311210" "1" } }
}`,
      'Steam/steamapps/appmanifest_730.acf': manifest(730, 'Counter-Strike 2', 'Counter-Strike Global Offensive'),
      'Steam/steamapps/appmanifest_228980.acf': manifest(228980, 'Steamworks Common Redistributables', 'Steamworks Shared'),
      'Steam/steamapps/appmanifest_960090.acf': manifest(960090, 'Baixando', 'Baixando', 1026),
      'Steam/steamapps/appmanifest_999.acf': manifest(999, 'Pasta apagada', 'Sumiu'),
      'Steam/steamapps/common/Counter-Strike Global Offensive/game/bin/win64/cs2.exe': BIG,
      // Maior que o jogo: sem a sigla do título ("cs2"), seria o escolhido.
      'Steam/steamapps/common/Counter-Strike Global Offensive/game/bin/win64/vconsole2.exe': BIG + BIG,
      'Steam/steamapps/common/Steamworks Shared/_CommonRedist/vcredist.exe': BIG,
      'Steam/steamapps/common/Baixando/jogo.exe': BIG,
      'SteamLibrary/steamapps/appmanifest_311210.acf': manifest(311210, 'Call of Duty: Black Ops III', 'Call of Duty Black Ops III', 518),
      'SteamLibrary/steamapps/appmanifest_1493710.acf': manifest(1493710, 'Proton Experimental', 'Proton - Experimental'),
      'SteamLibrary/steamapps/appmanifest_730.acf': manifest(730, 'Counter-Strike 2 (cópia)', 'Counter-Strike Global Offensive'),
      'SteamLibrary/steamapps/common/Call of Duty Black Ops III/BlackOps3.exe': BIG,
      'SteamLibrary/steamapps/common/Call of Duty Black Ops III/UnityCrashHandler64.exe': 'x',
      'SteamLibrary/steamapps/common/Proton - Experimental/proton': 'x',
      'SteamLibrary/steamapps/common/Counter-Strike Global Offensive/x.exe': BIG,
      'Steam/userdata/216997183/config/localconfig.vdf': `"UserLocalConfigStore"
{
	"Software" { "Valve" { "Steam" { "apps" {
		"730" { "LastPlayed" "1792808065" "Playtime" "125" }
	} } } }
	"Segredo" "nunca lido"
}`,
    });
    return { root, steam, other };
  }

  it('lista os jogos das duas bibliotecas, sem ferramentas, downloads, pastas apagadas nem repetidos', async () => {
    const { steam, other } = await steamFixture();
    const apps = await steamApps(steam);
    expect(apps.map((a) => [a.appId, a.title, a.dir])).toEqual([
      [730, 'Counter-Strike 2', path.join(steam, 'steamapps', 'common', 'Counter-Strike Global Offensive')],
      [311210, 'Call of Duty: Black Ops III', path.join(other, 'steamapps', 'common', 'Call of Duty Black Ops III')],
    ]);
    expect(apps[0]!.ownerSteamId).toBe(OWNER);
    expect((await findSteamApp(steam, 311210))?.title).toBe('Call of Duty: Black Ops III');
    expect(await findSteamApp(steam, 228980)).toBeNull();
  });

  it('tempo de jogo da conta dona (minutos → segundos) e o "jogado por último" mais recente', async () => {
    const { steam } = await steamFixture();
    const cs = (await findSteamApp(steam, 730))!;
    expect(await steamPlaytime(steam, cs)).toEqual({ seconds: 125 * 60, lastPlayedAt: new Date(1792808065 * 1000).toISOString() });
    // Sem registro no localconfig: fica só a data do manifesto.
    const bo3 = (await findSteamApp(steam, 311210))!;
    expect(await steamPlaytime(steam, bo3)).toEqual({ seconds: 0, lastPlayedAt: new Date(1700000000 * 1000).toISOString() });
    expect(await steamPlaytime(steam, { appId: 1, ownerSteamId: null, lastPlayed: null })).toBeNull();
  });

  it('arte do cache: formato novo (subpastas, vale a mais recente) e antigo (<id>_nome.jpg)', async () => {
    const { steam } = await steamFixture();
    const cache = path.join(steam, 'appcache', 'librarycache');
    await makeTree(cache, {
      '730/library_600x900.jpg': 'capa',
      '730/library_hero.jpg': 'fundo',
      '730/library_hero_blur.jpg': 'borrado',
      '311210/aaa/library_capsule.jpg': 'capa velha',
      '311210/bbb/library_capsule.jpg': 'capa nova',
      '311210/ccc/library_hero.jpg': 'fundo',
      '400_library_600x900.jpg': 'capa antiga',
    });
    const old = new Date(Date.now() - 60_000);
    await fs.utimes(path.join(cache, '311210', 'aaa', 'library_capsule.jpg'), old, old);

    expect(await steamArtwork(steam, 730)).toEqual({ cover: path.join(cache, '730', 'library_600x900.jpg'), background: path.join(cache, '730', 'library_hero.jpg') });
    expect(await steamArtwork(steam, 311210)).toEqual({ cover: path.join(cache, '311210', 'bbb', 'library_capsule.jpg'), background: path.join(cache, '311210', 'ccc', 'library_hero.jpg') });
    expect(await steamArtwork(steam, 400)).toEqual({ cover: path.join(cache, '400_library_600x900.jpg'), background: null });
    expect(await steamArtwork(steam, 5)).toEqual({ cover: null, background: null });
  });

  it('entra na importação das lojas pela pasta do registro, com o id para abrir pela Steam', async () => {
    const { root, steam } = await steamFixture();
    const user = 'HKCU\\Software\\Valve\\Steam';
    // O registro guarda com barras normais e minúsculas ("c:/program files (x86)/steam").
    const registry: Record<string, RegistryTree> = { [user]: new Map([['HKCU\\Software\\Valve\\Steam', { SteamPath: steam.replace(/\\/g, '/') }]]) };
    const candidates = await scanStoreLibraries(
      { programData: root, localAppData: root, appData: root, tempDir: root, readRegistry: async (key) => registry[key] ?? new Map() },
      new Set(),
    );
    expect(candidates.map((c) => [c.title, c.note, c.steamAppId, path.basename(c.path)])).toEqual([
      ['Call of Duty: Black Ops III', 'Steam', 311210, 'BlackOps3.exe'],
      ['Counter-Strike 2', 'Steam', 730, 'cs2.exe'],
    ]);
    // Sem registro: o local padrão.
    const fallback = await scanStoreLibraries(
      { programData: root, localAppData: root, appData: root, tempDir: root, readRegistry: async () => new Map(), steamFallbackDirs: [path.join(root, 'Nada'), steam] },
      new Set(),
    );
    expect(fallback).toHaveLength(2);
  });

  it('URL de abertura e pasta do jogo (mesmo com o .exe numa subpasta)', () => {
    expect(steamRunUrl(730)).toBe('steam://rungameid/730');
    expect(steamGameDir('D:\\SteamLibrary\\steamapps\\common\\Counter-Strike Global Offensive\\game\\bin\\win64\\cs2.exe')).toBe(
      'D:\\SteamLibrary\\steamapps\\common\\Counter-Strike Global Offensive',
    );
    expect(steamGameDir('C:\\Jogos\\x\\x.exe')).toBe(path.dirname('C:\\Jogos\\x\\x.exe'));
  });
});
