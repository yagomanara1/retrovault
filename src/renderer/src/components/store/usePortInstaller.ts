import type { StorePort } from '@shared/store';
import { useStoreActions } from '@/hooks/queries';
import { errorMessage, isApiError } from '@/lib/api';
import { useToast } from '../ui/Toast';

/**
 * Ações de instalação de um port com os avisos certos para cada caso. Usado pelos botões do port e
 * pela lista de versões, para os avisos serem os mesmos (e não duplicados) nos dois lugares.
 */
export function usePortInstaller(port: StorePort) {
  const toast = useToast();
  return useStoreActions({
    onInstalled: (result, kind) => {
      if (result.previous) {
        // Atualização, troca de versão pela lista ou "voltar": em todos, os dados do usuário vão junto.
        toast.push({
          tone: 'success',
          title: kind === 'rollback' ? `${port.name}: de volta à versão ${result.tag}` : `${port.name} agora na versão ${result.tag}`,
          description: `Seus saves e configurações vieram junto. A versão ${result.previous.tag} fica guardada, se quiser voltar.`,
        });
      } else {
        toast.push({
          tone: 'success',
          title: `${port.name} instalado`,
          description: result.verified ? 'Arquivo conferido com o publicado pelo projeto. Já está na sua biblioteca.' : 'Já está na sua biblioteca.',
        });
      }
    },
    onError: (err) => {
      if (isApiError(err, 'CANCELLED')) toast.push({ tone: 'info', title: 'Instalação cancelada' });
      else toast.push({ tone: 'error', title: `Não foi possível concluir (${port.name})`, description: errorMessage(err) });
    },
  });
}
