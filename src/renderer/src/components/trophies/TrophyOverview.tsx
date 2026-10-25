import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { RecentTrophy, TrophyGameSummary, TrophyOverview as Overview } from '@shared/types';
import { useGame, useTrophyOverview, useTrophySet } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { formatNumber, formatRelative } from '@/lib/format';
import { Cascade, type CascadeItem } from '../ui/Cascade';
import { ProgressBar } from '../ui/ProgressBar';
import { SegmentedControl } from '../ui/Form';
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '../ui/States';
import { TrophyIcon } from '../ui/icons';
import { TrophyPanel } from './TrophyPanel';
import { TrophyGradeBadge } from './TrophyRow';
import {
  GRADE_LABEL,
  GRADE_ORDER,
  MAX_LEVEL,
  statsFromGrades,
  sumGrades,
  trophyLevel,
  type TrophyStats,
} from './trophyUtils';

type GameFilter = 'all' | 'progress' | 'done';

interface GameRowData {
  game: TrophyGameSummary;
  stats: TrophyStats;
  platinum: boolean;
}

/** Visão geral dos troféus locais (PS4 / listas manuais) de todos os jogos, no estilo da PSN. */
export function TrophyOverview() {
  const { data, isLoading, isError, error, refetch } = useTrophyOverview();

  if (isLoading) {
    return (
      <LoadingBlock label="Carregando troféus…">
        <Skeleton className="skeleton--profile" />
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="skeleton--row" />
        ))}
      </LoadingBlock>
    );
  }
  if (isError) return <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />;
  if (!data?.games.length) {
    return (
      <EmptyState
        icon={<TrophyIcon size={40} />}
        title="Nenhum troféu ainda"
        description="Adicione um jogo de PS4: os troféus são importados automaticamente do dump. Você também pode criar uma lista manual na página de qualquer jogo."
        action={
          <Link className="btn btn--primary btn--md" to="/">
            Ir para a biblioteca
          </Link>
        }
      />
    );
  }
  return <OverviewContent overview={data} />;
}

function OverviewContent({ overview }: { overview: Overview }) {
  const rows = useMemo<GameRowData[]>(
    () =>
      overview.games.map((game) => ({
        game,
        stats: statsFromGrades(game.byGrade),
        platinum: game.byGrade.P.total > 0 && game.byGrade.P.unlocked === game.byGrade.P.total,
      })),
    [overview.games],
  );
  const totals = useMemo(() => statsFromGrades(sumGrades(overview.games.map((g) => g.byGrade))), [overview.games]);

  return (
    <>
      <TrophyProfileHeader totals={totals} games={rows} />
      <TrophyCascade rows={rows} recent={overview.recent} />
    </>
  );
}
function TrophyProfileHeader({ totals, games }: { totals: TrophyStats; games: GameRowData[] }) {
  const level = trophyLevel(totals.points);
  const completed = games.filter((r) => r.stats.total > 0 && r.stats.unlocked === r.stats.total).length;
  const nextText =
    level.level >= MAX_LEVEL ? 'nível máximo' : `faltam ${formatNumber(level.pointsToNext)} pontos para o nível ${level.level + 1}`;

  return (
    <header className="profile-header trophy-profile">
      <div className="trophy-level" title="Calculado com a mesma tabela de níveis da PSN">
        <span className="trophy-level__number" aria-hidden="true">
          {level.level}
        </span>
        <span className="trophy-level__label">Nível</span>
      </div>
      <div className="profile-header__info">
        <h1 className="sr-only">Nível {level.level}</h1>
        <ProgressBar
          value={level.progress}
          max={100}
          tone="gold"
          label="Progresso até o próximo nível"
          valueText={`${level.progress}% — ${nextText}`}
        />
        <p className="muted">
          {formatNumber(totals.points)} pontos · {nextText}
        </p>
      </div>
      <dl className="profile-header__stats trophy-profile__stats">
        {GRADE_ORDER.map((g) => (
          <div key={g}>
            <dt>
              <TrophyGradeBadge grade={g} size={14} /> {GRADE_LABEL[g]}
            </dt>
            <dd>{formatNumber(totals.byGrade[g].unlocked)}</dd>
          </div>
        ))}
        <div>
          <dt>Troféus</dt>
          <dd>
            {formatNumber(totals.unlocked)}
            <small className="muted">/{formatNumber(totals.total)}</small>
          </dd>
        </div>
        <div>
          <dt>Jogos</dt>
          <dd>{formatNumber(games.length)}</dd>
        </div>
        <div>
          <dt>100%</dt>
          <dd>{formatNumber(completed)}</dd>
        </div>
      </dl>
    </header>
  );
}

type Selection = 'recentes' | `g${number}`;

/**
 * Cascata do PS5: "Troféus recentes" e os jogos à esquerda (mais recentes primeiro);
 * à direita, os recentes ou o painel completo de troféus do jogo escolhido.
 */
function TrophyCascade({ rows, recent }: { rows: GameRowData[]; recent: RecentTrophy[] }) {
  const [filter, setFilter] = useState<GameFilter>('all');
  const [selection, setSelection] = useState<Selection>('recentes');

  const visible = useMemo(() => {
    const done = (r: GameRowData) => r.stats.total > 0 && r.stats.unlocked === r.stats.total;
    const byTitle = (a: GameRowData, b: GameRowData) => a.game.title.localeCompare(b.game.title, 'pt-BR');
    return rows
      .filter((r) => (filter === 'done' ? done(r) : filter === 'progress' ? !done(r) : true))
      .sort((a, b) => (b.game.lastUnlockedAt ?? '').localeCompare(a.game.lastUnlockedAt ?? '') || byTitle(a, b));
  }, [rows, filter]);

  const items: CascadeItem<Selection>[] = [
    {
      id: 'recentes',
      label: 'Troféus recentes',
      description: recent.length ? `Último ${formatRelative(recent[0]!.trophy.unlockedAt)}` : 'Nenhum ainda',
      icon: <TrophyIcon size={22} />,
    },
    ...visible.map(({ game, stats, platinum }) => ({
      id: `g${game.gameId}` as const,
      label: game.title,
      description: `${platinum ? 'Platinado · ' : ''}${stats.unlocked} de ${stats.total} troféus`,
      icon: game.iconUrl ? <img src={game.iconUrl} alt="" width={44} height={44} loading="lazy" decoding="async" /> : <TrophyIcon size={22} />,
      trailing: (
        <span className="cascade-progress">
          <strong>{stats.percent}%</strong>
          <ProgressBar value={stats.points} max={stats.maxPoints || 1} size="xs" tone="gold" label={`Progresso em ${game.title}`} />
        </span>
      ),
    })),
  ];
  // O jogo escolhido saiu do filtro: volta para os recentes.
  const value = items.some((i) => i.id === selection) ? selection : 'recentes';

  return (
    <Cascade
      label="Troféus"
      items={items}
      value={value}
      onChange={setSelection}
      listHeader={
        <SegmentedControl
          label="Filtrar jogos"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Todos' },
            { value: 'progress', label: 'Em andamento' },
            { value: 'done', label: '100%' },
          ]}
        />
      }
    >
      {value === 'recentes' ? <RecentTrophyList recent={recent} /> : <GameTrophies gameId={Number(value.slice(1))} />}
    </Cascade>
  );
}

/** Painel completo de troféus do jogo (o mesmo da página do jogo: filtros, ordenação, marcar obtido). */
function GameTrophies({ gameId }: { gameId: number }) {
  const { data: game } = useGame(gameId);
  const { data: set, isLoading } = useTrophySet(gameId);
  if (isLoading || !game) return <Skeleton className="skeleton--summary" />;
  if (!set) return <p className="muted">Este jogo ainda não tem lista de troféus.</p>;
  return (
    <>
      <Link to={`/game/${gameId}`} className="cascade-panel__link">
        Abrir a página de {game.title} →
      </Link>
      <TrophyPanel game={game} set={set} />
    </>
  );
}

function RecentTrophyList({ recent }: { recent: RecentTrophy[] }) {
  return (
    <section className="panel" aria-labelledby="recent-trophies-heading">
      <header className="panel__header">
        <h2 id="recent-trophies-heading" className="panel__title">
          Troféus recentes
        </h2>
      </header>
      {recent.length === 0 ? (
        <p className="muted panel__empty">Nenhum troféu obtido ainda. Eles aparecem aqui assim que forem desbloqueados.</p>
      ) : (
        <ul className="recent-list">
          {recent.map(({ gameId, gameTitle, trophy: t }) => (
            <li key={`${gameId}-${t.id}`} className="recent-item">
              {t.iconUrl ? (
                <img src={t.iconUrl} alt="" width={48} height={48} loading="lazy" decoding="async" />
              ) : (
                <span className="completion-row__placeholder" aria-hidden="true">
                  <TrophyIcon size={20} />
                </span>
              )}
              <div className="recent-item__info">
                <span className="recent-item__title">
                  <TrophyGradeBadge grade={t.grade} size={14} /> {t.name}
                </span>
                <span className="recent-item__desc">{t.detail}</span>
                <Link to={`/game/${gameId}`} className="recent-item__game">
                  {gameTitle}
                </Link>
              </div>
              <div className="recent-item__side">
                <time dateTime={t.unlockedAt!}>{formatRelative(t.unlockedAt)}</time>
                {t.unlockSource === 'manual' && <span className="tag">Manual</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
