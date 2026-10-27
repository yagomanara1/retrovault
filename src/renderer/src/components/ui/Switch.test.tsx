// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Switch } from './Form';

afterEach(cleanup);

describe('Switch', () => {
  it('acessível: papel de interruptor, rótulo e descrição ligados ao controle', async () => {
    const onChange = vi.fn();
    render(<Switch label="Modo Hardcore" description="Sem save states." checked={false} onChange={onChange} />);
    const control = screen.getByRole('switch', { name: 'Modo Hardcore' });
    expect(control.getAttribute('aria-checked')).toBe('false');
    expect(document.getElementById(control.getAttribute('aria-describedby')!)?.textContent).toBe('Sem save states.');
    await userEvent.click(screen.getByText('Modo Hardcore')); // clicar no rótulo também alterna
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('desativado não muda', async () => {
    const onChange = vi.fn();
    render(<Switch label="Backup" checked onChange={onChange} disabled />);
    await userEvent.click(screen.getByRole('switch', { name: 'Backup' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
