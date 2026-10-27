import type { ReactNode } from 'react';
import type { Settings } from '@shared/types';
import { useRetroArchStatus, useUpdateSettings } from '@/hooks/queries';
import { call, errorMessage } from '@/lib/api';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';
import { AlertIcon, CheckIcon, FolderIcon, RefreshIcon } from '../ui/icons';
import { SettingsPanel } from './SettingsPanel';

function StatusLine({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className={ok ? 'status-line status-line--ok' : 'status-line status-line--warn'}>
      {ok ? <CheckIcon size={16} /> : <AlertIcon size={16} />}
      <span>{children}</span>
    </li>
  );
}

export function RetroArchSection({ settings }: { settings: Settings }) {
  const { data: status, isFetching, refetch } = useRetroArchStatus();
  const update = useUpdateSettings();
  const toast = useToast();

  async function browse() {
    try {
      const file = await call('dialog:open-file', { kind: 'retroarch' });
      if (file) await update.mutateAsync({ retroarchPath: file });
    } catch (err) {
      toast.push({ tone: 'error', title: 'Falha ao salvar caminho', description: errorMessage(err) });
    }
  }

  const accountMismatch =
    status?.loggedInAs && settings.raUsername && status.loggedInAs.toLowerCase() !== settings.raUsername.toLowerCase();

  return (
    <SettingsPanel
      id="retroarch"
      title="RetroArch"
      actions={
        <Button variant="ghost" size="sm" icon={<RefreshIcon />} loading={isFetching} onClick={() => void refetch()}>
          Verificar novamente
        </Button>
      }
    >

      <div className="file-picker">
        <span className="file-picker__path" title={status?.exePath ?? undefined}>
          {status?.exePath ?? settings.retroarchPath ?? 'Detectando automaticamente…'}
        </span>
        <Button icon={<FolderIcon />} onClick={() => void browse()} loading={update.isPending}>
          Procurar…
        </Button>
        {settings.retroarchPath && (
          <Button variant="ghost" onClick={() => update.mutate({ retroarchPath: null })}>
            Detectar automaticamente
          </Button>
        )}
      </div>

      {status && (
        <ul className="status-list">
          <StatusLine ok={status.found}>
            {status.found ? 'RetroArch encontrado.' : 'RetroArch não encontrado. Instale-o (retroarch.com) ou indique o retroarch.exe.'}
          </StatusLine>
          {status.found && (
            <>
              <StatusLine ok={status.cores.length > 0}>
                {status.cores.length > 0
                  ? `${status.cores.length} cores instalados.`
                  : 'Nenhum core instalado. No RetroArch: Menu principal → Online Updater → Core Downloader.'}
              </StatusLine>
              <StatusLine ok={Boolean(status.loggedInAs)}>
                {status.loggedInAs
                  ? `Conquistas: RetroArch logado como ${status.loggedInAs}.`
                  : 'RetroArch não está logado no RetroAchievements. Abra o RetroArch → Configurações → Conquistas, ative-as e informe usuário e senha (só uma vez).'}
              </StatusLine>
              {accountMismatch && (
                <StatusLine ok={false}>
                  A conta logada no RetroArch ({status.loggedInAs}) é diferente da configurada aqui ({settings.raUsername}).
                  Os desbloqueios irão para a conta do RetroArch.
                </StatusLine>
              )}
            </>
          )}
        </ul>
      )}
    </SettingsPanel>
  );
}
