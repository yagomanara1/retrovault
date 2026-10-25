import { describe, expect, it } from 'vitest';
import { createTreeState, type ProcessInfo, updateTree } from './processTree';

const T0 = 1_000_000;
const GAME_DIR = 'C:\\Jogos\\Gow\\gow3-windows';
const proc = (pid: number, ppid: number, createdAt: number, exe: string | null = null): ProcessInfo => ({ pid, ppid, createdAt, exe });

describe('updateTree', () => {
  it('inclui filhos e netos do processo raiz criados depois do início', () => {
    const s = createTreeState(10, T0, null);
    const alive = updateTree(s, [proc(10, 1, T0), proc(20, 10, T0 + 500), proc(30, 20, T0 + 900), proc(99, 1, T0 + 100)]);
    expect([...alive].sort()).toEqual([10, 20, 30]);
  });

  it('mantém órfãos: o launcher fechou, mas o jogo (PPID do pai morto) segue vivo', () => {
    const s = createTreeState(10, T0, null);
    updateTree(s, [proc(10, 1, T0), proc(20, 10, T0 + 500)]);
    s.rootExitedAt = T0 + 1000;
    const alive = updateTree(s, [proc(20, 10, T0 + 500)]);
    expect([...alive]).toEqual([20]);
  });

  it('adota filho de um pai morto mesmo que o pai nunca tenha sido visto vivo com ele', () => {
    const s = createTreeState(10, T0, null);
    s.rootExitedAt = T0 + 300;
    expect([...updateTree(s, [proc(20, 10, T0 + 200)])]).toEqual([20]);
  });

  it('ignora reuso de PID: processo criado antes da sessão com PPID coincidente', () => {
    const s = createTreeState(10, T0, null);
    expect([...updateTree(s, [proc(10, 1, T0), proc(55, 10, T0 - 60_000)])]).toEqual([10]);
  });

  it('heurística de pasta: jogo aberto por outro caminho (WMI) enquanto o launcher estava aberto', () => {
    const s = createTreeState(10, T0, GAME_DIR);
    const probe = proc(40, 777, T0 + 800, `${GAME_DIR}\\bin\\gow3-probe.exe`);
    expect(updateTree(s, [proc(10, 1, T0), probe]).has(40)).toBe(true);
  });

  it('heurística de pasta não adota processos criados depois que o launcher fechou', () => {
    const s = createTreeState(10, T0, GAME_DIR);
    s.rootExitedAt = T0 + 1000;
    const late = proc(41, 777, T0 + 10_000, `${GAME_DIR}\\outro.exe`);
    expect(updateTree(s, [late]).size).toBe(0);
  });

  it('compara pastas sem diferenciar maiúsculas nem separadores', () => {
    const s = createTreeState(10, T0, 'C:/Jogos/Gow/GOW3-WINDOWS');
    expect(updateTree(s, [proc(42, 777, T0 + 10, `${GAME_DIR}\\bin\\x.exe`)]).has(42)).toBe(true);
  });

  it('desliga a heurística em pastas rasas (C:\\Jogos pegaria processos alheios)', () => {
    const s = createTreeState(10, T0, 'C:\\Jogos');
    expect(s.gameDir).toBeNull();
  });
});
