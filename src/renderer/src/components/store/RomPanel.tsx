import { useState } from 'react';
import type { StorePort } from '@shared/store';
import { useRomSetup, useRomStatus } from '@/hooks/queries';
import { call, errorMessage } from '@/lib/api';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/States';
import { useToast } from '../ui/Toast';
import { AlertIcon, CheckIcon, FolderIcon } from '../ui/icons';

const ACTION_TOAST = {
  copied: 'ROM conferida e colocada na pasta do port. É só jogar.',
  converted: 'ROM conferida. Como ela não estava em .z64, o RetroVault criou uma cópia convertida para você selecionar.',
  verified: 'ROM conferida. Selecione este arquivo quando o port pedir.',
} as const;

/**
 * Assistente de ROM do port instalado: mostra se a cópia do usuário está pronta, confere a versão
 * (hash oficial do projeto) e a entrega do jeito que o port espera.
 */
export function RomPanel({ port }: { port: StorePort }) {
  const setup = port.setup;
  const toast = useToast();
  const { data: status, isLoading } = useRomStatus(port.id, !!setup);
  const romSetup = useRomSetup(port.id);
  const [error, setError] = useState<string | null>(null);
  if (!setup) return null;

  const canChoose = !!setup.accepted?.length;
  const choose = () => {
    setError(null);
    romSetup.mutate(undefined, {
      onSuccess: (result) => result && toast.push({ tone: 'success', title: `${port.name}: ${result.status.versionName}`, description: ACTION_TOAST[result.action] }),
      onError: (err) => setError(errorMessage(err)),
    });
  };

  const ready = status?.state === 'ready' || status?.state === 'verified';
  return (
    <section className="rom-panel" aria-labelledby={`rom-${port.id}`} aria-busy={isLoading}>
      <h3 id={`rom-${port.id}`} className="rom-panel__title">
        {port.requires.kind === 'rom' ? 'ROM do jogo' : 'Arquivos do jogo'}
      </h3>
      {isLoading ? (
        <Skeleton className="rom-panel__skeleton" />
      ) : (
        <>
          {canChoose && (
            <p className={ready ? 'rom-panel__state rom-panel__state--ok' : 'rom-panel__state rom-panel__state--missing'}>
              {ready ? <CheckIcon size={16} /> : <AlertIcon size={16} />}
              {status?.state === 'ready' && <span>ROM pronta ({status.versionName}). É só jogar.</span>}
              {status?.state === 'verified' && <span>ROM conferida ({status.versionName}).</span>}
              {status?.state === 'missing' &&
                (setup.method === 'copy' ? (
                  <span>Falta a ROM: escolha a sua cópia e o RetroVault coloca no lugar certo.</span>
                ) : (
                  <span>Ainda não conferida. Opcional, mas evita surpresa: o RetroVault confere a versão antes de você abrir.</span>
                ))}
            </p>
          )}
          <p className="rom-panel__instructions">{setup.instructions}</p>
          {status?.state === 'verified' && status.fileToSelect && (
            <p className="rom-panel__file">
              Quando o port pedir, selecione: <code>{status.fileToSelect}</code>
            </p>
          )}
          {canChoose && (
            <div className="rom-panel__actions">
              <Button variant={ready ? 'secondary' : 'primary'} loading={romSetup.isPending} onClick={choose}>
                {ready ? 'Trocar ROM…' : setup.method === 'copy' ? 'Escolher minha ROM…' : 'Conferir minha ROM…'}
              </Button>
              {status?.state === 'verified' && status.fileToSelect && (
                <Button variant="ghost" icon={<FolderIcon size={16} />} onClick={() => void call('store:rom-show', port.id)}>
                  Mostrar arquivo
                </Button>
              )}
            </div>
          )}
          {error && (
            <p className="rom-panel__error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
