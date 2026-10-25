import { useNavigate } from 'react-router-dom';
import type { Game, TrophySet } from '@shared/types';
import { useAutoImportTrophies, useCreateManualTrophies, useImportTrophies, useSettings } from '@/hooks/queries';
import { errorMessage, isApiError } from '@/lib/api';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/States';
import { useToast } from '../ui/Toast';
import { FolderIcon, PlusIcon, TrophyIcon } from '../ui/icons';

/**
 * Estado vazio: normalmente os troféus já chegam sozinhos (o .trp do dump é localizado ao
 * adicionar o jogo). Aqui ficam as alternativas: procurar de novo, escolher o .trp ou criar uma lista.
 */
export function TrophySetup({ game }: { game: Game }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { data: settings } = useSettings();
  const autoImport = useAutoImportTrophies(game.id);
  const importTrp = useImportTrophies(game.id);
  const createManual = useCreateManualTrophies(game.id);

  const onImported = (set: TrophySet | null) => {
    if (!set) return;
    toast.push({
      tone: 'success',
      title: `${set.trophies.length} troféus importados`,
      description: set.logPath
        ? 'Detecção automática ligada: os desbloqueios aparecem enquanto você joga.'
        : 'Marque os troféus manualmente ou escolha o log do jogo.',
    });
  };
  const onImportError = (err: unknown) => {
    toast.push({ tone: 'error', title: 'Falha ao importar troféus', description: errorMessage(err) });
    if (isApiError(err, 'TROPHY_KEY_MISSING', 'TROPHY_KEY_INVALID')) navigate('/settings');
  };

  return (
    <EmptyState
      compact
      icon={<TrophyIcon size={28} />}
      title="Troféus locais"
      description={
        <>
          Jogos de PS4 recebem os troféus automaticamente: o RetroVault procura o{' '}
          <code>sce_sys/trophy/trophy00.trp</code> no dump do jogo, nos argumentos de inicialização e na
          configuração do launcher do port. Se não encontrar, escolha o arquivo ou crie a sua própria lista.
          {!settings?.hasTrophyKey && ' Para ler nomes e descrições do PS4, cadastre sua trophy key em Configurações.'}
        </>
      }
      action={
        <>
          <Button
            variant="primary"
            icon={<TrophyIcon size={16} />}
            loading={autoImport.isPending}
            onClick={() => autoImport.mutate(undefined, { onSuccess: onImported, onError: onImportError })}
          >
            Procurar automaticamente
          </Button>
          <Button
            icon={<FolderIcon size={16} />}
            loading={importTrp.isPending}
            onClick={() => importTrp.mutate(undefined, { onSuccess: onImported, onError: onImportError })}
          >
            Escolher .trp…
          </Button>
          <Button
            variant="ghost"
            icon={<PlusIcon size={16} />}
            loading={createManual.isPending}
            onClick={() =>
              createManual.mutate(undefined, {
                onError: (err) => toast.push({ tone: 'error', title: 'Falha ao criar lista', description: errorMessage(err) }),
              })
            }
          >
            Criar lista manual
          </Button>
        </>
      }
    />
  );
}
