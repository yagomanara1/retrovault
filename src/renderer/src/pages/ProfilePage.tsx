import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { TrophyOverview } from '@/components/trophies/TrophyOverview';
import { Tabs } from '@/components/ui/Tabs';
import type { CompletionEntry } from '@shared/types';
import { useCompletion, useGames, useProfile, useRaEnabled, useRecentAchievements } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { cx } from '@/lib/cx';
import { formatDate, formatNumber, formatRelative } from '@/lib/format';
import { AWARD_LABEL } from '@/components/achievements/achievementUtils';
import { SegmentedControl } from '@/components/ui/Form';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '@/components/ui/States';
import { TrophyIcon } from '@/components/ui/icons';

type CompletionFilter = 'all' | 'progress' | 'done';

type ProfileTab = 'trophies' | 'ra';
const TABS = [
  { value: 'trophies', label: 'Troféus' },
  { value: 'ra', label: 'RetroAchievements' },
] as const;

/** Conquistas: troféus locais (PS4 / listas manuais) e RetroAchievements, em abas. A aba fica na URL. */
export function ProfilePage() {
  const [params, setParams] = useSearchParams();
  const tab: ProfileTab = params.get('tab') === 'ra' ? 'ra' : 'trophies';

  return (
    <div className="page profile">
      <h1 className="sr-only">Conquistas</h1>
      <Tabs label="Tipo de conquista" value={tab} onChange={(next) => setParams({ tab: next }, { replace: true })} tabs={TABS}>
        {tab === 'trophies' ? <TrophyOverview /> : <RetroAchievementsTab />}
      </Tabs>
    </div>
  );
}

function RetroAchievementsTab() {
  const raEnabled = useRaEnabled();
  if (!raEnabled) {
    return (
      <EmptyState
        icon={<TrophyIcon size={40} />}
        title="Conecte sua conta do RetroAchievements"
        description="O RetroArch registra suas conquistas na sua conta do RetroAchievements. Informe usuário e Web API Key para vê-las aqui."
        action={
          <Link className="btn btn--primary btn--md" to="/settings">
            Abrir configurações
          </Link>
        }
      />
    );
  }
  return (
    <>
      <ProfileHeader />
      <div className="profile__columns">
        <CompletionList />
        <RecentList />
      </div>
    </>
  );
}

function ProfileHeader() {
  const { data: profile, isLoading, isError, error, refetch } = useProfile();
  const { data: completion } = useCompletion();

  const stats = useMemo(() => {
    const list = completion ?? [];
    return {
      games: list.length,
      mastered: list.filter((c) => c.highestAward === 'mastered' || c.highestAward === 'completed').length,
      achievements: list.reduce((sum, c) => sum + c.numAwarded, 0),
    };
  }, [completion]);

  if (isLoading) return <Skeleton className="skeleton--profile" />;
  if (isError) return <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />;
  if (!profile) return null;

  return (
    <header className="profile-header">
      {profile.avatarUrl && <img className="profile-header__avatar" src={profile.avatarUrl} alt="" width={96} height={96} />}
      <div className="profile-header__info">
        <h1>{profile.username}</h1>
        {profile.motto && <p className="profile-header__motto">“{profile.motto}”</p>}
        {profile.richPresence && <p className="profile-header__presence">{profile.richPresence}</p>}
        <p className="muted">Membro desde {formatDate(profile.memberSince)}</p>
      </div>
      <dl className="profile-header__stats">
        <div>
          <dt>Pontos (Hardcore)</dt>
          <dd>{formatNumber(profile.totalPoints)}</dd>
        </div>
        <div>
          <dt>Pontos (Softcore)</dt>
          <dd>{formatNumber(profile.totalSoftcorePoints)}</dd>
        </div>
        <div>
          <dt>RetroPoints</dt>
          <dd>{formatNumber(profile.totalTruePoints)}</dd>
        </div>
        <div>
          <dt>Conquistas</dt>
          <dd>{formatNumber(stats.achievements)}</dd>
        </div>
        <div>
          <dt>Jogos</dt>
          <dd>{formatNumber(stats.games)}</dd>
        </div>
        <div>
          <dt>100%</dt>
          <dd>{formatNumber(stats.mastered)}</dd>
        </div>
      </dl>
    </header>
  );
}

function CompletionRow({ entry, libraryGameId }: { entry: CompletionEntry; libraryGameId?: number }) {
  const to = libraryGameId ? `/game/${libraryGameId}` : `/ra-game/${entry.gameId}`;
  return (
    <li>
      <Link to={to} className="completion-row">
        {entry.iconUrl && <img src={entry.iconUrl} alt="" width={48} height={48} loading="lazy" />}
        <div className="completion-row__info">
          <span className="completion-row__title">{entry.title}</span>
          <span className="completion-row__meta">
            {entry.consoleName}
            {libraryGameId && ' · Na biblioteca'}
          </span>
          <ProgressBar
            value={entry.numAwarded}
            max={entry.maxPossible}
            size="sm"
            tone="gold"
            label={`Progresso em ${entry.title}`}
            valueText={`${entry.numAwarded} de ${entry.maxPossible}`}
          />
        </div>
        <div className="completion-row__side">
          <span>
            {entry.numAwarded}/{entry.maxPossible}
          </span>
          {entry.highestAward && (
            <span className={cx('award', `award--${entry.highestAward}`)}>{AWARD_LABEL[entry.highestAward]}</span>
          )}
        </div>
      </Link>
    </li>
  );
}

function CompletionList() {
  const { data, isLoading, isError, error, refetch } = useCompletion();
  const { data: games } = useGames();
  const [filter, setFilter] = useState<CompletionFilter>('all');

  const libraryByRaId = useMemo(() => {
    const map = new Map<number, number>();
    for (const g of games ?? []) if (g.raGameId) map.set(g.raGameId, g.id);
    return map;
  }, [games]);

  const visible = useMemo(() => {
    const list = data ?? [];
    if (filter === 'done') return list.filter((c) => c.maxPossible > 0 && c.numAwarded >= c.maxPossible);
    if (filter === 'progress') return list.filter((c) => c.numAwarded < c.maxPossible);
    return list;
  }, [data, filter]);

  return (
    <section className="panel" aria-labelledby="completion-heading">
      <header className="panel__header">
        <h2 id="completion-heading" className="panel__title">
          Jogos
        </h2>
        <SegmentedControl
          label="Filtrar jogos"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Todos' },
            { value: 'progress', label: 'Em andamento' },
            { value: 'done', label: 'Concluídos' },
          ]}
        />
      </header>
      {isLoading ? (
        <LoadingBlock label="Carregando jogos…">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="skeleton--row" />
          ))}
        </LoadingBlock>
      ) : isError ? (
        <ErrorState compact message={errorMessage(error)} onRetry={() => void refetch()} />
      ) : visible.length === 0 ? (
        <p className="muted panel__empty">Nenhum jogo nesta categoria ainda.</p>
      ) : (
        <ul className="completion-list">
          {visible.map((entry) => (
            <CompletionRow key={entry.gameId} entry={entry} libraryGameId={libraryByRaId.get(entry.gameId)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RecentList() {
  const { data, isLoading, isError, error, refetch } = useRecentAchievements();
  return (
    <section className="panel" aria-labelledby="recent-ach-heading">
      <header className="panel__header">
        <h2 id="recent-ach-heading" className="panel__title">
          Conquistas recentes
        </h2>
      </header>
      {isLoading ? (
        <LoadingBlock label="Carregando conquistas recentes…">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="skeleton--row" />
          ))}
        </LoadingBlock>
      ) : isError ? (
        <ErrorState compact message={errorMessage(error)} onRetry={() => void refetch()} />
      ) : !data?.length ? (
        <p className="muted panel__empty">Nenhuma conquista nos últimos 30 dias.</p>
      ) : (
        <ul className="recent-list">
          {data.map((a) => (
            <li key={`${a.achievementId}-${a.hardcore}`} className="recent-item">
              <img src={a.badgeUrl} alt="" width={48} height={48} loading="lazy" />
              <div className="recent-item__info">
                <span className="recent-item__title">{a.title}</span>
                <span className="recent-item__desc">{a.description}</span>
                <Link to={`/ra-game/${a.gameId}`} className="recent-item__game">
                  {a.gameTitle}
                </Link>
              </div>
              <div className="recent-item__side">
                <span className="achievement__points">{a.points} pts</span>
                <time dateTime={a.unlockedAt}>{formatRelative(a.unlockedAt)}</time>
                {a.hardcore && <span className="tag tag--hardcore">Hardcore</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
