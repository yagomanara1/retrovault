import { useId, useState } from 'react';
import type { ArtworkSlot, Game } from '@shared/types';
import { useSetArtwork } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { cx } from '@/lib/cx';
import { Button } from '../ui/Button';
import { CoverImage } from '../ui/CoverImage';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { CropIcon, FolderIcon, ImageIcon, RefreshIcon } from '../ui/icons';
import { FramingEditor } from './FramingEditor';
import { OnlineArtSearch } from './OnlineArtSearch';

interface SlotConfig {
  slot: ArtworkSlot;
  label: string;
  hint: (game: Game) => string;
}

const SLOTS: readonly SlotConfig[] = [
  {
    slot: 'cover',
    label: 'Capa',
    hint: (g) =>
      g.raGameId
        ? 'Vertical, proporção 3:4 (ex.: 600×800). Padrão: capa do RetroAchievements.'
        : 'Vertical, proporção 3:4 (ex.: 600×800).',
  },
  {
    slot: 'background',
    label: 'Fundo',
    hint: (g) =>
      g.raGameId
        ? 'Horizontal e larga (ex.: 1920×620). Padrão: captura do jogo no RetroAchievements.'
        : 'Horizontal e larga (ex.: 1920×620).',
  },
  {
    slot: 'icon',
    label: 'Ícone',
    hint: (g) =>
      g.kind === 'executable'
        ? 'Padrão: extraído do executável. Aceita imagens ou outro .exe.'
        : 'Quadrado (ex.: 256×256). Aceita imagens ou um .exe.',
  },
];

interface ArtworkDialogProps {
  game: Game;
  open: boolean;
  onClose: () => void;
}

export function ArtworkDialog({ game, open, onClose }: ArtworkDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Editar arte"
      description="Personalize a capa, o fundo e o ícone exibidos na biblioteca."
      size="lg"
    >
      <div className="artwork-grid">
        {SLOTS.map((config) => (
          <ArtworkSlotEditor key={config.slot} game={game} config={config} />
        ))}
      </div>
      <OnlineArtSearch game={game} onDone={onClose} />
    </Modal>
  );
}

function ArtworkPreview({ game, slot }: { game: Game; slot: ArtworkSlot }) {
  if (slot === 'cover') {
    return <CoverImage cover={game.coverUrl} icon={game.iconUrl} title={game.title} className="artwork-preview__cover" />;
  }
  if (slot === 'background') {
    return game.backgroundUrl ? (
      <div className="artwork-preview__background" style={{ backgroundImage: `url("${game.backgroundUrl}")` }} />
    ) : (
      <div className="artwork-preview__background artwork-preview__background--empty">
        <ImageIcon size={28} />
        <span>{game.raGameId ? 'Usando a captura do RetroAchievements' : 'Sem imagem de fundo'}</span>
      </div>
    );
  }
  return (
    <div className="artwork-preview__icon">
      {game.iconUrl ? <img src={game.iconUrl} alt="" width={96} height={96} /> : <ImageIcon size={32} />}
    </div>
  );
}

function ArtworkSlotEditor({ game, config }: { game: Game; config: SlotConfig }) {
  const headingId = useId();
  const setArtwork = useSetArtwork();
  const toast = useToast();
  const [pending, setPending] = useState<'pick' | 'reset' | null>(null);
  const [framing, setFraming] = useState(false);
  // Só artes do cofre local podem ser enquadradas (as do RetroAchievements vêm da internet).
  const current = { cover: game.coverUrl, background: game.backgroundUrl, icon: game.iconUrl }[config.slot];
  const canFrame = !!current && current.startsWith('rv-media://');

  async function run(action: 'pick' | 'reset') {
    setPending(action);
    try {
      const updated = await setArtwork.mutateAsync({ id: game.id, slot: config.slot, action });
      if (updated) {
        toast.push({
          tone: 'success',
          title: action === 'pick' ? 'Arte atualizada' : 'Arte restaurada',
          description: `${config.label} de ${game.title}`,
        });
      }
    } catch (err) {
      toast.push({ tone: 'error', title: `Falha ao alterar: ${config.label}`, description: errorMessage(err) });
    } finally {
      setPending(null);
    }
  }

  return (
    <section className={cx('artwork-slot', `artwork-slot--${config.slot}`)} aria-labelledby={headingId}>
      <h3 id={headingId} className="artwork-slot__title">
        {config.label}
      </h3>
      <div className="artwork-slot__preview" aria-busy={pending !== null}>
        <ArtworkPreview game={game} slot={config.slot} />
      </div>
      <p className="field__hint">{config.hint(game)}</p>
      <div className="artwork-slot__actions">
        <Button
          variant="primary"
          size="sm"
          icon={<FolderIcon size={14} />}
          loading={pending === 'pick'}
          disabled={pending !== null}
          onClick={() => void run('pick')}
        >
          Escolher…
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<RefreshIcon size={14} />}
          loading={pending === 'reset'}
          disabled={pending !== null}
          onClick={() => void run('reset')}
        >
          Restaurar padrão
        </Button>
        {canFrame && (
          <Button variant="ghost" size="sm" icon={<CropIcon size={14} />} disabled={pending !== null} onClick={() => setFraming(true)}>
            Ajustar…
          </Button>
        )}
      </div>
      {canFrame && <FramingEditor game={game} slot={config.slot} sourceUrl={current!} open={framing} onClose={() => setFraming(false)} />}
    </section>
  );
}
