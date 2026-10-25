import { useId, useState } from 'react';
import type { Game, SaveLocation, SaveSnapshot, SaveSnapshotReason } from '@shared/types';
import { useAddSavePath, useBackupSave, useGameSaves, useRemoveSavePath, useRestoreSave, useRunningGames } from '@/hooks/queries';
import { call, errorMessage } from '@/lib/api';
import { formatBytes, formatDateTime, formatRelative } from '@/lib/format';
import { Button } from '../ui/Button';
import { ErrorState, Skeleton } from '../ui/States';
import { useToast } from '../ui/Toast';
import { CloseIcon, FolderIcon, PlusIcon, RefreshIcon } from '../ui/icons';

const REASON_LABEL: Record<SaveSnapshotReason, string> = {
  session: 'Ao fechar o jogo',
  auto: 'Automático',
  manual: 'Manual',
  initial: 'Primeira proteção',
  'pre-restore': 'Antes de restaurar',
};
const VISIBLE_SNAPSHOTS = 5;

/**
 * Cofre de saves do jogo: onde o save está, versões guardadas fora da pasta do jogo e restauração.
 * Se o jogo foi apagado e readicionado, as versões da instalação anterior aparecem aqui.
 */
export function SavePanel({ game }: { game: Game }) {
  const headingId = useId();
  const toast = useToast();
  const { data, isLoading, isError, error, refetch } = useGameSaves(game.id);
  const { data: running = [] } = useRunningGames();
  const backup = useBackupSave(game.id);
  const addPath = useAddSavePath(game.id);
  const [showAll, setShowAll] = useState(false);
  const fail = (title: string) => (err: unknown) => toast.push({ tone: 'error', title, description: errorMessage(err) });

  const isRunning = running.includes(game.id);
  const hasSaves = data?.locations.some((l) => l.exists) ?? false;
  const snapshots = data?.snapshots ?? [];
  const visible = showAll ? snapshots : snapshots.slice(0, VISIBLE_SNAPSHOTS);

  return (
    <section className="panel save-panel" aria-labelledby={headingId}>
      <header className="panel__header">
        <div>
          <h2 id={headingId} className="panel__title">
            Saves
          </h2>
          <p className="muted save-panel__subtitle">
            {snapshots[0] ? `Último backup ${formatRelative(snapshots[0].createdAt)}` : 'Guardados numa pasta separada do jogo'}
          </p>
        </div>
        <div className="trophy-panel__actions">
          <Button
            size="sm"
            variant="primary"
            icon={<RefreshIcon size={14} />}
            loading={backup.isPending}
            disabled={!hasSaves}
            title={hasSaves ? undefined : 'Nenhum save encontrado para guardar'}
            onClick={() =>
              backup.mutate(undefined, {
                onSuccess: (s) =>
                  toast.push(
                    s
                      ? { tone: 'success', title: 'Save guardado', description: `${s.files} arquivo(s) · ${formatBytes(s.sizeBytes)}` }
                      : { tone: 'info', title: 'Nada para guardar', description: 'Nenhum arquivo de save encontrado.' },
                  ),
                onError: fail('Falha no backup do save'),
              })
            }
          >
            Fazer backup agora
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<FolderIcon size={14} />}
            onClick={() => void call('saves:open-folder', { gameId: game.id }).catch(fail('Falha ao abrir a pasta'))}
          >
            Abrir pasta
          </Button>
        </div>
      </header>

      {isLoading ? (
        <Skeleton className="skeleton--row" />
      ) : isError ? (
        <ErrorState compact message={errorMessage(error)} onRetry={() => void refetch()} />
      ) : data ? (
        <>
          {data.fromPreviousInstall && snapshots[0] && (
            <PreviousInstallNotice gameId={game.id} latest={snapshots[0]} count={snapshots.length} disabled={isRunning} />
          )}

          <h3 className="section-title">Onde fica o save</h3>
          {data.locations.length === 0 ? (
            <p className="muted">
              Não encontramos o save deste jogo automaticamente. Indique a pasta ou o arquivo onde ele grava o progresso.
            </p>
          ) : (
            <ul className="save-locations">
              {data.locations.map((l) => (
                <LocationRow key={l.path} gameId={game.id} location={l} />
              ))}
            </ul>
          )}
          <div className="form__actions form__actions--start">
            <Button
              size="sm"
              variant="ghost"
              icon={<PlusIcon size={14} />}
              loading={addPath.isPending && addPath.variables === 'folder'}
              onClick={() => addPath.mutate('folder', { onError: fail('Local inválido') })}
            >
              Adicionar pasta…
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<PlusIcon size={14} />}
              loading={addPath.isPending && addPath.variables === 'file'}
              onClick={() => addPath.mutate('file', { onError: fail('Local inválido') })}
            >
              Adicionar arquivo…
            </Button>
          </div>

          <h3 className="section-title save-panel__versions-title">Versões guardadas ({snapshots.length})</h3>
          {snapshots.length === 0 ? (
            <p className="muted">
              {hasSaves
                ? 'O primeiro backup é feito automaticamente; ou use "Fazer backup agora".'
                : 'Nenhuma versão ainda. Assim que o jogo gravar um save, ele é guardado aqui.'}
            </p>
          ) : (
            <>
              <ul className="backup-list">
                {visible.map((s) => (
                  <SnapshotRow key={s.id} gameId={game.id} snapshot={s} disabled={isRunning} />
                ))}
              </ul>
              {snapshots.length > VISIBLE_SNAPSHOTS && (
                <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? 'Mostrar menos' : `Ver todas (${snapshots.length})`}
                </Button>
              )}
            </>
          )}
          {isRunning && <p className="muted save-panel__hint">Feche o jogo para restaurar um save.</p>}
        </>
      ) : null}
    </section>
  );
}

function LocationRow({ gameId, location: l }: { gameId: number; location: SaveLocation }) {
  const toast = useToast();
  const remove = useRemoveSavePath(gameId);
  return (
    <li className="save-location">
      <FolderIcon size={16} className="save-location__icon" />
      <div className="save-location__info">
        <span className="save-location__path" title={l.path}>
          {l.path}
        </span>
        <span className="muted">
          {l.source === 'auto' ? 'Detectado' : 'Adicionado por você'}
          {' · '}
          {l.exists ? `${l.isDirectory ? 'pasta' : 'arquivo'} · ${formatBytes(l.sizeBytes)}` : 'ainda não existe'}
        </span>
      </div>
      <Button
        size="sm"
        variant="ghost"
        icon={<CloseIcon size={14} />}
        aria-label={`Não guardar ${l.path}`}
        title="Não guardar este local"
        loading={remove.isPending}
        onClick={() => remove.mutate(l.path, { onError: (err) => toast.push({ tone: 'error', title: 'Falha', description: errorMessage(err) }) })}
      />
    </li>
  );
}

/** Restaurar substitui o save atual (que antes vira uma versão): exige uma segunda confirmação. */
function SnapshotRow({ gameId, snapshot: s, disabled }: { gameId: number; snapshot: SaveSnapshot; disabled: boolean }) {
  const toast = useToast();
  const restore = useRestoreSave(gameId);
  const [confirming, setConfirming] = useState(false);

  function handleRestore() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    restore.mutate(s.id, {
      onSuccess: () => {
        setConfirming(false);
        toast.push({ tone: 'success', title: 'Save restaurado', description: `Versão de ${formatDateTime(s.createdAt)}. O save anterior foi guardado.` });
      },
      onError: (err) => {
        setConfirming(false);
        toast.push({ tone: 'error', title: 'Falha ao restaurar', description: errorMessage(err) });
      },
    });
  }

  return (
    <li className="backup-list__item">
      <div className="backup-list__info">
        <strong>{formatDateTime(s.createdAt)}</strong>
        <span className="muted">
          {REASON_LABEL[s.reason]} · {s.files} arquivo(s) · {formatBytes(s.sizeBytes)}
        </span>
      </div>
      {confirming && (
        <span className="backup-list__warning" role="alert">
          O save atual será guardado e substituído.
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
          disabled={disabled}
          onClick={handleRestore}
          aria-label={confirming ? `Confirmar restauração do save de ${formatDateTime(s.createdAt)}` : `Restaurar save de ${formatDateTime(s.createdAt)}`}
        >
          {confirming ? 'Confirmar' : 'Restaurar'}
        </Button>
      </div>
    </li>
  );
}

/** Jogo readicionado depois de apagado: as versões da instalação anterior estão no cofre. */
function PreviousInstallNotice({ gameId, latest, count, disabled }: { gameId: number; latest: SaveSnapshot; count: number; disabled: boolean }) {
  const toast = useToast();
  const restore = useRestoreSave(gameId);
  return (
    <div className="save-previous" role="status">
      <div>
        <strong>Encontramos {count} backup(s) deste jogo de uma instalação anterior.</strong>
        <span className="muted">
          O mais recente é de {formatDateTime(latest.createdAt)} ({formatBytes(latest.sizeBytes)}).
        </span>
      </div>
      <Button
        variant="primary"
        icon={<RefreshIcon size={16} />}
        loading={restore.isPending}
        disabled={disabled}
        onClick={() =>
          restore.mutate(latest.id, {
            onSuccess: () => toast.push({ tone: 'success', title: 'Save restaurado', description: 'Seu progresso voltou. Bom jogo!' }),
            onError: (err) => toast.push({ tone: 'error', title: 'Falha ao restaurar', description: errorMessage(err) }),
          })
        }
      >
        Restaurar o mais recente
      </Button>
    </div>
  );
}
