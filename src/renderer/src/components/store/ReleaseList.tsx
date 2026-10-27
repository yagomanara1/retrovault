import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { StorePort, StoreRelease } from '@shared/store';
import { useInstallFor, useInstallProgress, useRunningGames, useSettings, useStoreReleases } from '@/hooks/queries';
import { errorMessage, isApiError } from '@/lib/api';
import { formatBytes, formatDate } from '@/lib/format';
import { Button } from '../ui/Button';
import { ErrorState, LoadingBlock, Skeleton } from '../ui/States';
import { latestStableTag, releaseAction } from './releaseAction';
import { useAiGuard } from './useAiGuard';
import { usePortInstaller } from './usePortInstaller';

/** Versões publicadas do port. `settled`: a seleção parou; só então as versões são buscadas (ver StorePage). */
export function ReleaseList({ port, settled }: { port: StorePort; settled: boolean }) {
  const query = useStoreReleases(port.id, settled);
  const { data: settings } = useSettings();
  const navigate = useNavigate();
  const { data: releases, error, refetch, isFetching } = query;
  // Já em cache: aparece na hora; senão, esqueleto até a seleção parar e a busca terminar.
  const isLoading = !releases && !error && (query.isLoading || !settled);
  const latestTag = latestStableTag(releases);
  const installed = useInstallFor(port.id);
  const installing = !!useInstallProgress()[port.id];
  const { data: running = [] } = useRunningGames();
  const { install, rollback } = usePortInstaller(port);
  const [guard, aiModal] = useAiGuard(port);
  const locked = installing || install.isPending || rollback.isPending || (installed?.gameId != null && running.includes(installed.gameId));

  const actionFor = (r: StoreRelease): ReactNode => {
    switch (releaseAction(r, installed)) {
      case 'active':
        return <span className="store-pill store-pill--installed">Instalada</span>;
      case 'previous':
        return (
          <Button size="sm" variant="secondary" disabled={locked} onClick={() => rollback.mutate(port.id)}>
            Usar esta (já baixada)
          </Button>
        );
      case 'install':
        return (
          <Button size="sm" variant="ghost" disabled={locked} onClick={() => guard(() => install.mutate({ portId: port.id, tag: r.tag }))}>
            Instalar esta versão
          </Button>
        );
      case null:
        return null;
    }
  };

  return (
    <section className="panel" aria-labelledby="store-releases-heading" aria-busy={isLoading}>
      <header className="panel__header">
        <h2 id="store-releases-heading" className="panel__title">
          Versões
        </h2>
        <span className="muted store-releases__source">github.com/{port.source.repo}</span>
      </header>
      {isLoading ? (
        <LoadingBlock label="Buscando versões…">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="store-release__skeleton" />
          ))}
        </LoadingBlock>
      ) : error ? (
        <ErrorState
          compact
          title="Não foi possível buscar as versões"
          message={errorMessage(error)}
          onRetry={() => void refetch()}
          retrying={isFetching}
          action={
            // Limite sem conta estourado: o atalho leva direto para vincular a conta.
            isApiError(error, 'RATE_LIMITED') && !settings?.githubLogin ? (
              <Button variant="primary" onClick={() => navigate('/settings?secao=github')}>
                Conectar conta do GitHub
              </Button>
            ) : undefined
          }
        />
      ) : !releases?.length ? (
        <p className="muted panel__empty">Este projeto ainda não publicou versões.</p>
      ) : (
        <ul className="store-releases">
          {releases.map((r) => (
            <ReleaseRow key={r.tag} release={r} latest={r.tag === latestTag} action={actionFor(r)} />
          ))}
        </ul>
      )}
      {aiModal}
    </section>
  );
}

function ReleaseRow({ release: r, latest, action }: { release: StoreRelease; latest: boolean; action: ReactNode }) {
  return (
    <li className="store-release">
      <div className="store-release__main">
        <span className="store-release__name">{r.name}</span>
        {r.name !== r.tag && <span className="store-release__tag">{r.tag}</span>}
        {latest && <span className="store-pill store-pill--latest">Mais recente</span>}
        {r.prerelease && <span className="store-pill">Prévia</span>}
        {action && <span className="store-release__action">{action}</span>}
      </div>
      <div className="store-release__meta">
        {r.publishedAt && <span>{formatDate(r.publishedAt)}</span>}
        {r.windowsAsset ? (
          <span>
            {r.windowsAsset.name} · {formatBytes(r.windowsAsset.size)}
          </span>
        ) : (
          <span className="store-release__missing">Sem arquivo para Windows nesta versão</span>
        )}
      </div>
      {r.notes.trim() && (
        <details className="store-release__notes">
          <summary>Notas da versão</summary>
          <pre>{r.notes}</pre>
        </details>
      )}
    </li>
  );
}
