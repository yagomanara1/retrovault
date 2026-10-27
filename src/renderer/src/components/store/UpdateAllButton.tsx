import type { UpdateAllResult } from '@shared/store';
import { useStoreUpdates, useUpdateAllPorts } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';
import { DownloadIcon } from '../ui/icons';

/** Resumo do "Atualizar tudo": o que foi atualizado e, de fora, por quê. `names`: id do port → nome. */
function summary({ updated, skipped, failed }: UpdateAllResult, names: Record<string, string>) {
  const list = (ids: string[]) => ids.map((id) => names[id] ?? id).join(', ');
  const installers = skipped.filter((s) => s.reason === 'installer').map((s) => s.portId);
  const running = skipped.filter((s) => s.reason === 'running').map((s) => s.portId);
  const notes = [
    installers.length ? `Pelo instalador (atualize na página do port): ${list(installers)}.` : '',
    running.length ? `Abertos agora (feche e tente de novo): ${list(running)}.` : '',
    failed.length ? `Com erro: ${failed.map((f) => `${names[f.portId] ?? f.portId} (${f.message})`).join('; ')}.` : '',
  ].filter(Boolean);
  return {
    tone: failed.length ? ('error' as const) : updated.length ? ('success' as const) : ('info' as const),
    title: updated.length ? `${updated.length} ${updated.length === 1 ? 'port atualizado' : 'ports atualizados'}` : 'Nenhum port atualizado',
    description: notes.join(' ') || list(updated),
  };
}

/**
 * "Atualizar tudo (N)": aparece só quando há atualizações. Os ports de instalador e os abertos
 * ficam de fora (o resumo diz quais e por quê); o progresso de cada um aparece na própria página.
 */
export function UpdateAllButton({ names }: { names: Record<string, string> }) {
  const { data: updates } = useStoreUpdates();
  const updateAll = useUpdateAllPorts();
  const toast = useToast();
  const count = updates ? Object.keys(updates).length : 0;
  if (count === 0 && !updateAll.isPending) return null;
  return (
    <Button
      size="sm"
      variant="primary"
      icon={<DownloadIcon size={14} />}
      loading={updateAll.isPending}
      onClick={() =>
        updateAll.mutate(undefined, {
          onSuccess: (result) => toast.push(summary(result, names)),
          onError: (err) => toast.push({ tone: 'error', title: 'Não foi possível atualizar', description: errorMessage(err) }),
        })
      }
    >
      {updateAll.isPending ? 'Atualizando…' : `Atualizar tudo (${count})`}
    </Button>
  );
}
