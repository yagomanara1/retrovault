import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { categoryIconOf } from '@shared/categoryIcons';
import type { Game } from '@shared/types';
import { CategoryIcon } from '@/components/categories/CategoryIcon';
import { useCategories, useCompletionMap, useFillMissingArt, useGames, useMissingGames, useRunningGames, useSettings } from '@/hooks/queries';
import { useToast } from '@/components/ui/Toast';
import { cx } from '@/lib/cx';
import { errorMessage } from '@/lib/api';
import { AddGameDialog } from '@/components/library/AddGameDialog';
import { GameCard } from '@/components/library/GameCard';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '@/components/ui/States';
import { ImageIcon, LibraryIcon, PlayIcon, PlusIcon } from '@/components/ui/icons';
import { showsConsoleHome, useLibraryView } from '@/hooks/useLibraryView';
import { ConsoleHome } from './ConsoleHome';

const RECENT_LIMIT = 6;

/** Botão-pílula de filtro (aria-pressed: estado ligado/desligado anunciado por leitores de tela). */
function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={cx('category-filter__chip', active && 'category-filter__chip--active')} aria-pressed={active} onClick={onClick}>
      {children}
    </button>
  );
}

/**
 * "Buscar artes que faltam": capa, fundo e ícone do SteamGridDB para os jogos de PC sem capa.
 * Só aparece com a chave conectada e quando há algum jogo de PC sem capa.
 */
function FillMissingArtButton({ games }: { games: readonly Game[] }) {
  const { data: settings } = useSettings();
  const fill = useFillMissingArt();
  const toast = useToast();
  const missing = games.filter((g) => g.kind === 'executable' && !g.coverUrl).length;
  if (!settings?.hasSgdbKey || missing === 0) return null;
  return (
    <Button
      size="sm"
      icon={<ImageIcon size={14} />}
      loading={fill.isPending}
      onClick={() =>
        fill.mutate(undefined, {
          onSuccess: ({ updated, notFound }) =>
            toast.push({
              tone: updated > 0 ? 'success' : 'info',
              title: updated > 0 ? `${updated} ${updated === 1 ? 'jogo ganhou' : 'jogos ganharam'} arte` : 'Nenhuma arte nova',
              description: notFound.length ? `Sem resultado: ${notFound.slice(0, 4).join(', ')}${notFound.length > 4 ? '…' : ''}. Ajuste o nome ou busque em "Editar arte".` : undefined,
            }),
          onError: (err) => toast.push({ tone: 'error', title: 'A busca de artes falhou', description: errorMessage(err) }),
        })
      }
    >
      Buscar artes ({missing})
    </Button>
  );
}

/** Valor do filtro na URL: id da categoria, "nenhuma" (sem categoria) ou ausente (todos). */
const UNCATEGORIZED = 'nenhuma';

export function LibraryHome() {
  const [view, setView] = useLibraryView();
  const { data: games } = useGames();
  // Tela inicial estilo PS5 (padrão); biblioteca vazia, carregando ou com erro: a grade mostra o estado certo.
  if (showsConsoleHome(view, games?.length)) return <ConsoleHome onShowGrid={() => setView('grid')} />;
  return <LibraryGrid onShowConsole={() => setView('console')} />;
}

function LibraryGrid({ onShowConsole }: { onShowConsole: () => void }) {
  const { data: games, isLoading, isError, error, refetch } = useGames();
  const { data: categories = [] } = useCategories();
  const { data: running = [] } = useRunningGames();
  const missing = useMissingGames();
  const progressByRaId = useCompletionMap();
  const [addOpen, setAddOpen] = useState(false);
  // O filtro fica na URL: voltar/avançar e recarregar mantêm a categoria escolhida.
  const [params, setParams] = useSearchParams();
  const filter = params.get('categoria');
  const activeCategory = categories.find((c) => String(c.id) === filter) ?? null;
  // Só as categorias com algum jogo (há uma pronta para cada console); a escolhida fica mesmo se esvaziar.
  const shownCategories = categories.filter((c) => c.gameCount > 0 || c.id === activeCategory?.id);

  const recent = useMemo(
    () =>
      (games ?? [])
        .filter((g) => g.lastPlayedAt)
        .sort((a, b) => b.lastPlayedAt!.localeCompare(a.lastPlayedAt!))
        .slice(0, RECENT_LIMIT),
    [games],
  );

  const visible = useMemo(() => {
    const all = games ?? [];
    if (filter === UNCATEGORIZED) return all.filter((g) => g.categoryIds.length === 0);
    if (activeCategory) return all.filter((g) => g.categoryIds.includes(activeCategory.id));
    return all;
  }, [games, filter, activeCategory]);
  const hasUncategorized = (games ?? []).some((g) => g.categoryIds.length === 0);

  if (isLoading) {
    return (
      <div className="page">
        <LoadingBlock label="Carregando biblioteca…">
          <div className="grid grid--games">
            {Array.from({ length: 12 }, (_, i) => (
              <Skeleton key={i} className="skeleton--card" />
            ))}
          </div>
        </LoadingBlock>
      </div>
    );
  }

  if (isError) return <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />;

  if (!games?.length) {
    return (
      <>
        <EmptyState
          icon={<LibraryIcon size={40} />}
          title="Sua biblioteca está vazia"
          description="Adicione ROMs para jogar no RetroArch com conquistas, ou qualquer executável do seu PC."
          action={
            <Button variant="primary" icon={<PlusIcon />} onClick={() => setAddOpen(true)}>
              Adicionar primeiro jogo
            </Button>
          }
        />
        <AddGameDialog open={addOpen} onClose={() => setAddOpen(false)} />
      </>
    );
  }

  const renderCard = (g: Game) => (
    <GameCard
      key={g.id}
      game={g}
      running={running.includes(g.id)}
      missing={missing.has(g.id)}
      progress={g.raGameId ? progressByRaId.get(g.raGameId) : undefined}
    />
  );

  const filtering = filter !== null;
  const title =
    filter === UNCATEGORIZED ? 'Sem categoria' : activeCategory ? activeCategory.name : 'Todos os jogos';

  return (
    <div className="page">
      <div className="library-toolbar">
        <Button size="sm" icon={<PlayIcon size={14} />} onClick={onShowConsole}>
          Tela inicial
        </Button>
        <FillMissingArtButton games={games} />
      </div>
      {shownCategories.length > 0 && (
        <nav className="category-filter" aria-label="Filtrar por categoria">
          <FilterChip active={!filtering} onClick={() => setParams({}, { replace: true })}>
            Todos
          </FilterChip>
          {shownCategories.map((c) => (
            <FilterChip key={c.id} active={activeCategory?.id === c.id} onClick={() => setParams({ categoria: String(c.id) }, { replace: true })}>
              <CategoryIcon icon={categoryIconOf(c)} size={18} />
              {c.name}
              <span className="category-filter__count">{c.gameCount}</span>
            </FilterChip>
          ))}
          {hasUncategorized && (
            <FilterChip active={filter === UNCATEGORIZED} onClick={() => setParams({ categoria: UNCATEGORIZED }, { replace: true })}>
              Sem categoria
            </FilterChip>
          )}
        </nav>
      )}
      {!filtering && recent.length > 0 && (
        <section aria-labelledby="recent-heading" className="page__section">
          <h2 id="recent-heading" className="section-title">
            Jogados recentemente
          </h2>
          <div className="grid grid--games">{recent.map(renderCard)}</div>
        </section>
      )}
      <section aria-labelledby="all-heading" className="page__section">
        <h2 id="all-heading" className="section-title">
          {title} ({visible.length})
        </h2>
        {visible.length === 0 ? (
          <p className="muted">Nenhum jogo nesta categoria. Abra um jogo e use o botão de categorias para adicioná-lo.</p>
        ) : (
          <div className="grid grid--games">{visible.map(renderCard)}</div>
        )}
      </section>
    </div>
  );
}
