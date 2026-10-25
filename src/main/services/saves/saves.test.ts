import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Game } from '@shared/types';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../db/database';
import { GameRepository } from '../../db/repositories/gameRepository';
import { SavePathRepository } from '../../db/repositories/savePathRepository';
import { makeTree, useTempDir } from '../../testing/tempDir';
import type { GameService } from '../gameService';
import { SaveLocator } from './saveLocator';
import { SaveService } from './saveService';
import { moveVaultRoot, SaveVault } from './saveVault';

const tmp = useTempDir('rv-saves-');

/** Monta o serviço com banco em memória e pastas temporárias (cofre em <tmp>/Cofre). */
function setup(opts: { running?: number[]; retroarch?: { exeDir: string; dirs: string[]; inContentDir: boolean } | null } = {}) {
  const db = openDatabase(':memory:');
  const repo = new GameRepository(db);
  const games = {
    get: (id: number) => repo.get(id)!,
    list: () => repo.list(),
  } as unknown as GameService;
  const folders = { documents: path.join(tmp(), 'Docs'), savedGames: path.join(tmp(), 'SavedGames'), localAppData: path.join(tmp(), 'Local') };
  const vaultRoot = path.join(tmp(), 'Cofre');
  const service = new SaveService({
    games,
    repo: new SavePathRepository(db),
    locator: new SaveLocator(folders, async () => opts.retroarch ?? null),
    vault: new SaveVault(() => vaultRoot),
    retroarchDir: async () => opts.retroarch?.exeDir ?? null,
    isRunning: (id) => (opts.running ?? []).includes(id),
  });
  const addGame = (title: string, filePath: string, kind: Game['kind'] = 'executable') =>
    repo.create({ title, kind, path: filePath, corePath: null, launchArgs: null, consoleId: null, raGameId: null, romHash: null, coverUrl: null, backgroundUrl: null, iconUrl: null });
  return { service, repo, addGame, folders, vaultRoot };
}

describe('SaveLocator', () => {
  it('detecta user\\savedata de ports de PS4 e save.bin solto (Pokémon), mas não dados do jogo', async () => {
    await makeTree(tmp(), {
      'Gow/port/God of War III.exe': 'x',
      'Gow/port/user/savedata/1/CUSA01623/SAVEDATA': 'save',
      'Poke/main.exe': 'x',
      'Poke/save.bin': 'save',
      'Poke/game.bin': 'dados',
      'Poke/arm9.bin': 'dados',
      'Poke/saves/slot1.dat': 'x',
    });
    const { service, addGame } = setup();
    const gow = addGame('God of War III', path.join(tmp(), 'Gow/port/God of War III.exe'));
    const poke = addGame('Pokemon Platinum', path.join(tmp(), 'Poke/main.exe'));
    expect((await service.get(gow.id)).locations.map((l) => path.relative(tmp(), l.path))).toEqual([path.join('Gow/port/user/savedata')]);
    expect((await service.get(poke.id)).locations.map((l) => path.basename(l.path)).sort()).toEqual(['save.bin', 'saves']);
  });

  it('detecta Documentos\\My Games\\<jogo>', async () => {
    await makeTree(tmp(), { 'Jogo/Hollow.exe': 'x', 'Docs/My Games/Hollow Knight/user1.dat': 'x' });
    const { service, addGame } = setup();
    const g = addGame('Hollow Knight', path.join(tmp(), 'Jogo/Hollow.exe'));
    expect((await service.get(g.id)).locations.map((l) => path.basename(l.path))).toEqual(['Hollow Knight']);
  });

  it('ROMs: .srm/.state com o nome da ROM nas pastas do RetroArch (inclusive por core)', async () => {
    await makeTree(tmp(), {
      'RA/saves/Chrono Trigger (USA).srm': 'x',
      'RA/saves/Snes9x/Chrono Trigger (USA).state1': 'x',
      'RA/saves/Outro Jogo.srm': 'x',
      'ROMs/Chrono Trigger (USA).sfc': 'rom',
    });
    const ra = { exeDir: path.join(tmp(), 'RA'), dirs: [path.join(tmp(), 'RA/saves')], inContentDir: false };
    const { service, addGame } = setup({ retroarch: ra });
    const g = addGame('Chrono Trigger', path.join(tmp(), 'ROMs/Chrono Trigger (USA).sfc'), 'retroarch');
    expect((await service.get(g.id)).locations.map((l) => path.basename(l.path)).sort()).toEqual(['Chrono Trigger (USA).srm', 'Chrono Trigger (USA).state1']);
  });
});

describe('SaveService', () => {
  it('backup automático só grava quando o save muda; o manual sempre grava', async () => {
    await makeTree(tmp(), { 'J/Jogo.exe': 'x', 'J/save.bin': 'v1' });
    const { service, addGame } = setup();
    const g = addGame('Jogo', path.join(tmp(), 'J/Jogo.exe'));
    expect(await service.backup(g.id, 'initial')).toMatchObject({ files: 1, reason: 'initial' });
    expect(await service.backup(g.id, 'auto')).toBeNull(); // nada mudou
    expect(await service.backup(g.id, 'manual')).not.toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    await fs.writeFile(path.join(tmp(), 'J/save.bin'), 'v2 com mais progresso');
    expect(await service.backup(g.id, 'session')).toMatchObject({ reason: 'session' });
    expect((await service.get(g.id)).snapshots).toHaveLength(3);
  });

  it('REINSTALAÇÃO: apagar o jogo, reinstalar em outra pasta, readicionar e restaurar o save', async () => {
    await makeTree(tmp(), {
      'Antigo/gow3/God of War III.exe': 'x',
      'Antigo/gow3/user/savedata/1/CUSA01623/SAVEDATA': 'progresso: Poseidon derrotado',
      'Antigo/gow3/user/savedata/1/CUSA01623/AUTOSAVE': 'autosave',
    });
    const { service, repo, addGame } = setup();
    const old = addGame('God of War III', path.join(tmp(), 'Antigo/gow3/God of War III.exe'));
    await service.backup(old.id, 'session');

    // Usuário apaga o jogo (pasta e biblioteca) e reinstala em outro disco/pasta.
    await fs.rm(path.join(tmp(), 'Antigo'), { recursive: true, force: true });
    repo.remove(old.id);
    await makeTree(tmp(), { 'Novo/Jogos/gow3/God of War III.exe': 'x' });
    const fresh = addGame('God of War III', path.join(tmp(), 'Novo/Jogos/gow3/God of War III.exe'));

    const saves = await service.get(fresh.id);
    expect(saves.fromPreviousInstall).toBe(true);
    expect(saves.snapshots).toHaveLength(1);

    await service.restore(fresh.id, saves.snapshots[0]!.id);
    const restored = path.join(tmp(), 'Novo/Jogos/gow3/user/savedata/1/CUSA01623');
    expect(await fs.readFile(path.join(restored, 'SAVEDATA'), 'utf8')).toBe('progresso: Poseidon derrotado');
    expect(await fs.readFile(path.join(restored, 'AUTOSAVE'), 'utf8')).toBe('autosave');
    expect((await service.get(fresh.id)).fromPreviousInstall).toBe(false);
  });

  it('restaurar guarda antes o save atual (rede de segurança) e substitui pelo escolhido', async () => {
    await makeTree(tmp(), { 'J/Jogo.exe': 'x', 'J/save.bin': 'antigo' });
    const { service, addGame } = setup();
    const g = addGame('Jogo', path.join(tmp(), 'J/Jogo.exe'));
    const first = (await service.backup(g.id, 'manual'))!;
    await fs.writeFile(path.join(tmp(), 'J/save.bin'), 'novo');

    const after = await service.restore(g.id, first.id);
    expect(await fs.readFile(path.join(tmp(), 'J/save.bin'), 'utf8')).toBe('antigo');
    expect(after.snapshots.map((s) => s.reason)).toContain('pre-restore');
  });

  it('não restaura com o jogo aberto', async () => {
    await makeTree(tmp(), { 'J/Jogo.exe': 'x', 'J/save.bin': 'x' });
    const { service, addGame } = setup({ running: [1] });
    const g = addGame('Jogo', path.join(tmp(), 'J/Jogo.exe'));
    const s = (await service.backup(g.id, 'manual'))!;
    await expect(service.restore(g.id, s.id)).rejects.toThrow(/Feche o jogo/);
  });

  it('recusa a pasta inteira do jogo como "local de save" (copiaria o jogo todo)', async () => {
    await makeTree(tmp(), { 'J/Jogo.exe': 'x' });
    const { service, addGame } = setup();
    const g = addGame('Jogo', path.join(tmp(), 'J/Jogo.exe'));
    await expect(service.addPath(g.id, path.join(tmp(), 'J'))).rejects.toThrow(/pasta inteira/);
    await expect(service.addPath(g.id, tmp())).rejects.toThrow(/pasta inteira/);
  });

  it('remover um local detectado o ignora; adicionar manual entra na lista', async () => {
    await makeTree(tmp(), { 'J/Jogo.exe': 'x', 'J/save.bin': 'x', 'Outro/perfil.cfg': 'x' });
    const { service, addGame } = setup();
    const g = addGame('Jogo', path.join(tmp(), 'J/Jogo.exe'));
    let saves = await service.removePath(g.id, path.join(tmp(), 'J/save.bin'));
    expect(saves.locations).toHaveLength(0);
    saves = await service.addPath(g.id, path.join(tmp(), 'Outro/perfil.cfg'));
    expect(saves.locations.map((l) => [path.basename(l.path), l.source])).toEqual([['perfil.cfg', 'manual']]);
  });

  it('dois jogos com "main.exe" e títulos diferentes não dividem o mesmo cofre', async () => {
    await makeTree(tmp(), { 'A/main.exe': 'x', 'A/save.bin': 'A', 'B/main.exe': 'x', 'B/save.bin': 'B' });
    const { service, addGame } = setup();
    const a = addGame('Pokemon Platinum', path.join(tmp(), 'A/main.exe'));
    const b = addGame('Outro Port', path.join(tmp(), 'B/main.exe'));
    await service.backup(a.id, 'manual');
    expect((await service.get(b.id)).snapshots).toHaveLength(0);
  });

  it('guarda só as 15 versões mais recentes', async () => {
    await makeTree(tmp(), { 'J/Jogo.exe': 'x', 'J/save.bin': 'x' });
    const { service, addGame } = setup();
    const g = addGame('Jogo', path.join(tmp(), 'J/Jogo.exe'));
    for (let i = 0; i < 17; i++) await service.backup(g.id, 'manual');
    expect((await service.get(g.id)).snapshots).toHaveLength(15);
  });
});

describe('moveVaultRoot', () => {
  it('move os backups e recusa destino não vazio ou aninhado', async () => {
    await makeTree(tmp(), { 'Cofre/Jogo/identity.json': '{}', 'Ocupada/arquivo.txt': 'x' });
    const from = path.join(tmp(), 'Cofre');
    await expect(moveVaultRoot(from, path.join(tmp(), 'Ocupada'))).rejects.toThrow(/não está vazia/);
    await expect(moveVaultRoot(from, path.join(from, 'Sub'))).rejects.toThrow(/dentro/);
    await moveVaultRoot(from, path.join(tmp(), 'OneDrive/Saves'));
    expect(await fs.readFile(path.join(tmp(), 'OneDrive/Saves/Jogo/identity.json'), 'utf8')).toBe('{}');
    await expect(fs.stat(from)).rejects.toThrow();
  });
});
