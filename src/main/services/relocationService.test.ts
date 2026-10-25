import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTree, useTempDir } from '../testing/tempDir';
import { findMovedFile, pickCandidate, suffixScore } from './relocationService';

describe('suffixScore', () => {
  it('conta as partes finais iguais, sem diferenciar maiúsculas', () => {
    expect(suffixScore('C:\\a\\Jogos\\Gow\\x\\G.exe', 'C:\\a\\Gow\\x\\g.EXE')).toBe(3);
    expect(suffixScore('C:\\b\\G.exe', 'C:\\a\\G.exe')).toBe(1);
    expect(suffixScore('C:\\b\\H.exe', 'C:\\a\\G.exe')).toBe(0);
  });
});

describe('pickCandidate', () => {
  it('escolhe o melhor só se for único e atingir a pontuação mínima', () => {
    expect(pickCandidate([{ path: 'a', score: 4 }, { path: 'b', score: 1 }], 2)?.path).toBe('a');
    expect(pickCandidate([{ path: 'a', score: 2 }, { path: 'b', score: 2 }], 1)).toBeNull(); // empate
    expect(pickCandidate([{ path: 'a', score: 1 }], 2)).toBeNull(); // só o nome igual: fraco demais para o automático
    expect(pickCandidate([], 1)).toBeNull();
  });
});

describe('findMovedFile', () => {
  const tmp = useTempDir();

  it('acha o jogo movido para uma subpasta nova (caso real: Desktop\\Gow → Desktop\\Jogos\\Gow)', async () => {
    await makeTree(tmp(), { 'Desktop/Jogos/Gow/gow3-windows/God of War III.exe': 'x', 'Desktop/Outro/README.txt': 'x' });
    const old = path.join(tmp(), 'Desktop/Gow/gow3-windows/God of War III.exe');
    const [best, ...rest] = await findMovedFile(old, []);
    expect(best?.path).toBe(path.join(tmp(), 'Desktop/Jogos/Gow/gow3-windows/God of War III.exe'));
    expect(best?.score).toBe(3);
    expect(rest).toHaveLength(0);
  });

  it('ordena por pontuação quando há arquivos com o mesmo nome', async () => {
    await makeTree(tmp(), { 'Lib/A/Jogo/main.exe': 'x', 'Lib/B/Outro/main.exe': 'x' });
    const r = await findMovedFile(path.join(tmp(), 'Velho/Jogo/main.exe'), [path.join(tmp(), 'Lib')]);
    expect(r.map((c) => [path.relative(tmp(), c.path), c.score])).toEqual([
      [path.join('Lib/A/Jogo/main.exe'), 2],
      [path.join('Lib/B/Outro/main.exe'), 1],
    ]);
  });

  it('não varre pastas de cache/saves nem devolve nada quando o arquivo sumiu de vez', async () => {
    await makeTree(tmp(), { 'Lib/Jogo/savedata/fantasma.exe': 'x' });
    expect(await findMovedFile(path.join(tmp(), 'Velho/fantasma.exe'), [path.join(tmp(), 'Lib')])).toEqual([]);
  });
});
