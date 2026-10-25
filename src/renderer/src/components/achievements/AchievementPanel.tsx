import { useId, useMemo, useState } from 'react';
import { useForceRefreshProgress, useGameProgress } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { Button } from '../ui/Button';
import { SegmentedControl, SelectField } from '../ui/Form';
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '../ui/States';
import { useToast } from '../ui/Toast';
import { RefreshIcon, TrophyIcon } from '../ui/icons';
import { AchievementRow } from './AchievementRow';
import { AchievementSummary } from './AchievementSummary';
import { type AchievementFilter, type AchievementSort, filterAchievements, sortAchievements } from './achievementUtils';

const SORT_OPTIONS = [
  { value: 'unlocked-first', label: 'Desbloqueadas primeiro' },
  { value: 'order', label: 'Ordem oficial' },
  { value: 'rarity', label: 'Mais raras' },
  { value: 'points', label: 'Mais pontos' },
] as const;

function PanelSkeleton() {
  return (
    <LoadingBlock label="Carregando conquistas…">
      <Skeleton className="skeleton--summary" />
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="skeleton--row" />
      ))}
    </LoadingBlock>
  );
}

/** Painel completo de conquistas de um jogo do RetroAchievements (reutilizado em 2 páginas). */
export function AchievementPanel({ raGameId }: { raGameId: number }) {
  const headingId = useId();
  const toast = useToast();
  const { data, isLoading, isError, error, refetch, isRefetching } = useGameProgress(raGameId);
  const forceRefresh = useForceRefreshProgress(raGameId);
  const [filter, setFilter] = useState<AchievementFilter>('all');
  const [sort, setSort] = useState<AchievementSort>('unlocked-first');

  const visible = useMemo(
    () => (data ? sortAchievements(filterAchievements(data.achievements, filter), sort) : []),
    [data, filter, sort],
  );

  if (isLoading) return <PanelSkeleton />;
  if (isError) {
    return (
      <ErrorState
        title="Não foi possível carregar as conquistas"
        message={errorMessage(error)}
        onRetry={() => void refetch()}
        retrying={isRefetching}
      />
    );
  }
  if (!data) return null;
  if (data.numAchievements === 0) {
    return (
      <EmptyState
        icon={<TrophyIcon size={32} />}
        title="Sem conquistas oficiais"
        description="Este jogo ainda não possui um conjunto de conquistas publicado no RetroAchievements."
      />
    );
  }

  const locked = data.numAchievements - data.earned;

  return (
    <section className="panel" aria-labelledby={headingId}>
      <header className="panel__header">
        <h2 id={headingId} className="panel__title">
          Conquistas
        </h2>
        <Button
          variant="ghost"
          size="sm"
          icon={<RefreshIcon />}
          loading={forceRefresh.isPending}
          onClick={() =>
            forceRefresh.mutate(undefined, {
              onError: (err) => toast.push({ tone: 'error', title: 'Falha ao atualizar', description: errorMessage(err) }),
            })
          }
        >
          Atualizar
        </Button>
      </header>

      <AchievementSummary progress={data} />

      <div className="toolbar">
        <SegmentedControl
          label="Filtrar conquistas"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `Todas (${data.numAchievements})` },
            { value: 'unlocked', label: `Desbloqueadas (${data.earned})` },
            { value: 'locked', label: `Bloqueadas (${locked})` },
          ]}
        />
        <SelectField label="Ordenar por" value={sort} onChange={setSort} options={SORT_OPTIONS} className="select--inline" />
      </div>

      {visible.length === 0 ? (
        <p className="muted panel__empty">
          {filter === 'unlocked' ? 'Você ainda não desbloqueou nenhuma conquista neste jogo.' : 'Todas as conquistas foram desbloqueadas! 🎉'}
        </p>
      ) : (
        <ul className="achievement-list">
          {visible.map((a) => (
            <AchievementRow key={a.id} achievement={a} />
          ))}
        </ul>
      )}
    </section>
  );
}
