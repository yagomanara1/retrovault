import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIdBatcher } from './idBatcher';

describe('createIdBatcher', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('uma rajada vira um aviso só, sem repetir ids', () => {
    const sent: number[][] = [];
    const batch = createIdBatcher((ids) => sent.push(ids), 200);
    for (let i = 0; i < 300; i++) batch.add(i % 100);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(100);
  });

  it('ids depois do aviso abrem uma nova janela', () => {
    const sent: number[][] = [];
    const batch = createIdBatcher((ids) => sent.push(ids), 200);
    batch.add(1);
    vi.advanceTimersByTime(200);
    batch.add(2);
    batch.add(3);
    vi.advanceTimersByTime(199);
    expect(sent).toEqual([[1]]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([[1], [2, 3]]);
  });

  it('flushNow envia o pendente na hora e não repete depois', () => {
    const sent: number[][] = [];
    const batch = createIdBatcher((ids) => sent.push(ids), 200);
    batch.add(7);
    batch.flushNow();
    vi.advanceTimersByTime(500);
    batch.flushNow();
    expect(sent).toEqual([[7]]);
  });
});
