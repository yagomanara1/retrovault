import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameProgress } from '@shared/types';
import { openDatabase } from '../db/database';
import { GameRepository } from '../db/repositories/gameRepository';
import { makeTree, useTempDir } from '../testing/tempDir';
import { GameService } from './gameService';
import type { DumpArtwork } from './trophies/dumpArtwork';

vi.mock('electron', () => ({ app: {}, nativeImage: {}, shell: {} }));

const art = (name: string) => `rv-media://artwork/${name}`;
const RA_COVER = 'https://media.retroachievements.org/Images/caixa.png';
const RA_TITLE = 'https://media.retroachievements.org/Images/titulo.png';
const RA_ICON = 'https://media.retroachievements.org/Images/icone.png';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

/** GameService com o repositório de verdade (banco em memória) e o mundo lá fora de mentira. */
function setup() {
  const repo = new GameRepository(openDatabase(':memory:'));
  const saved: string[] = [];
  const state = {
    progress: { boxArtUrl: RA_COVER, titleImageUrl: RA_TITLE, iconUrl: RA_ICON } as Partial<GameProgress> | null,
    dump: null as DumpArtwork | null,
    exeIcon: art('icone-do-exe.png') as string | null,
  };
  const service = new GameService(
    repo,
    {
      getGameProgress: async () => {
        if (!state.progress) throw new Error('RA fora do ar');
        return state.progress;
      },
      hasCredentials: () => false,
    } as never,
    { status: async () => ({ cores: [] }) } as never,
    {
      extractExecutableIcon: async () => state.exeIcon,
      importImage: async (file: string) => art(`importada-${path.basename(file)}`),
      saveGraphic: async (_data: Buffer, format: string) => {
        saved.push(`grafico:${format}`);
        return art('grafico.png');
      },
      savePhoto: async (_data: Buffer, format: string) => {
        saved.push(`foto:${format}`);
        return art('foto.jpg');
      },
    } as never,
    { find: async () => state.dump } as never,
  );
  return { service, repo, state, saved };
}

describe('GameService', () => {
  const tmp = useTempDir();
  let exe: string;
  let rom: string;

  beforeEach(async () => {
    await makeTree(tmp(), { 'Jogo/Meu Jogo.exe': 'MZ', 'Jogo/leia-me.txt': 'oi', 'roms/Aventura.sfc': 'rom', 'Outro/Outro.exe': 'MZ' });
    exe = path.join(tmp(), 'Jogo', 'Meu Jogo.exe');
    rom = path.join(tmp(), 'roms', 'Aventura.sfc');
  });

  describe('adicionar', () => {
    it('executável: título do nome do arquivo e ícone extraído do .exe', async () => {
      const { service } = setup();
      const { game, match } = await service.add({ kind: 'executable', path: exe });
      expect(game).toMatchObject({ title: 'Meu Jogo', kind: 'executable', iconUrl: art('icone-do-exe.png'), coverUrl: null });
      expect(match).toBeNull();
    });

    it.runIf(process.platform === 'win32')('executável que não é .exe/.bat/.cmd/.lnk é recusado', async () => {
      const { service } = setup();
      await expect(service.add({ kind: 'executable', path: path.join(tmp(), 'Jogo', 'leia-me.txt') })).rejects.toMatchObject({ code: 'VALIDATION' });
    });

    it('ROM já vinculada ao RetroAchievements recebe capa e ícone de lá', async () => {
      const { service } = setup();
      const { game } = await service.add({ kind: 'retroarch', path: rom, consoleId: 3, raGameId: 42, title: '  Aventura  ' });
      expect(game).toMatchObject({ title: 'Aventura', raGameId: 42, coverUrl: RA_COVER, iconUrl: RA_ICON });
    });

    it('RetroAchievements fora do ar não impede adicionar', async () => {
      const { service, state } = setup();
      state.progress = null;
      const { game } = await service.add({ kind: 'retroarch', path: rom, consoleId: 3, raGameId: 42 });
      expect(game).toMatchObject({ raGameId: 42, coverUrl: null, iconUrl: null });
    });
  });

  describe('vincular ao RetroAchievements', () => {
    it('não troca a capa personalizada nem o ícone do executável', async () => {
      const { service } = setup();
      const { game } = await service.add({ kind: 'executable', path: exe });
      service.setArtworkUrl(game.id, 'cover', art('minha-capa.png'));
      const linked = await service.update({ id: game.id, raGameId: 7 });
      expect(linked).toMatchObject({ raGameId: 7, coverUrl: art('minha-capa.png'), iconUrl: art('icone-do-exe.png') });
    });

    it('sem caixa, usa a imagem de título quando o RA não tem caixa', async () => {
      const { service, state } = setup();
      state.progress = { boxArtUrl: null, titleImageUrl: RA_TITLE, iconUrl: RA_ICON };
      const { game } = await service.add({ kind: 'retroarch', path: rom, consoleId: 3 });
      expect(await service.update({ id: game.id, raGameId: 7 })).toMatchObject({ coverUrl: RA_TITLE, iconUrl: RA_ICON });
    });

    it('desvincular tira só a arte que veio do RA', async () => {
      const { service } = setup();
      const { game } = await service.add({ kind: 'retroarch', path: rom, consoleId: 3, raGameId: 42 });
      service.setArtworkUrl(game.id, 'icon', art('meu-icone.png'));
      const unlinked = await service.update({ id: game.id, raGameId: null });
      expect(unlinked).toMatchObject({ raGameId: null, coverUrl: null, iconUrl: art('meu-icone.png') });
    });

    it('desvincular um executável mantém o ícone dele', async () => {
      const { service } = setup();
      const { game } = await service.add({ kind: 'executable', path: exe, raGameId: 42 });
      const unlinked = await service.update({ id: game.id, raGameId: null });
      expect(unlinked).toMatchObject({ coverUrl: null, iconUrl: art('icone-do-exe.png') });
    });

    it('mudar só o título não consulta o RA nem mexe na arte', async () => {
      const { service, state } = setup();
      const { game } = await service.add({ kind: 'retroarch', path: rom, consoleId: 3, raGameId: 42 });
      state.progress = null;
      expect(await service.update({ id: game.id, title: 'Novo nome', raGameId: 42 })).toMatchObject({ title: 'Novo nome', coverUrl: RA_COVER });
    });
  });

  describe('jogo que não existe', () => {
    it('editar, mover, trocar arte e remover viram NOT_FOUND', async () => {
      const { service } = setup();
      await expect(service.update({ id: 99, title: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(service.relocate(99, exe)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(() => service.setArtworkUrl(99, 'cover', art('x.png'))).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
      await expect(service.resetArtwork(99, 'cover')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(() => service.remove(99)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    });
  });

  describe('mover de pasta', () => {
    it('aponta para o arquivo novo', async () => {
      const { service } = setup();
      const { game } = await service.add({ kind: 'executable', path: exe });
      const other = path.join(tmp(), 'Outro', 'Outro.exe');
      expect((await service.relocate(game.id, other)).path).toBe(other);
    });

    it('arquivo que já é de outro jogo vira DUPLICATE (sem diferenciar maiúsculas)', async () => {
      const { service } = setup();
      const { game } = await service.add({ kind: 'executable', path: exe });
      const { game: other } = await service.add({ kind: 'executable', path: path.join(tmp(), 'Outro', 'Outro.exe') });
      await expect(service.relocate(other.id, exe.toUpperCase())).rejects.toMatchObject({ code: 'DUPLICATE' });
      expect(service.get(game.id).path).toBe(exe);
    });

    it.runIf(process.platform === 'win32')('executável não pode virar um .txt', async () => {
      const { service } = setup();
      const { game } = await service.add({ kind: 'executable', path: exe });
      await expect(service.relocate(game.id, path.join(tmp(), 'Jogo', 'leia-me.txt'))).rejects.toMatchObject({ code: 'VALIDATION' });
    });
  });

  describe('arte montada no editor', () => {
    it('ícone em PNG fica gráfico (com transparência); capa em JPEG vira foto', async () => {
      const { service, saved } = setup();
      const { game } = await service.add({ kind: 'executable', path: exe });
      expect((await service.setArtworkFromData(game.id, 'icon', PNG)).iconUrl).toBe(art('grafico.png'));
      expect((await service.setArtworkFromData(game.id, 'cover', JPEG)).coverUrl).toBe(art('foto.jpg'));
      expect(saved).toEqual(['grafico:png', 'foto:jpg']);
    });

    it('bytes que não são PNG nem JPEG são recusados', async () => {
      const { service, saved } = setup();
      const { game } = await service.add({ kind: 'executable', path: exe });
      await expect(service.setArtworkFromData(game.id, 'cover', Buffer.from('GIF89a'))).rejects.toMatchObject({ code: 'VALIDATION' });
      expect(saved).toEqual([]);
    });

    it('JPEG confere os 3 bytes da assinatura, como na importação de arquivo', async () => {
      const { service, saved } = setup();
      const { game } = await service.add({ kind: 'executable', path: exe });
      await expect(service.setArtworkFromData(game.id, 'cover', Buffer.from([0xff, 0xd8, 0x00, 0x00]))).rejects.toMatchObject({ code: 'VALIDATION' });
      expect(saved).toEqual([]);
    });

    it('arte que não está no cofre local é recusada', async () => {
      const { service } = setup();
      const { game } = await service.add({ kind: 'executable', path: exe });
      expect(() => service.setArtworkUrl(game.id, 'cover', 'https://evil.example/x.png')).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
    });
  });

  describe('voltar a arte ao padrão', () => {
    it('ícone do executável: o do dump de PS4 vence o extraído do .exe', async () => {
      const { service, state } = setup();
      const { game } = await service.add({ kind: 'executable', path: exe });
      service.setArtworkUrl(game.id, 'icon', art('meu-icone.png'));
      state.dump = { iconPath: 'C:\\dump\\sce_sys\\icon0.png', backgroundPath: null };
      expect((await service.resetArtwork(game.id, 'icon')).iconUrl).toBe(art('importada-icon0.png'));
      state.dump = null;
      expect((await service.resetArtwork(game.id, 'icon')).iconUrl).toBe(art('icone-do-exe.png'));
    });

    it('capa volta à do RA; sem vínculo, fica vazia', async () => {
      const { service } = setup();
      const { game } = await service.add({ kind: 'retroarch', path: rom, consoleId: 3, raGameId: 42 });
      service.setArtworkUrl(game.id, 'cover', art('minha-capa.png'));
      expect((await service.resetArtwork(game.id, 'cover')).coverUrl).toBe(RA_COVER);
      await service.update({ id: game.id, raGameId: null });
      expect((await service.resetArtwork(game.id, 'cover')).coverUrl).toBeNull();
    });

    it('fundo volta ao do dump, ou some', async () => {
      const { service, state } = setup();
      const { game } = await service.add({ kind: 'executable', path: exe });
      service.setArtworkUrl(game.id, 'background', art('meu-fundo.png'));
      expect((await service.resetArtwork(game.id, 'background')).backgroundUrl).toBeNull();
      state.dump = { iconPath: null, backgroundPath: 'C:\\dump\\sce_sys\\pic1.png' };
      expect((await service.resetArtwork(game.id, 'background')).backgroundUrl).toBe(art('importada-pic1.png'));
    });
  });

  describe('arte automática sem trocar a escolha do usuário', () => {
    it('dump de PS4: preenche o fundo vazio e troca só o ícone padrão do .exe', async () => {
      const { service, state } = setup();
      const { game } = await service.add({ kind: 'executable', path: exe });
      state.dump = { iconPath: 'C:\\dump\\icon0.png', backgroundPath: 'C:\\dump\\pic1.png' };
      expect(await service.applyDumpArtwork(game.id)).toMatchObject({ iconUrl: art('importada-icon0.png'), backgroundUrl: art('importada-pic1.png') });
      expect(await service.applyDumpArtwork(game.id)).toBeNull();
    });

    it('dump de PS4 não troca ícone nem fundo escolhidos', async () => {
      const { service, state } = setup();
      const { game } = await service.add({ kind: 'executable', path: exe });
      service.setArtworkUrl(game.id, 'icon', art('meu-icone.png'));
      service.setArtworkUrl(game.id, 'background', art('meu-fundo.png'));
      state.dump = { iconPath: 'C:\\dump\\icon0.png', backgroundPath: 'C:\\dump\\pic1.png' };
      expect(await service.applyDumpArtwork(game.id)).toBeNull();
      expect(await service.hasDefaultIcon(service.get(game.id))).toBe(false);
    });

    it('arte da Loja entra só onde está vazio', async () => {
      const { service } = setup();
      const { game } = await service.add({ kind: 'executable', path: exe });
      service.setArtworkUrl(game.id, 'cover', art('minha-capa.png'));
      const updated = service.applyArtworkIfMissing(game.id, { cover: art('loja-capa.png'), background: art('loja-fundo.png') });
      expect(updated).toMatchObject({ coverUrl: art('minha-capa.png'), backgroundUrl: art('loja-fundo.png') });
      expect(service.applyArtworkIfMissing(game.id, { cover: art('loja-capa.png') })).toBeNull();
    });
  });
});
