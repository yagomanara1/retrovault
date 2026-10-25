import type { CloudProvider } from '@shared/types';
import { useCloudProviders, useConnectCloud, useDisconnectCloud, useStartCloudClient } from '@/hooks/queries';
import { call, errorMessage } from '@/lib/api';
import { cx } from '@/lib/cx';
import { Button } from '../ui/Button';
import { ErrorState, Skeleton } from '../ui/States';
import { useToast } from '../ui/Toast';
import { AlertIcon, CheckIcon } from '../ui/icons';

/**
 * Nuvem pelo app de sincronização que já está no PC: o cofre vai para dentro da pasta do
 * OneDrive / Google Drive / Dropbox e o próprio app envia. Sem login nem token no RetroVault.
 */
export function CloudProviders() {
  const { data, isLoading, isError, error, refetch } = useCloudProviders();

  if (isLoading) return <Skeleton className="skeleton--row" />;
  if (isError) return <ErrorState compact message={errorMessage(error)} onRetry={() => void refetch()} />;
  if (!data?.length) return <p className="muted">Disponível apenas no Windows.</p>;

  const connected = data.find((p) => p.connected) ?? null;
  return (
    <div className="cloud">
      <h3 className="section-title">Nuvem</h3>
      <p className="muted cloud__intro">
        Os saves e o seu progresso (troféus e tempo de jogo) vão para a pasta do serviço escolhido, e o aplicativo dele envia
        para a nuvem. Funciona em outro PC: conecte o mesmo serviço lá e os backups aparecem.
      </p>
      <ul className="cloud__list">
        {data.map((p) => (
          <ProviderCard key={p.id} provider={p} otherConnected={!!connected && !p.connected} />
        ))}
      </ul>
    </div>
  );
}

function ProviderCard({ provider: p, otherConnected }: { provider: CloudProvider; otherConnected: boolean }) {
  const toast = useToast();
  const connect = useConnectCloud();
  const disconnect = useDisconnectCloud();
  const start = useStartCloudClient();
  const installed = !!p.folder;
  const fail = (title: string) => (err: unknown) => toast.push({ tone: 'error', title, description: errorMessage(err) });

  const status = !installed
    ? { tone: 'muted', text: 'Não instalado neste PC' }
    : p.connected && p.running
      ? { tone: 'ok', text: 'Conectado · sincronizando' }
      : p.connected
        ? { tone: 'warn', text: `Conectado, mas o ${p.name} está fechado: nada sobe para a nuvem até você abri-lo` }
        : p.running
          ? { tone: 'muted', text: 'Disponível' }
          : { tone: 'muted', text: `Disponível (o ${p.name} está fechado)` };

  return (
    <li className={cx('cloud-card', p.connected && 'cloud-card--connected')}>
      <div className="cloud-card__info">
        <strong>{p.name}</strong>
        {p.account && <span className="muted">{p.account}</span>}
        {p.folder && (
          <span className="muted cloud-card__folder" title={p.folder}>
            {p.folder}
          </span>
        )}
        <span className={cx('cloud-card__status', `cloud-card__status--${status.tone}`)} role={status.tone === 'warn' ? 'alert' : undefined}>
          {status.tone === 'ok' && <CheckIcon size={14} />}
          {status.tone === 'warn' && <AlertIcon size={14} />}
          {status.text}
        </span>
      </div>
      <div className="cloud-card__actions">
        {!installed ? (
          <Button size="sm" variant="ghost" onClick={() => void call('app:open-external', p.downloadUrl)}>
            Baixar {p.name}
          </Button>
        ) : (
          <>
            {!p.running && p.canStart && (
              <Button
                size="sm"
                variant={p.connected ? 'primary' : 'ghost'}
                loading={start.isPending}
                onClick={() =>
                  start.mutate(p.id, {
                    onSuccess: () => toast.push({ tone: 'info', title: `Abrindo o ${p.name}…`, description: 'A sincronização começa em alguns segundos.' }),
                    onError: fail(`Não foi possível abrir o ${p.name}`),
                  })
                }
              >
                Abrir {p.name}
              </Button>
            )}
            {p.connected ? (
              <Button
                size="sm"
                variant="ghost"
                loading={disconnect.isPending}
                onClick={() =>
                  disconnect.mutate(undefined, {
                    onSuccess: () =>
                      toast.push({ tone: 'info', title: 'Cofre de volta no PC', description: `A cópia no ${p.name} foi mantida.` }),
                    onError: fail('Falha ao desconectar'),
                  })
                }
              >
                Desconectar
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                loading={connect.isPending}
                onClick={() =>
                  connect.mutate(p.id, {
                    onSuccess: (r) =>
                      toast.push({
                        tone: 'success',
                        title: `Saves agora no ${p.name}`,
                        description: `Cofre em ${r.settings.savesRoot}.${p.running ? '' : ` Abra o ${p.name} para enviar para a nuvem.`}`,
                      }),
                    onError: fail(`Falha ao conectar ao ${p.name}`),
                  })
                }
              >
                {otherConnected ? `Mudar para o ${p.name}` : `Usar ${p.name}`}
              </Button>
            )}
          </>
        )}
      </div>
    </li>
  );
}
