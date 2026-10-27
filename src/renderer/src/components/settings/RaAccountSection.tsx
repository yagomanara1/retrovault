import { useState, type FormEvent } from 'react';
import type { Settings } from '@shared/types';
import { useUpdateSettings } from '@/hooks/queries';
import { call, errorMessage } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { Button } from '../ui/Button';
import { TextField } from '../ui/Form';
import { useToast } from '../ui/Toast';
import { SettingsPanel } from './SettingsPanel';

const RA_SETTINGS_URL = 'https://retroachievements.org/settings';

export function RaAccountSection({ settings }: { settings: Settings }) {
  const [username, setUsername] = useState(settings.raUsername ?? '');
  const [apiKey, setApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateSettings();
  const toast = useToast();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!username.trim()) {
      setError('Informe seu usuário do RetroAchievements.');
      return;
    }
    if (!apiKey.trim() && !settings.hasApiKey) {
      setError('Informe sua Web API Key.');
      return;
    }
    try {
      const newKey = apiKey.trim();
      await update.mutateAsync(newKey ? { raUsername: username.trim(), raApiKey: newKey } : { raUsername: username.trim() });
      setApiKey('');
      setTesting(true);
      const profile = await call('ra:profile', { force: true });
      toast.push({
        tone: 'success',
        title: `Conectado como ${profile.username}`,
        description: `${formatNumber(profile.totalPoints)} pontos no RetroAchievements.`,
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setTesting(false);
    }
  }

  async function clearKey() {
    await update.mutateAsync({ raApiKey: '' });
    toast.push({ tone: 'info', title: 'API key removida' });
  }

  return (
    <SettingsPanel id="ra" title="Conta do RetroAchievements">
      <p className="muted">
        O RetroArch registra conquistas na sua conta do RetroAchievements. O launcher usa a Web API (somente leitura)
        para exibir seu progresso. Sua chave fica cifrada no sistema (DPAPI do Windows).
      </p>
      <form className="form" onSubmit={submit} noValidate>
        <div className="form__row">
          <TextField
            label="Usuário"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={64}
          />
          <TextField
            label="Web API Key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={settings.hasApiKey ? '•••••••• (salva)' : 'Cole sua chave aqui'}
            hint={
              <>
                Encontre em{' '}
                <a href={RA_SETTINGS_URL} target="_blank" rel="noreferrer">
                  retroachievements.org/settings
                </a>{' '}
                → “Keys”.
              </>
            }
          />
        </div>
        {error && (
          <p className="form__error" role="alert">
            {error}
          </p>
        )}
        <div className="form__actions form__actions--start">
          <Button type="submit" variant="primary" loading={update.isPending || testing}>
            Salvar e testar conexão
          </Button>
          {settings.hasApiKey && (
            <Button variant="ghost" onClick={() => void clearKey()}>
              Remover chave
            </Button>
          )}
        </div>
      </form>
    </SettingsPanel>
  );
}
