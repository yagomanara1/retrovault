import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type WheelEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { consoleName } from '@shared/consoles';
import type { Category, Game } from '@shared/types';
import { categoryIconOf } from '@shared/categoryIcons';
import {
  useCategories,
  useGameProgress,
  useGames,
  useLaunchGame,
  useMissingGames,
  useRunningGames,
  useTrophySet,
} from '@/hooks/queries';
import { useGamepadNavigation } from '@/hooks/useGamepadNavigation';
import { errorMessage } from '@/lib/api';
import { cx } from '@/lib/cx';
import { formatPlaytime } from '@/lib/format';
import { CategoryIcon } from '@/components/categories/CategoryIcon';
import { TROPHY_SOURCE_LABEL, trophyStats } from '@/components/trophies/trophyUtils';
import { useToast } from '@/components/ui/Toast';
import { TopMenu } from '@/components/layout/TopMenu';
import { PlayIcon, TrophyIcon } from '@/components/ui/icons';

const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Tela inicial no estilo do PlayStation 5: arte do jogo em tela cheia, fileira de blocos no topo,
// título e "Jogar" embaixo à esquerda, capa e troféus à direita. ← → / controle trocam o jogo.

/** Mais recentes primeiro (como o console), depois por nome. */
function orderGames(games: readonly Game[]): Game[] {
  return [...games].sort((a, b) => {
    if (a.lastPlayedAt && b.lastPlayedAt) return b.lastPlayedAt.localeCompare(a.lastPlayedAt);
    if (a.lastPlayedAt) return -1;
    if (b.lastPlayedAt) return 1;
    return a.title.localeCompare(b.title, 'pt-BR');
  });
}

/** A faixa de abas rola na horizontal: a roda do mouse (vertical) passa a mover para os lados. */
function scrollTabsSideways(event: WheelEvent<HTMLElement>) {
  const el = event.currentTarget;
  if (el.scrollWidth <= el.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
  el.scrollLeft += event.deltaY;
}

interface ConsoleHomeProps {
  onShowGrid: () => void;
}

export function ConsoleHome({ onShowGrid }: ConsoleHomeProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const { data: games = [] } = useGames();
  const { data: categories = [] } = useCategories();
  const { data: running = [] } = useRunningGames();
  const missing = useMissingGames();
  const launch = useLaunchGame();
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  // A lupa das outras telas chega aqui com a busca já aberta.
  const openSearch = !!(useLocation().state as { openSearch?: boolean } | null)?.openSearch;

  const list = useMemo(() => {
    const needle = normalize(deferredQuery.trim());
    const filtered = games.filter(
      (g) => (categoryId === null || g.categoryIds.includes(categoryId)) && (!needle || normalize(g.title).includes(needle)),
    );
    return orderGames(filtered);
  }, [games, categoryId, deferredQuery]);
  // Jogo selecionado sumiu do filtro (ou nada escolhido ainda): o primeiro da fileira.
  const selected = list.find((g) => g.id === selectedId) ?? list[0] ?? null;
  const index = selected ? list.indexOf(selected) : -1;

  const move = (delta: number) => {
    if (list.length === 0) return;
    const next = list[Math.min(list.length - 1, Math.max(0, index + delta))]!;
    setSelectedId(next.id);
  };
  const play = (game: Game | null = selected) => {
    if (!game || running.includes(game.id) || missing.has(game.id)) return;
    launch.mutate(game.id, {
      onError: (err) => toast.push({ tone: 'error', title: 'Não foi possível iniciar', description: errorMessage(err) }),
    });
  };
  const openDetails = () => selected && navigate(`/game/${selected.id}`);
  // Callback estável para os blocos (memo): lê sempre a versão mais nova de `play`.
  const playRef = useRef(play);
  playRef.current = play;
  const playTile = useCallback((game: Game) => playRef.current(game), []);

  useGamepadNavigation({ onLeft: () => move(-1), onRight: () => move(1), onConfirm: () => play(), onSecondary: openDetails });

  if (games.length === 0) return null; // a biblioteca vazia mostra o estado vazio da grade

  return (
    <div className="ps-home">
      <HeroBackdrop game={selected} />

      <header className="ps-home__top">
        <nav className="ps-home__tabs" aria-label="Filtrar por categoria" onWheel={scrollTabsSideways}>
          <TabButton active={categoryId === null} onClick={() => setCategoryId(null)}>
            Jogos
          </TabButton>
          {categories
            .filter((c) => c.gameCount > 0)
            .map((c) => (
              <TabButton key={c.id} active={categoryId === c.id} onClick={() => setCategoryId(c.id)} category={c}>
                {c.name}
              </TabButton>
            ))}
        </nav>
        <TopMenu search={{ query, onQueryChange: setQuery, initiallyOpen: openSearch }} onShowGrid={onShowGrid} />
      </header>

      {list.length === 0 ? (
        <p className="ps-home__empty" role="status">
          Nenhum jogo encontrado{query.trim() ? ` para “${query.trim()}”` : ' nesta categoria'}.
        </p>
      ) : (
        <GameRow list={list} selected={selected} running={running} onSelect={setSelectedId} onMove={move} onPlay={playTile} />
      )}

      {selected && (
        <div className="ps-home__bottom">
          <GameInfo
            game={selected}
            running={running.includes(selected.id)}
            missing={missing.has(selected.id)}
            launching={launch.isPending}
            onPlay={() => play()}
            onDetails={openDetails}
          />
          {/* `key`: os cartões entram de novo (com animação) a cada jogo selecionado. */}
          <SideCards key={selected.id} game={selected} />
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, category, children }: { active: boolean; onClick: () => void; category?: Category; children: string }) {
  return (
    <button
      type="button"
      className={cx('ps-home__tab', active && 'ps-home__tab--active')}
      aria-pressed={active}
      onClick={(e) => {
        onClick();
        e.currentTarget.scrollIntoView({ inline: 'nearest', block: 'nearest' }); // a faixa rola até a aba escolhida
      }}
      onFocus={(e) => e.currentTarget.scrollIntoView({ inline: 'nearest', block: 'nearest' })}
    >
      {category && <CategoryIcon icon={categoryIconOf(category)} size={18} />}
      {children}
    </button>
  );
}

// ---------- Fundo em tela cheia com transição cruzada ----------

interface Layer {
  key: number;
  url: string | null;
  /** Sem arte de fundo: a capa ampliada e desfocada. */
  soft: boolean;
}

function HeroBackdrop({ game }: { game: Game | null }) {
  const { data: progress } = useGameProgress(game?.raGameId ?? null);
  const wide = game?.backgroundUrl ?? progress?.ingameImageUrl ?? progress?.titleImageUrl ?? null;
  const url = wide ?? game?.coverUrl ?? game?.iconUrl ?? null;
  const soft = !wide;
  const [layers, setLayers] = useState<Layer[]>([]);
  const counter = useRef(0);

  // Mantém as duas últimas camadas: a nova entra por cima com fade, a anterior some depois.
  useEffect(() => {
    setLayers((prev) => (prev.at(-1)?.url === url ? prev : [...prev.slice(-1), { key: ++counter.current, url, soft }]));
  }, [url, soft]);

  return (
    <div className="ps-home__backdrop" aria-hidden="true">
      {layers.map((l) => (
        <div
          key={l.key}
          className={cx('ps-home__layer', l.soft && 'ps-home__layer--soft')}
          style={l.url ? ({ backgroundImage: `url("${l.url}")` } as CSSProperties) : undefined}
        />
      ))}
      <div className="ps-home__scrim" />
    </div>
  );
}

// ---------- Fileira de jogos ----------

interface GameRowProps {
  list: Game[];
  selected: Game | null;
  running: number[];
  onSelect: (id: number) => void;
  onMove: (delta: number) => void;
  onPlay: (game: Game) => void;
}

/** Roving tabindex: Tab entra no jogo selecionado, ← → navegam, Enter (no selecionado) joga. */
function GameRow({ list, selected, running, onSelect, onMove, onPlay }: GameRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);

  // Mantém o selecionado visível e com foco quando a navegação vem do teclado/controle.
  useEffect(() => {
    const el = rowRef.current?.querySelector<HTMLButtonElement>('[aria-current="true"]');
    el?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
    if (el && rowRef.current?.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, [selected?.id]);

  // Pré-carrega a arte dos vizinhos: a troca fica instantânea.
  useEffect(() => {
    const i = selected ? list.indexOf(selected) : -1;
    for (const g of [list[i - 1], list[i + 1]]) {
      const src = g?.backgroundUrl ?? g?.coverUrl;
      if (src) new Image().src = src;
    }
  }, [selected, list]);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      onMove(e.key === 'ArrowLeft' ? -1 : 1);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      onMove(e.key === 'Home' ? -list.length : list.length);
    }
  }

  return (
    <div ref={rowRef} className="ps-home__row" role="toolbar" aria-label="Jogos" aria-orientation="horizontal" onKeyDown={onKeyDown}>
      {list.map((g) => (
        <Tile
          key={g.id}
          game={g}
          selected={g.id === selected?.id}
          running={running.includes(g.id)}
          onSelect={onSelect}
          onPlay={onPlay}
        />
      ))}
    </div>
  );
}

const Tile = memo(function Tile({
  game,
  selected,
  running,
  onSelect,
  onPlay,
}: {
  game: Game;
  selected: boolean;
  running: boolean;
  onSelect: (id: number) => void;
  onPlay: (game: Game) => void;
}) {
  const art = game.iconUrl ?? game.coverUrl;
  return (
    <div className={cx('ps-tile', selected && 'ps-tile--selected')}>
      <button
        type="button"
        className="ps-tile__button"
        tabIndex={selected ? 0 : -1}
        aria-current={selected}
        aria-label={`${game.title}${running ? ' (em execução)' : ''}`}
        onClick={() => onSelect(game.id)}
        onDoubleClick={() => onPlay(game)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && selected) {
            e.preventDefault();
            onPlay(game);
          }
        }}
      >
        {art ? <img src={art} alt="" loading="lazy" decoding="async" /> : <span className="ps-tile__initials">{game.title.slice(0, 2)}</span>}
        {running && <span className="ps-tile__running" />}
      </button>
      {selected && <span className="ps-tile__caption">{game.title}</span>}
    </div>
  );
});

// ---------- Título e ações ----------

function GameInfo({
  game,
  running,
  missing,
  launching,
  onPlay,
  onDetails,
}: {
  game: Game;
  running: boolean;
  missing: boolean;
  launching: boolean;
  onPlay: () => void;
  onDetails: () => void;
}) {
  const { data: trophySet } = useTrophySet(game.id);
  const { data: categories = [] } = useCategories();
  // A categoria que o usuário deu ao jogo (ex.: "Nintendo DS" para um port de PC) vale mais que o palpite técnico.
  const category = categories.find((c) => game.categoryIds.includes(c.id));
  const platform =
    category?.name ?? (game.kind === 'retroarch' ? consoleName(game.consoleId) : TROPHY_SOURCE_LABEL[trophySet?.source ?? 'manual']);
  return (
    <section className="ps-home__info" aria-label="Jogo selecionado">
      {/*
        aria-live: ao trocar de jogo pelo teclado/controle, o novo título é anunciado.
        O <h1> fica fixo (região viva estável); só o conteúdo com `key` é recriado e reanima.
      */}
      <h1 className="ps-home__title" aria-live="polite">
        <span key={game.id} className="ps-home__swap">
          {game.title}
        </span>
      </h1>
      <p className="ps-home__subtitle">
        <span key={game.id} className="ps-home__swap ps-home__swap--late">
          {platform}
          {game.playtimeSeconds > 0 && ` · ${formatPlaytime(game.playtimeSeconds)} jogados`}
          {missing && ' · arquivo não encontrado'}
        </span>
      </p>
      <div className="ps-home__actions">
        <button type="button" className="ps-home__play" onClick={onPlay} disabled={running || missing || launching}>
          {launching ? 'Abrindo…' : running ? 'Jogando agora' : (
            <>
              <PlayIcon size={16} /> Jogar
            </>
          )}
        </button>
        <button type="button" className="ps-home__more" onClick={onDetails} aria-label={`Detalhes de ${game.title}`} title="Detalhes (△ / Y)">
          <span aria-hidden="true">•••</span>
        </button>
      </div>
      <p className="ps-home__hint" aria-hidden="true">
        ← → trocar · Enter jogar · com controle: ✕ jogar, △ detalhes
      </p>
    </section>
  );
}

// ---------- Cartões à direita ----------

function SideCards({ game }: { game: Game }) {
  const { data: trophySet } = useTrophySet(game.id);
  const { data: progress } = useGameProgress(game.raGameId);
  const local = trophySet && trophySet.trophies.length > 0 ? trophyStats(trophySet.trophies) : null;
  const trophies = local
    ? { percent: local.percent, earned: local.unlocked, total: local.total }
    : progress && progress.numAchievements > 0
      ? { percent: Math.round(progress.completion), earned: progress.earned, total: progress.numAchievements }
      : null;

  return (
    <aside className="ps-home__cards" aria-label="Resumo">
      {game.coverUrl && (
        <div className="ps-card ps-card--cover">
          <img src={game.coverUrl} alt="" decoding="async" />
        </div>
      )}
      {trophies && (
        <div className="ps-card ps-card--trophies">
          <TrophyIcon size={26} />
          <dl>
            <div>
              <dt>Progresso</dt>
              <dd>{trophies.percent}%</dd>
            </div>
            <div>
              <dt>Obtidos</dt>
              <dd>
                {trophies.earned}/{trophies.total}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </aside>
  );
}

