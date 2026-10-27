import { useSearchParams } from 'react-router-dom';
import { CATEGORY_ICONS } from '@shared/categoryIcons';
import type { StorePort } from '@shared/store';
import { useCustomPorts, useInstallFor, useInstallProgress } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';
import { AlertIcon, CheckIcon, TrashIcon } from '../ui/icons';
import { ModsPanel } from './ModsPanel';
import { PortActions } from './PortActions';
import { PortBanner, PortTile } from './PortArtwork';
import { ReleaseList } from './ReleaseList';

/** Página do port na Loja. `settled`: a seleção parou; só então as versões são buscadas (ver StorePage). */
export function PortDetails({ port, settled }: { port: StorePort; settled: boolean }) {
  const platform = port.original.system ?? CATEGORY_ICONS[port.original.platform].label;
  const installed = !!useInstallFor(port.id);
  return (
    <div className="store-port">
      <section className="panel store-port__hero" aria-labelledby="store-port-name">
        <PortBanner port={port} />
        <div className="store-port__head">
          <PortTile port={port} size={112} className="port-tile--large" />
          <div className="store-port__titles">
            <p className="store-port__eyebrow">
              {platform} · {port.tags.includes('Recompilação') ? 'Recompilação' : 'Port'}
              {port.ai === 'generated' && <span className="store-ai store-ai--generated">Gerado por IA</span>}
              {port.ai === 'assisted' && <span className="store-ai">Feito com ajuda de IA</span>}
            </p>
            <h2 id="store-port-name" className="store-port__name">
              {port.name}
            </h2>
            <p className="store-port__origin">
              <span className="store-port__based">Baseado em</span>
              <span className="store-port__chip">{port.original.title}</span>
              <span>por {port.developer}</span>
            </p>
          </div>
        </div>
        <p className="store-port__summary">{port.summary}</p>
        {port.tags.length > 0 && (
          <ul className="store-port__tags" aria-label="Etiquetas">
            {port.tags.map((t) => (
              <li key={t} className="store-port__tag">
                {t}
              </li>
            ))}
          </ul>
        )}
        <PortActions port={port} settled={settled} />
        {port.custom && <CustomPortNotice port={port} installed={installed} />}
        {/* Instalado e com assistente: o painel "ROM do jogo" já diz o que falta. */}
        {!(installed && port.setup) && <Requirement port={port} />}
        {port.description && <p className="store-port__description">{port.description}</p>}
      </section>
      {port.mods && settled && <ModsPanel port={port} installed={installed} />}
      <ReleaseList port={port} settled={settled} />
    </div>
  );
}

/** O que o port precisa para rodar: nada (jogo livre) ou a cópia do jogo do próprio usuário. */
function Requirement({ port }: { port: StorePort }) {
  const { requires } = port;
  if (requires.kind === 'none') {
    return (
      <div className="store-port__requirement store-port__requirement--free" role="note">
        <CheckIcon size={18} />
        <div>
          <strong>{requires.label}.</strong>
          {requires.note && <span> {requires.note}</span>}
        </div>
      </div>
    );
  }
  return (
    <div className="store-port__requirement" role="note">
      <AlertIcon size={18} />
      <div>
        <strong>Você precisa da sua própria cópia: {requires.label}.</strong>
        {requires.note && <span> {requires.note}</span>}
        <span className="store-port__requirement-hint"> A Loja nunca baixa o jogo, só o programa.</span>
      </div>
    </div>
  );
}

/** Port adicionado pelo usuário: lembra que não passou pela curadoria e permite tirá-lo da Loja. */
function CustomPortNotice({ port, installed }: { port: StorePort; installed: boolean }) {
  const { remove } = useCustomPorts();
  const toast = useToast();
  const [, setParams] = useSearchParams();
  // O hook roda sempre (as regras do React): dentro do || ele pularia quando o port já está instalado.
  const installing = !!useInstallProgress()[port.id];
  const busy = installed || installing;
  return (
    <div className="store-port__custom" role="note">
      <span>Adicionado por você · sem curadoria da Loja.</span>
      <Button
        size="sm"
        variant="ghost"
        icon={<TrashIcon size={14} />}
        disabled={busy}
        title={busy ? 'Desinstale (ou espere a instalação terminar) antes de remover da Loja' : undefined}
        loading={remove.isPending}
        onClick={() =>
          remove.mutate(port.id, {
            onSuccess: () => {
              setParams({}, { replace: true });
              toast.push({ tone: 'info', title: `${port.name} removido da Loja` });
            },
            onError: (err) => toast.push({ tone: 'error', title: 'Não foi possível remover', description: errorMessage(err) }),
          })
        }
      >
        Remover da Loja
      </Button>
    </div>
  );
}
