import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTree, useTempDir } from '../testing/tempDir';
import { parseDropboxInfo, parseRegQuery, parseTasklist, providerForPath } from './cloudService';
import { mergeVaultInto } from './saves/saveVault';

// Formatos reais capturados no Windows 11 (pt-BR).
const REG = `
HKEY_CURRENT_USER\\Software\\Microsoft\\OneDrive\\Accounts\\Business1
    UserFolder    REG_SZ    C:\\Users\\Jogador\\OneDrive - Empresa
    UserEmail    REG_SZ    jogador@empresa.com

HKEY_CURRENT_USER\\Software\\Microsoft\\OneDrive\\Accounts\\Personal
    UserFolder    REG_SZ    C:\\Users\\Jogador\\OneDrive
    UserEmail    REG_SZ    pessoa@hotmail.com
`;

describe('parsers', () => {
  it('reg query: valores por subchave', () => {
    const keys = parseRegQuery(REG);
    const personal = [...keys.entries()].find(([k]) => k.endsWith('\\Personal'))![1];
    expect(personal.get('UserFolder')).toBe('C:\\Users\\Jogador\\OneDrive');
    expect(personal.get('UserEmail')).toBe('pessoa@hotmail.com');
    expect(keys.size).toBe(2);
  });

  it('tasklist CSV: nomes em minúsculas', () => {
    const names = parseTasklist('"explorer.exe","12008","Console","1","419.000 K"\r\n"OneDrive.exe","4410","Console","1","90.000 K"');
    expect(names.has('onedrive.exe')).toBe(true);
    expect(names.has('explorer.exe')).toBe(true);
  });

  it('info.json do Dropbox (pessoal, depois empresa; JSON inválido → null)', () => {
    expect(parseDropboxInfo('{"personal":{"path":"C:\\\\Users\\\\x\\\\Dropbox"}}')).toBe('C:\\Users\\x\\Dropbox');
    expect(parseDropboxInfo('{"business":{"path":"D:\\\\Dropbox (Empresa)"}}')).toBe('D:\\Dropbox (Empresa)');
    expect(parseDropboxInfo('lixo')).toBeNull();
  });

  it('providerForPath: o cofre está dentro de qual pasta sincronizada', () => {
    const providers = [
      { id: 'onedrive' as const, folder: 'C:\\Users\\y\\OneDrive' },
      { id: 'dropbox' as const, folder: null },
    ];
    expect(providerForPath('C:\\Users\\y\\OneDrive\\RetroVault\\Saves', providers)).toBe('onedrive');
    expect(providerForPath('C:\\Users\\y\\OneDriveBackup\\Saves', providers)).toBeNull(); // prefixo não basta
    expect(providerForPath('C:\\Users\\y\\Documents\\RetroVault\\Saves', providers)).toBeNull();
  });
});

describe('mergeVaultInto', () => {
  const tmp = useTempDir('rv-cloud-');
  const identity = (title: string, file: string) => JSON.stringify({ title, file });

  it('segundo PC: junta o cofre local com o que já está na nuvem sem sobrescrever nada', async () => {
    await makeTree(tmp(), {
      // Na nuvem (vindo do PC 1): GoW com uma versão.
      'Nuvem/God of War III/identity.json': identity('God of War III', 'god of war iii.exe'),
      'Nuvem/God of War III/20261020-100000-session/manifest.json': 'nuvem',
      // No PC 2: GoW com uma versão igual (mesmo id) e outra nova; e um jogo que a nuvem não tem.
      'Local/God of War III/identity.json': identity('God of War III', 'god of war iii.exe'),
      'Local/God of War III/20261020-100000-session/manifest.json': 'local (não pode sobrescrever)',
      'Local/God of War III/20261022-150000-session/manifest.json': 'nova',
      'Local/Bloodborne/identity.json': identity('Bloodborne', 'bloodborne.exe'),
      'Local/Bloodborne/20261022-120000-initial/manifest.json': 'bb',
      'Local/lixo.txt': 'ignorado',
    });
    const r = await mergeVaultInto(path.join(tmp(), 'Local'), path.join(tmp(), 'Nuvem'), true);
    expect(r).toEqual({ games: 1, snapshots: 1 });

    const read = (rel: string) => fs.readFile(path.join(tmp(), 'Nuvem', rel), 'utf8');
    expect(await read('God of War III/20261020-100000-session/manifest.json')).toBe('nuvem');
    expect(await read('God of War III/20261022-150000-session/manifest.json')).toBe('nova');
    expect(await read('Bloodborne/20261022-120000-initial/manifest.json')).toBe('bb');
    await expect(fs.stat(path.join(tmp(), 'Local'))).rejects.toThrow(); // origem removida
  });

  it('desconectar: copia de volta e mantém a cópia na nuvem', async () => {
    await makeTree(tmp(), {
      'Nuvem/Jogo/identity.json': identity('Jogo', 'jogo.exe'),
      'Nuvem/Jogo/20261022-150000-manual/manifest.json': 'x',
    });
    await mergeVaultInto(path.join(tmp(), 'Nuvem'), path.join(tmp(), 'Docs/RetroVault/Saves'), false);
    expect(await fs.readFile(path.join(tmp(), 'Docs/RetroVault/Saves/Jogo/20261022-150000-manual/manifest.json'), 'utf8')).toBe('x');
    expect(await fs.readFile(path.join(tmp(), 'Nuvem/Jogo/20261022-150000-manual/manifest.json'), 'utf8')).toBe('x');
  });

  it('recusa destino dentro do próprio cofre', async () => {
    await makeTree(tmp(), { 'Cofre/': null });
    await expect(mergeVaultInto(path.join(tmp(), 'Cofre'), path.join(tmp(), 'Cofre/sub'), true)).rejects.toThrow(/dentro/);
  });
});
