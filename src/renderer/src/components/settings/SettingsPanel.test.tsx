// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsPanel } from './SettingsPanel';

afterEach(cleanup);

describe('SettingsPanel', () => {
  it('é uma região com o nome do título, e as ações ficam no cabeçalho', () => {
    render(
      <SettingsPanel id="saves" title="Cofre de saves" actions={<button type="button">Abrir pasta</button>}>
        <p>conteúdo</p>
      </SettingsPanel>,
    );
    const region = screen.getByRole('region', { name: 'Cofre de saves' });
    expect(region.querySelector('header')?.textContent).toContain('Abrir pasta');
    expect(screen.getByRole('heading', { level: 2, name: 'Cofre de saves' }).id).toBe('saves-heading');
    expect(region.textContent).toContain('conteúdo');
  });

  it('sem ações, o cabeçalho só tem o título', () => {
    render(<SettingsPanel id="prefs" title="Preferências">x</SettingsPanel>);
    expect(screen.getByRole('region', { name: 'Preferências' }).querySelector('header')?.children).toHaveLength(1);
  });
});
