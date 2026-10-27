import type { AppUpdateState } from '@shared/appUpdate';
import { useAppUpdate, useAppUpdateActions } from '@/hooks/queries';
import { call, errorMessage } from '@/lib/api';
import { Button } from '../ui/Button';
import { ProgressBar } from '../ui/ProgressBar';
import { useToast } from '../ui/Toast';
import { AlertIcon, CheckIcon, DownloadIcon, LinkIcon, RefreshIcon } from '../ui/icons';
import { SettingsPanel } from './SettingsPanel';

/** Uma linha para a lista das Configurações (e para o resumo da seção). */
export function appUpdateSummary(state: AppUpdateState | undefined): string {
  if (!state) return 'Verificando…';
  const version = `Versão ${state.current}`;
  switch (state.phase) {
    case 'disabled':
      return `${version} · atualização automática só no app instalado`;
    case 'checking':
      return `${version} · procurando versão nova…`;
    case 'downloading':
      return `${version} · baixando a ${state.version} (${state.percent ?? 0}%)`;
    case 'ready':
      return `${version} · ${state.version} pronta para instalar`;
    case 'up-to-date':
      return `${version} · em dia`;
    case 'error':
      return `${version} · não deu para conferir agora`;
    default:
      return version;
  }
}

function formatCheckedAt(ms: number | undefined): string | null {
  if (!ms) return null;
  return new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Versão em uso, busca manual e instalação da versão nova (publicada nas Releases do GitHub). */
export function AppUpdateSection() {
  const { data: state } = useAppUpdate();
  const { check, install } = useAppUpdateActions();
  const toast = useToast();

  if (!state) return null;
  const checkedAt = formatCheckedAt(state.checkedAt);
  const busy = state.phase === 'checking' || state.phase === 'downloading' || check.isPending;

  return (
    <SettingsPanel
      id="app-update"
      title="Atualizações do RetroVault"
      actions={
        <Button variant="ghost" size="sm" icon={<LinkIcon size={14} />} onClick={() => void call('app:open-external', state.releasesUrl)}>
          Notas das versões
        </Button>
      }
    >
      <p className="muted">
        Você está na versão <strong>{state.current}</strong>. O RetroVault confere se há versão nova ao abrir e a cada 6 horas, baixa em segundo
        plano e confere o arquivo antes de instalar. Seus jogos, troféus e configurações continuam onde estão.
      </p>

      <ul className="status-list">
        {state.phase === 'disabled' && (
          <li className="status-line status-line--warn">
            <AlertIcon size={16} />
            <span>{state.message}</span>
          </li>
        )}
        {state.phase === 'up-to-date' && (
          <li className="status-line status-line--ok">
            <CheckIcon size={16} />
            <span>Você já está na versão mais recente{checkedAt ? ` (conferido em ${checkedAt})` : ''}.</span>
          </li>
        )}
        {state.phase === 'error' && (
          <li className="status-line status-line--warn">
            <AlertIcon size={16} />
            <span>{state.message}</span>
          </li>
        )}
        {state.phase === 'ready' && (
          <li className="status-line status-line--ok">
            <DownloadIcon size={16} />
            <span>A versão {state.version} já foi baixada e conferida. Ela entra ao reiniciar, ou quando você fechar o app.</span>
          </li>
        )}
      </ul>

      {state.phase === 'downloading' && (
        <ProgressBar
          value={state.percent ?? 0}
          max={100}
          label={`Baixando a versão ${state.version}`}
          valueText={`Baixando a versão ${state.version}: ${state.percent ?? 0}%`}
        />
      )}

      {state.phase !== 'disabled' && (
        <div className="form__actions form__actions--start">
          {state.phase === 'ready' ? (
            <Button
              variant="primary"
              icon={<DownloadIcon size={16} />}
              loading={install.isPending}
              onClick={() =>
                install.mutate(undefined, {
                  onError: (err) => toast.push({ tone: 'error', title: 'Não foi possível atualizar agora', description: errorMessage(err) }),
                })
              }
            >
              Reiniciar e atualizar para {state.version}
            </Button>
          ) : (
            <Button
              icon={<RefreshIcon size={16} />}
              loading={busy}
              onClick={() =>
                check.mutate(undefined, {
                  onError: (err) => toast.push({ tone: 'error', title: 'Não foi possível procurar', description: errorMessage(err) }),
                })
              }
            >
              {state.phase === 'downloading' ? 'Baixando…' : 'Procurar agora'}
            </Button>
          )}
        </div>
      )}
    </SettingsPanel>
  );
}
