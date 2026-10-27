import { useState } from 'react';
import type { BackupInfo, BackupKind } from '@shared/types';
import { useBackups, useCreateBackup, useExportProgress, useImportProgress, useRestoreBackup } from '@/hooks/queries';
import { call, errorMessage } from '@/lib/api';
import { formatBytes, formatDateTime } from '@/lib/format';
import { Button } from '../ui/Button';
import { ErrorState, Skeleton } from '../ui/States';
import { useToast } from '../ui/Toast';
import { FolderIcon, PlusIcon, RefreshIcon } from '../ui/icons';
import { SettingsPanel } from './SettingsPanel';

const KIND_LABEL: Record<BackupKind, string> = {
  auto: 'Automático',
  manual: 'Manual',
  'pre-migration': 'Antes de atualizar',
  'pre-restore': 'Antes de restaurar',
};

/**
 * Backups automáticos do banco (biblioteca, tempo de jogo, troféus) e exportação do progresso
 * em JSON, que sobrevive a reinstalar o Windows ou o RetroVault.
 */
export function BackupSection() {
  const toast = useToast();
  const { data: backups, isLoading, isError, error, refetch } = useBackups();
  const create = useCreateBackup();
  const exportProgress = useExportProgress();
  const importProgress = useImportProgress();

  const fail = (title: string) => (err: unknown) => toast.push({ tone: 'error', title, description: errorMessage(err) });

  function handleImport() {
    importProgress.mutate(undefined, {
      onSuccess: (result) => {
        if (!result) return;
        const missing = result.gamesNotFound.length;
        toast.push({
          tone: result.gamesMatched > 0 ? 'success' : 'info',
          title: `${result.trophiesRestored} troféus restaurados`,
          description:
            `${result.gamesMatched} jogo(s) reconhecido(s), ${result.playtimeUpdated} com tempo de jogo atualizado.` +
            (missing ? ` Não estão na biblioteca: ${result.gamesNotFound.slice(0, 3).join(', ')}${missing > 3 ? '…' : ''}.` : ''),
        });
      },
      onError: fail('Falha ao importar'),
    });
  }

  return (
    <SettingsPanel
      id="backup"
      title="Backup e progresso"
      actions={
        <Button variant="ghost" size="sm" icon={<FolderIcon size={14} />} onClick={() => void call('backup:open-folder').catch(fail('Falha ao abrir a pasta'))}>
          Abrir pasta
        </Button>
      }
    >
      <p className="muted">
        Seus troféus e o tempo de jogo existem só aqui. O RetroVault faz um backup automático por dia (guarda os últimos 7)
        e outro antes de cada atualização. Para levar o progresso para outro PC ou guardar fora deste, exporte-o.
      </p>

      <div className="form__actions form__actions--start">
        <Button
          icon={<PlusIcon size={16} />}
          loading={create.isPending}
          onClick={() =>
            create.mutate(undefined, {
              onSuccess: (b) => toast.push({ tone: 'success', title: 'Backup criado', description: `${b.name} · ${formatBytes(b.sizeBytes)}` }),
              onError: fail('Falha ao criar backup'),
            })
          }
        >
          Fazer backup agora
        </Button>
        <Button
          loading={exportProgress.isPending}
          onClick={() =>
            exportProgress.mutate(undefined, {
              onSuccess: (file) => file && toast.push({ tone: 'success', title: 'Progresso exportado', description: file }),
              onError: fail('Falha ao exportar'),
            })
          }
        >
          Exportar progresso…
        </Button>
        <Button loading={importProgress.isPending} onClick={handleImport}>
          Importar progresso…
        </Button>
      </div>

      <h3 className="section-title backup-list__title">Backups</h3>
      {isLoading ? (
        <Skeleton className="skeleton--sidebar" />
      ) : isError ? (
        <ErrorState compact message={errorMessage(error)} onRetry={() => void refetch()} />
      ) : !backups?.length ? (
        <p className="muted">Nenhum backup ainda. O primeiro é criado automaticamente hoje.</p>
      ) : (
        <ul className="backup-list">
          {backups.map((b) => (
            <BackupRow key={b.name} backup={b} />
          ))}
        </ul>
      )}
    </SettingsPanel>
  );
}

/** Restaurar substitui a biblioteca inteira: exige uma segunda confirmação e reinicia o app. */
function BackupRow({ backup }: { backup: BackupInfo }) {
  const toast = useToast();
  const restore = useRestoreBackup();
  const [confirming, setConfirming] = useState(false);

  function handleRestore() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    restore.mutate(backup.name, {
      onSuccess: () => toast.push({ tone: 'info', title: 'Restaurando…', description: 'O RetroVault vai reiniciar.' }),
      onError: (err) => {
        setConfirming(false);
        toast.push({ tone: 'error', title: 'Falha ao restaurar', description: errorMessage(err) });
      },
    });
  }

  return (
    <li className="backup-list__item">
      <div className="backup-list__info">
        <strong>{formatDateTime(backup.createdAt)}</strong>
        <span className="muted">
          {KIND_LABEL[backup.kind]} · {formatBytes(backup.sizeBytes)}
        </span>
      </div>
      {confirming && (
        <span className="backup-list__warning" role="alert">
          O estado atual será guardado e substituído.
        </span>
      )}
      <div className="backup-list__actions">
        {confirming && (
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={restore.isPending}>
            Cancelar
          </Button>
        )}
        <Button
          size="sm"
          variant={confirming ? 'danger' : 'ghost'}
          icon={<RefreshIcon size={14} />}
          loading={restore.isPending}
          onClick={handleRestore}
          aria-label={confirming ? `Confirmar restauração do backup de ${formatDateTime(backup.createdAt)}` : `Restaurar backup de ${formatDateTime(backup.createdAt)}`}
        >
          {confirming ? 'Confirmar e reiniciar' : 'Restaurar'}
        </Button>
      </div>
    </li>
  );
}
