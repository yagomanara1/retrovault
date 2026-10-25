import { useState } from 'react';
import { useAppUpdate, useAppUpdateActions } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';
import { DownloadIcon } from '../ui/icons';

/**
 * Faixa flutuante, em qualquer tela, quando uma versão nova do RetroVault já foi baixada. "Depois"
 * esconde até a próxima abertura; fechar o app também instala.
 */
export function AppUpdateBanner() {
  const { data: update } = useAppUpdate();
  const { install } = useAppUpdateActions();
  const toast = useToast();
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);

  if (update?.phase !== 'ready' || !update.version || hiddenFor === update.version) return null;

  return (
    <div className="app-update" role="status" aria-live="polite">
      <DownloadIcon size={16} aria-hidden="true" />
      <p className="app-update__text">
        <strong>RetroVault {update.version}</strong> está pronto para instalar.
        <span className="app-update__hint"> Se preferir, ele instala sozinho quando você fechar o app.</span>
      </p>
      <Button
        size="sm"
        variant="primary"
        loading={install.isPending}
        onClick={() =>
          install.mutate(undefined, {
            onError: (err) => toast.push({ tone: 'error', title: 'Não foi possível atualizar agora', description: errorMessage(err) }),
          })
        }
      >
        Reiniciar e atualizar
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setHiddenFor(update.version!)}>
        Depois
      </Button>
    </div>
  );
}
