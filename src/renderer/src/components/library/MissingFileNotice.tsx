import type { Game } from '@shared/types';
import { useRelocateGame } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';
import { AlertIcon, FolderIcon, RefreshIcon } from '../ui/icons';

/**
 * Aviso de arquivo ausente (jogo movido ou apagado). Atualizar o local mantém
 * tempo de jogo, troféus, arte e histórico, ao contrário de readicionar o jogo.
 */
export function MissingFileNotice({ game }: { game: Game }) {
  const toast = useToast();
  const relocate = useRelocateGame();
  const pending = relocate.isPending ? relocate.variables?.action : null;

  function run(action: 'pick' | 'auto') {
    relocate.mutate(
      { id: game.id, action },
      {
        onSuccess: (updated) => {
          if (updated) toast.push({ tone: 'success', title: 'Local atualizado', description: updated.path });
        },
        onError: (err) => toast.push({ tone: 'error', title: 'Jogo não encontrado', description: errorMessage(err) }),
      },
    );
  }

  return (
    <div className="missing-notice" role="alert">
      <AlertIcon size={20} className="missing-notice__icon" />
      <div className="missing-notice__text">
        <strong>Arquivo do jogo não encontrado</strong>
        <span className="muted" title={game.path}>
          {game.path}
        </span>
        <span className="muted">
          Se você moveu a pasta, aponte o novo local: o tempo de jogo, os troféus e a arte são mantidos.
        </span>
      </div>
      <div className="missing-notice__actions">
        <Button
          icon={<RefreshIcon size={16} />}
          loading={pending === 'auto'}
          disabled={relocate.isPending}
          onClick={() => run('auto')}
        >
          Procurar automaticamente
        </Button>
        <Button
          variant="primary"
          icon={<FolderIcon size={16} />}
          loading={pending === 'pick'}
          disabled={relocate.isPending}
          onClick={() => run('pick')}
        >
          Localizar…
        </Button>
      </div>
    </div>
  );
}
