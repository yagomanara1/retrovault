import { useState, type FormEvent } from 'react';
import type { Settings } from '@shared/types';
import { useUpdateSettings } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { Button } from '../ui/Button';
import { TextField } from '../ui/Form';
import { useToast } from '../ui/Toast';
import { SettingsPanel } from './SettingsPanel';

const TROPHY_KEY_PATTERN = /^[0-9a-fA-F]{32}$/;

export function TrophyKeySection({ settings }: { settings: Settings }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateSettings();
  const toast = useToast();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = key.trim();
    if (!TROPHY_KEY_PATTERN.test(value)) {
      setError('A trophy key tem 32 caracteres hexadecimais (0–9, A–F).');
      return;
    }
    setError(null);
    try {
      await update.mutateAsync({ trophyKey: value });
      setKey('');
      toast.push({ tone: 'success', title: 'Trophy key salva', description: 'Agora você pode importar troféus de jogos de PS4.' });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <SettingsPanel id="trophy-key" title="Troféus de PS4">
      <p className="muted">
        Os nomes e descrições dos troféus no <code>trophy00.trp</code> são criptografados. Assim como no shadPS4, é
        preciso a trophy key (ReleaseTrophyKey) do seu próprio console. Ela fica cifrada pelo Windows e nunca é exibida.
      </p>
      <form className="form" onSubmit={submit} noValidate>
        <TextField
          label="Trophy key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(e) => setKey(e.target.value.replace(/\s/g, ''))}
          placeholder={settings.hasTrophyKey ? '•••••••• (salva)' : '32 caracteres hexadecimais'}
          maxLength={32}
          error={error}
        />
        <div className="form__actions form__actions--start">
          <Button type="submit" variant="primary" loading={update.isPending} disabled={!key}>
            Salvar chave
          </Button>
          {settings.hasTrophyKey && (
            <Button
              variant="ghost"
              onClick={() =>
                update.mutate(
                  { trophyKey: '' },
                  { onSuccess: () => toast.push({ tone: 'info', title: 'Trophy key removida' }) },
                )
              }
            >
              Remover chave
            </Button>
          )}
        </div>
      </form>
    </SettingsPanel>
  );
}
