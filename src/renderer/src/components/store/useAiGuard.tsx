import { useState, type ReactNode } from 'react';
import type { StorePort } from '@shared/store';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

/**
 * Antes de baixar um projeto marcado como "gerado por IA": confirmação com o risco explicado.
 * `guard(acao)` roda direto nos outros projetos; nos gerados por IA, só depois do "Baixar mesmo assim".
 */
export function useAiGuard(port: StorePort): [(action: () => void) => void, ReactNode] {
  const [pending, setPending] = useState<(() => void) | null>(null);
  const guard = (action: () => void) => (port.ai === 'generated' ? setPending(() => action) : action());
  const modal = (
    <Modal
      open={pending !== null}
      onClose={() => setPending(null)}
      title={`${port.name} foi gerado por IA`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => setPending(null)}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              pending?.();
              setPending(null);
            }}
          >
            Baixar mesmo assim
          </Button>
        </>
      }
    >
      <ul className="port-uninstall__list">
        <li>O catálogo de referência marca este projeto como escrito em grande parte por IA, com pouca revisão humana.</li>
        <li>O autor ({port.developer}) é pouco conhecido: o programa roda no seu PC com as suas permissões.</li>
        <li>O RetroVault confere que o arquivo é o mesmo que o projeto publicou, mas não o que ele faz. Se o antivírus reclamar, não ignore.</li>
      </ul>
    </Modal>
  );
  return [guard, modal];
}
