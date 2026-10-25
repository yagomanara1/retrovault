import { useState } from 'react';
import { availableUpdate, chooseRelease, installKind, quiverPageUrl, type InstallProgress, type StorePort } from '@shared/store';
import { useInstallProgress, useLaunchGame, useRunningGames, useStoreInstalls, useStoreReleases } from '@/hooks/queries';
import { call, errorMessage } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { ProgressBar } from '../ui/ProgressBar';
import { useToast } from '../ui/Toast';
import { CheckIcon, DownloadIcon, FolderIcon, LinkIcon, PlayIcon, TrashIcon, UndoIcon } from '../ui/icons';
import { RomPanel } from './RomPanel';
import { useAiGuard } from './useAiGuard';
import { usePortInstaller } from './usePortInstaller';

const PHASE_LABEL: Record<InstallProgress['phase'], string> = {
  preparing: 'Preparando…',
  downloading: 'Baixando',
  verifying: 'Conferindo o arquivo…',
  extracting: 'Instalando',
  installer: 'Siga os passos do instalador do projeto (ele abriu numa janela própria)…',
  finishing: 'Finalizando…',
};

function progressText(p: InstallProgress): string {
  if (p.phase === 'downloading' && p.total > 0) return `${PHASE_LABEL.downloading} · ${formatBytes(p.done)} de ${formatBytes(p.total)}`;
  if (p.phase === 'extracting' && p.total > 0) return `${PHASE_LABEL.extracting} · ${p.done.toLocaleString('pt-BR')} de ${p.total.toLocaleString('pt-BR')} arquivos`;
  return PHASE_LABEL[p.phase];
}

interface PortActionsProps {
  port: StorePort;
  /** Seleção parada (as versões só são buscadas então; ver StorePage). */
  settled: boolean;
}

/** Botões do port: Baixar → progresso com Cancelar → Jogar / Abrir pasta / Desinstalar. */
export function PortActions({ port, settled }: PortActionsProps) {
  const toast = useToast();
  const { data: installsData } = useStoreInstalls();
  const progressMap = useInstallProgress();
  const { data: releases } = useStoreReleases(port.id, settled); // mesma consulta da lista de versões (sem custo extra)
  const { data: running = [] } = useRunningGames();
  const launch = useLaunchGame();
  const [confirmUninstall, setConfirmUninstall] = useState(false);

  const { install, cancel, uninstall, rollback } = usePortInstaller(port);
  const [guard, aiModal] = useAiGuard(port);

  const installed = installsData?.installs.find((i) => i.portId === port.id) ?? null;
  const progress = progressMap[port.id] ?? null;
  const target = releases ? chooseRelease(releases) : null;
  const update = installed && releases ? availableUpdate(releases, installed) : null;
  // A atualização é a versão guardada no disco (ex.: depois de voltar): troca na hora, sem baixar.
  const updateIsStored =
    !!update &&
    installed?.previous?.tag === update.tag &&
    (!update.windowsAsset?.sha256 || update.windowsAsset.sha256 === installed.previous.sha256);
  const isRunning = installed?.gameId != null && running.includes(installed.gameId);
  const busy = rollback.isPending;

  const projectButton = (
    <>
      <Button variant="secondary" icon={<LinkIcon size={16} />} onClick={() => void call('app:open-external', port.homepage ?? `https://github.com/${port.source.repo}`)}>
        Página do projeto
      </Button>
      {port.quiver && (
        <Button
          variant="ghost"
          icon={<LinkIcon size={16} />}
          title="Página deste port no Quiver Launcher (avaliações da comunidade)"
          onClick={() => void call('app:open-external', quiverPageUrl(port.quiver!))}
        >
          Ver no Quiver
        </Button>
      )}
    </>
  );

  if (progress) {
    const determinate = progress.total > 0;
    return (
      <div className="port-progress" role="group" aria-label={`Instalando ${port.name}`}>
        <div className="port-progress__row">
          <span className="port-progress__label" aria-live="polite">
            {progressText(progress)}
          </span>
          <Button size="sm" variant="ghost" onClick={() => cancel.mutate(port.id)} disabled={progress.phase === 'finishing'}>
            Cancelar
          </Button>
        </div>
        {determinate ? (
          <ProgressBar value={progress.done} max={progress.total} label={`Progresso da instalação de ${port.name}`} valueText={progressText(progress)} />
        ) : (
          <div className="port-progress__indeterminate" aria-hidden="true" />
        )}
      </div>
    );
  }

  if (installed) {
    return (
      <>
        <div className="store-port__actions">
          <Button
            variant="primary"
            size="lg"
            icon={<PlayIcon size={16} />}
            disabled={!installed.gameId || isRunning}
            loading={launch.isPending}
            onClick={() =>
              installed.gameId &&
              launch.mutate(installed.gameId, { onError: (err) => toast.push({ tone: 'error', title: 'Não foi possível abrir', description: errorMessage(err) }) })
            }
          >
            {isRunning ? 'Jogando agora' : 'Jogar'}
          </Button>
          {update?.windowsAsset &&
            (updateIsStored ? (
              <Button variant="secondary" icon={<DownloadIcon size={16} />} disabled={isRunning} loading={busy} onClick={() => rollback.mutate(port.id)}>
                Atualizar para {update.tag} (já baixada)
              </Button>
            ) : (
              <Button
                variant="secondary"
                icon={<DownloadIcon size={16} />}
                disabled={isRunning || busy}
                title={isRunning ? 'Feche o jogo para atualizar' : undefined}
                onClick={() => guard(() => install.mutate({ portId: port.id, tag: update.tag }))}
              >
                {update.tag === installed.tag ? 'Baixar compilação nova' : `Atualizar para ${update.tag}`} · {formatBytes(update.windowsAsset.size)}
              </Button>
            ))}
          {installed.previous && !updateIsStored && (
            <Button variant="ghost" icon={<UndoIcon size={16} />} disabled={isRunning} loading={busy} onClick={() => rollback.mutate(port.id)}>
              Voltar para {installed.previous.tag}
            </Button>
          )}
          <Button variant="secondary" icon={<FolderIcon size={16} />} onClick={() => void call('store:open-folder', port.id)}>
            Abrir pasta
          </Button>
          {projectButton}
          <Button variant="ghost" icon={<TrashIcon size={16} />} disabled={isRunning} onClick={() => setConfirmUninstall(true)}>
            Desinstalar
          </Button>
        </div>
        <p className="port-installed">
          <CheckIcon size={14} /> Instalado · versão {installed.tag} · {formatBytes(installed.sizeBytes)}
          {installed.verified ? ' · conferido (SHA-256)' : ' · o projeto não publicou hash; conferido pelo tamanho'}
          {installed.previous && ` · versão ${installed.previous.tag} guardada para voltar`}
        </p>
        <RomPanel port={port} />
        {aiModal}
        <Modal
          open={confirmUninstall}
          onClose={() => setConfirmUninstall(false)}
          title={`Desinstalar ${port.name}?`}
          size="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmUninstall(false)}>
                Cancelar
              </Button>
              <Button
                variant="danger"
                loading={uninstall.isPending}
                onClick={() =>
                  uninstall.mutate(port.id, {
                    onSuccess: ({ manual }) => {
                      setConfirmUninstall(false);
                      toast.push(
                        manual
                          ? {
                              tone: 'info',
                              title: `${port.name} saiu da Loja`,
                              description: 'Ele foi instalado pelo instalador do projeto: para apagar os arquivos, use Configurações do Windows → Aplicativos.',
                            }
                          : { tone: 'info', title: `${port.name} desinstalado`, description: 'A pasta foi para a Lixeira. O jogo continua na biblioteca.' },
                      );
                    },
                    onError: (err) => toast.push({ tone: 'error', title: 'Não foi possível desinstalar', description: errorMessage(err) }),
                  })
                }
              >
                Desinstalar
              </Button>
            </>
          }
        >
          <ul className="port-uninstall__list">
            <li>O save é guardado no cofre antes.</li>
            <li>A pasta do port (e a da versão anterior, se houver) vai para a Lixeira; dá para recuperar.</li>
            <li>O jogo continua na biblioteca com tempo de jogo e troféus; reinstalar religa tudo.</li>
          </ul>
        </Modal>
      </>
    );
  }

  const usesInstaller = !!target?.windowsAsset && installKind(port, target.windowsAsset.name) === 'installer';
  return (
    <>
      <div className="store-port__actions">
        <Button
          variant="primary"
          size="lg"
          icon={<DownloadIcon size={18} />}
          disabled={!target}
          title={releases && !target ? 'Este projeto não publicou uma versão para Windows' : undefined}
          onClick={() => guard(() => install.mutate({ portId: port.id }))}
        >
          {target?.windowsAsset ? `Baixar · ${formatBytes(target.windowsAsset.size)}` : 'Baixar'}
        </Button>
        {projectButton}
      </div>
      {usesInstaller && (
        <p className="port-installed">
          Este projeto usa o instalador dele: o RetroVault abre o instalador, você segue os passos e o jogo entra na biblioteca. Para desinstalar
          depois, use o Windows.
        </p>
      )}
      {aiModal}
    </>
  );
}
