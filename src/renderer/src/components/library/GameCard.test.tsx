// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import type { CompletionEntry, Game } from '@shared/types';
import { GameCard } from './GameCard';

afterEach(cleanup);

const game = { id: 42, title: 'Ship of Harkinian', coverUrl: null, iconUrl: null, playtimeSeconds: 3600 } as Game;
const renderCard = (props: Partial<Parameters<typeof GameCard>[0]> = {}) =>
  render(
    <MemoryRouter>
      <GameCard game={game} {...props} />
    </MemoryRouter>,
  );

describe('GameCard', () => {
  it('é um link para a página do jogo, com título e tempo jogado', () => {
    renderCard();
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/game/42');
    expect(link.textContent).toContain('Ship of Harkinian');
    expect(screen.queryByText('Em execução')).toBeNull();
  });

  it('"Em execução" tem prioridade sobre "Não encontrado"', () => {
    renderCard({ running: true, missing: true });
    expect(screen.getByText('Em execução')).toBeTruthy();
    expect(screen.queryByText('Não encontrado')).toBeNull();
    cleanup();
    renderCard({ missing: true });
    expect(screen.getByText('Não encontrado')).toBeTruthy();
  });

  it('progresso de conquistas só quando o jogo tem conquistas', () => {
    renderCard({ progress: { numAwarded: 3, maxPossible: 10 } as CompletionEntry });
    expect(screen.getByRole('progressbar', { name: 'Conquistas de Ship of Harkinian' })).toBeTruthy();
    expect(screen.getByText('3/10')).toBeTruthy();
    cleanup();
    renderCard({ progress: { numAwarded: 0, maxPossible: 0 } as CompletionEntry });
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
