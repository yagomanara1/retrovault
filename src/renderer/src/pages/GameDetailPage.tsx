import { useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { consoleName } from '@shared/consoles';
import type { Game } from '@shared/types';
import {
  useCategories,
  useEmulators,
  useGame,
  useGameProgress,
  useLaunchGame,
  useMissingGames,
  useRaEnabled,
  useRematchGame,
  useRunningGames,
  useStoreInstalls,
  useStoreUpdates,
  useTrophySet,
  useUpdateGame,
} from '@/hooks/queries';
import { categoryIconOf } from '@shared/categoryIcons';
import { CategoryIcon } from '@/components/categories/CategoryIcon';
import { CategoryPicker } from '@/components/categories/CategoryPicker';
import { SavePanel } from '@/components/saves/SavePanel';
import { TrophyPanel } from '@/components/trophies/TrophyPanel';
import { TrophySetup } from '@/components/trophies/TrophySetup';
import { TROPHY_SOURCE_LABEL } from '@/components/trophies/trophyUtils';
import { emulatorLabel } from '@/components/settings/EmulatorsSection';
import { errorMessage, isApiError } from '@/lib/api';
import { formatPlaytime, formatRelative } from '@/lib/format';
import { AchievementPanel } from '@/components/achievements/AchievementPanel';
import { ArtworkDialog } from '@/components/library/ArtworkDialog';
import { GameSettingsDialog } from '@/components/library/GameSettingsDialog';
import { LinkRaGameDialog } from '@/components/library/LinkRaGameDialog';
import { MissingFileNotice } from '@/components/library/MissingFileNotice';
import { matchFeedback } from '@/components/library/matchFeedback';
import { Button } from '@/components/ui/Button';
import { CoverImage } from '@/components/ui/CoverImage';
import { EmptyState, LoadingBlock, Skeleton } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { DownloadIcon, GearIcon, ImageIcon, LinkIcon, PlayIcon, RefreshIcon, StarIcon, TagIcon, TrophyIcon } from '@/components/ui/icons';

export function GameDetailPage() {
  const gameId = Number(useParams().id);
  const { data: game, isLoading } = useGame(gameId);

  if (isLoading) {
    return (
      <LoadingBlock label="Carregando jogo…">
        <Skeleton className="skeleton--hero" />
      </LoadingBlock>
    );
  }
  if (!game) {
    return (
      <EmptyState
        title="Jogo não encontrado"
        description="Ele pode ter sido removido da biblioteca."
        action={
          <Link className="btn btn--primary btn--md" to="/">
            Voltar para a biblioteca
          </Link>
        }
      />
    );
  }
  // key = id: reinicia estados locais (diálogos) ao trocar de jogo.
  return <GameDetail key={game.id} game={game} />;
}

/** Jogo instalado pela Loja com versão nova do port: aviso com atalho para a página do port. */
function PortUpdateNotice({ gameId }: { gameId: number }) {
  const { data: installsData } = useStoreInstalls();
  const { data: updates } = useStoreUpdates();
  const install = installsData?.installs.find((i) => i.gameId === gameId);
  const update = install ? updates?.[install.portId] : undefined;
  if (!install || !update) return null;
  return (
    <p className="hero__update" role="status">
      <DownloadIcon size={16} />
      <span>
        Versão nova do port: <strong>{update.name || update.tag}</strong> (você tem {install.tag}).
      </span>
      <Link className="btn btn--secondary btn--sm" to={`/loja?port=${encodeURIComponent(install.portId)}`}>
        Atualizar na Loja
      </Link>
    </p>
  );
}

function GameDetail({ game }: { game: Game }) {
  const navigate = useNavigate();
  const toast = useToast();
  const raEnabled = useRaEnabled();
  const { data: running = [] } = useRunningGames();
  const { data: progress } = useGameProgress(game.raGameId);
  const launch = useLaunchGame();
  const update = useUpdateGame();
  const rematch = useRematchGame();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [artworkOpen, setArtworkOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const { data: categories = [] } = useCategories();
  const gameCategories = categories.filter((c) => game.categoryIds.includes(c.id));
  const { data: trophySet, isSuccess: trophiesLoaded } = useTrophySet(game.id);

  const connectRa = (
    <EmptyState
      compact
      icon={<TrophyIcon size={28} />}
      title="Conecte sua conta do RetroAchievements"
      description="Informe seu usuário e Web API Key para ver as conquistas do RetroAchievements."
      action={
        <Link className="btn btn--primary btn--md" to="/settings">
          Abrir configurações
        </Link>
      }
    />
  );

  const isRunning = running.includes(game.id);
  const isMissing = useMissingGames().has(game.id);
  const heroImage = game.backgroundUrl ?? progress?.ingameImageUrl ?? progress?.titleImageUrl ?? null;
  // ROM que abre num emulador próprio (Configurações → Emuladores): aparece ao lado do console.
  const { data: emulators } = useEmulators();
  const opener = game.kind === 'retroarch' ? emulators?.consoles.find((c) => c.consoleId === game.consoleId)?.effective : undefined;
  const platform =
    game.kind === 'retroarch'
      ? `${consoleName(game.consoleId)}${opener && opener !== 'retroarch' ? ` · abre no ${emulatorLabel(opener)}` : ''}`
      : game.steamAppId
        ? 'PC · abre pela Steam'
        : progress?.consoleName || TROPHY_SOURCE_LABEL[trophySet?.source ?? 'manual'];

  function handleLaunch() {
    launch.mutate(game.id, {
      onError: (err) => {
        toast.push({ tone: 'error', title: 'Não foi possível iniciar', description: errorMessage(err) });
        if (isApiError(err, 'CORE_MISSING')) setSettingsOpen(true);
        if (isApiError(err, 'RETROARCH_NOT_FOUND')) navigate('/settings');
        if (isApiError(err, 'EMULATOR_NOT_FOUND')) navigate('/settings?secao=emuladores');
      },
    });
  }

  function handleRematch() {
    rematch.mutate(game.id, {
      onSuccess: (result) => toast.push(matchFeedback(result)),
      onError: (err) => toast.push({ tone: 'error', title: 'Falha na identificação', description: errorMessage(err) }),
    });
  }

  return (
    <article className="game-detail">
      <header
        className={game.backgroundUrl ? 'hero hero--custom-bg' : 'hero'}
        style={heroImage ? ({ '--hero-image': `url("${heroImage}")` } as CSSProperties) : undefined}>
        <div className="hero__backdrop" aria-hidden="true" />
        <div className="hero__content">
          <CoverImage cover={game.coverUrl} icon={game.iconUrl} title={game.title} className="hero__cover" />
          <div className="hero__info">
            <p className="hero__platform">{platform}</p>
            <h1 className="hero__title">{game.title}</h1>
            {gameCategories.length > 0 && (
              <ul className="hero__categories" aria-label="Categorias">
                {gameCategories.map((c) => (
                  <li key={c.id}>
                    <Link to={`/?categoria=${c.id}`} className="hero__category">
                      <CategoryIcon icon={categoryIconOf(c)} size={16} />
                      {c.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <div className="hero__actions">
              <Button
                variant="play"
                size="lg"
                icon={<PlayIcon />}
                onClick={handleLaunch}
                loading={launch.isPending}
                disabled={isRunning || isMissing}
                title={isMissing ? 'Arquivo do jogo não encontrado' : undefined}
              >
                {isRunning ? 'Em execução' : 'Jogar'}
              </Button>
              <Button
                variant="ghost"
                icon={<StarIcon filled={game.favorite} />}
                aria-pressed={game.favorite}
                aria-label={game.favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
                onClick={() => update.mutate({ id: game.id, favorite: !game.favorite })}
              />
              <Button variant="ghost" icon={<TagIcon />} aria-label="Categorias" title="Categorias" onClick={() => setCategoriesOpen(true)} />
              <Button variant="ghost" icon={<ImageIcon />} aria-label="Editar arte" title="Editar arte" onClick={() => setArtworkOpen(true)} />
              <Button variant="ghost" icon={<GearIcon />} aria-label="Propriedades do jogo" onClick={() => setSettingsOpen(true)} />
            </div>
            <PortUpdateNotice gameId={game.id} />
            <dl className="hero__stats">
              <div>
                <dt>Tempo de jogo</dt>
                <dd>{formatPlaytime(game.playtimeSeconds)}</dd>
              </div>
              <div>
                <dt>Última vez</dt>
                <dd>{formatRelative(game.lastPlayedAt)}</dd>
              </div>
              {progress && progress.numAchievements > 0 && (
                <div>
                  <dt>Conquistas</dt>
                  <dd>
                    <TrophyIcon size={14} /> {progress.earned}/{progress.numAchievements}
                  </dd>
                </div>
              )}
              {trophySet && trophySet.trophies.length > 0 && (
                <div>
                  <dt>Troféus</dt>
                  <dd>
                    <TrophyIcon size={14} /> {trophySet.trophies.filter((t) => t.unlockedAt).length}/
                    {trophySet.trophies.length}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      </header>

      <div className="game-detail__body">
        {isMissing && <MissingFileNotice game={game} />}

        {game.raGameId &&
          (raEnabled ? (
            <>
              <div className="game-detail__link-bar">
                <span className="muted">
                  RetroAchievements ID {game.raGameId}
                  {progress && ` · ${progress.title}`}
                </span>
                <Button variant="ghost" size="sm" icon={<LinkIcon />} onClick={() => setLinkOpen(true)}>
                  Alterar vínculo
                </Button>
              </div>
              <AchievementPanel raGameId={game.raGameId} />
            </>
          ) : (
            connectRa
          ))}

        {trophySet && <TrophyPanel game={game} set={trophySet} />}

        <SavePanel game={game} />

        {/* Sem nenhuma fonte de conquistas: oferece as duas opções lado a lado. */}
        {!game.raGameId && trophiesLoaded && !trophySet && (
          <div className={game.kind === 'executable' ? 'achievement-sources' : 'achievement-sources achievement-sources--ra-first'}>
            <div className="source-card">
              <TrophySetup game={game} />
            </div>
            <div className="source-card">
              {raEnabled ? (
                <EmptyState
                  compact
                  icon={<LinkIcon size={28} />}
                  title="RetroAchievements"
                  description={
                    game.kind === 'retroarch'
                      ? 'Não conseguimos identificar esta ROM automaticamente. Tente novamente ou vincule manualmente.'
                      : 'Se este jogo roda em um emulador com RetroAchievements (PCSX2, DuckStation, PPSSPP, Dolphin…), vincule-o para acompanhar as conquistas.'
                  }
                  action={
                    <>
                      {game.kind === 'retroarch' && (
                        <Button icon={<RefreshIcon />} onClick={handleRematch} loading={rematch.isPending}>
                          Identificar automaticamente
                        </Button>
                      )}
                      <Button variant="primary" icon={<LinkIcon />} onClick={() => setLinkOpen(true)}>
                        Vincular ao RetroAchievements
                      </Button>
                    </>
                  }
                />
              ) : (
                connectRa
              )}
            </div>
          </div>
        )}
      </div>

      <GameSettingsDialog game={game} open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <LinkRaGameDialog game={game} open={linkOpen} onClose={() => setLinkOpen(false)} />
      <ArtworkDialog game={game} open={artworkOpen} onClose={() => setArtworkOpen(false)} />
      <CategoryPicker game={game} open={categoriesOpen} onClose={() => setCategoriesOpen(false)} />
    </article>
  );
}
