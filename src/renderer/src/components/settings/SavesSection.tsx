import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Settings } from '@shared/types';
import { qk, useUpdateSettings } from '@/hooks/queries';
import { call, errorMessage } from '@/lib/api';
import { Button } from '../ui/Button';
import { Switch } from '../ui/Form';
import { useToast } from '../ui/Toast';
import { FolderIcon } from '../ui/icons';
import { CloudProviders } from './CloudProviders';
import { SettingsPanel } from './SettingsPanel';

/** Pasta do cofre de saves (pode ser uma pasta do OneDrive/Google Drive) e backup automático. */
export function SavesSection({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  const qc = useQueryClient();
  const toast = useToast();
  const [moving, setMoving] = useState(false);

  async function chooseRoot() {
    setMoving(true);
    try {
      const next = await call('saves:choose-root');
      if (!next) return;
      qc.setQueryData(qk.settings, next);
      void qc.invalidateQueries({ queryKey: ['saves'] });
      toast.push({ tone: 'success', title: 'Pasta de saves alterada', description: `Os backups foram movidos para ${next.savesRoot}.` });
    } catch (err) {
      toast.push({ tone: 'error', title: 'Não foi possível trocar a pasta', description: errorMessage(err) });
    } finally {
      setMoving(false);
    }
  }

  return (
    <SettingsPanel
      id="saves"
      title="Cofre de saves"
      actions={
        <Button variant="ghost" size="sm" icon={<FolderIcon size={14} />} onClick={() => void call('saves:open-folder', {})}>
          Abrir pasta
        </Button>
      }
    >
      <p className="muted">
        Os saves de cada jogo são copiados para esta pasta, separada dos jogos. Se você apagar e reinstalar um jogo, o
        progresso continua aqui.
      </p>
      <div className="file-picker">
        <span className="file-picker__path" title={settings.savesRoot}>
          {settings.savesRoot}
        </span>
        <Button icon={<FolderIcon />} onClick={() => void chooseRoot()} loading={moving}>
          Alterar…
        </Button>
      </div>
      <CloudProviders />
      <Switch
        label="Backup automático dos saves"
        description="Guarda o save ao fechar o jogo e verifica a cada 15 minutos (só grava quando muda). Mantém as últimas 15 versões de cada jogo."
        checked={settings.autoBackupSaves}
        onChange={(autoBackupSaves) => update.mutate({ autoBackupSaves })}
        disabled={update.isPending}
      />
    </SettingsPanel>
  );
}
