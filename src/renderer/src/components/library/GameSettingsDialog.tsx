import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CONSOLES_BY_NAME, suggestCore } from '@shared/consoles';
import type { Game } from '@shared/types';
import { useRemoveGame, useRetroArchStatus, useUpdateGame } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { Button } from '../ui/Button';
import { SelectField, TextField } from '../ui/Form';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';

interface GameSettingsDialogProps {
  game: Game;
  open: boolean;
  onClose: () => void;
}

export function GameSettingsDialog({ game, open, onClose }: GameSettingsDialogProps) {
  return (
    <Modal open={open} onClose={onClose} title="Propriedades do jogo" description={game.path}>
      <GameSettingsForm game={game} onDone={onClose} />
    </Modal>
  );
}

function GameSettingsForm({ game, onDone }: { game: Game; onDone: () => void }) {
  const [title, setTitle] = useState(game.title);
  const [consoleId, setConsoleId] = useState<number | null>(game.consoleId);
  const [corePath, setCorePath] = useState<string | null>(game.corePath);
  const [launchArgs, setLaunchArgs] = useState(game.launchArgs ?? '');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: retroarch } = useRetroArchStatus();
  const update = useUpdateGame();
  const remove = useRemoveGame();
  const toast = useToast();
  const navigate = useNavigate();
  const cores = retroarch?.cores ?? [];
  const isRom = game.kind === 'retroarch';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      setError('O nome não pode ficar vazio.');
      return;
    }
    try {
      await update.mutateAsync({
        id: game.id,
        title: title.trim(),
        ...(isRom ? { consoleId, corePath } : { launchArgs: launchArgs.trim() || null }),
      });
      toast.push({ tone: 'success', title: 'Alterações salvas' });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleRemove() {
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    try {
      await remove.mutateAsync(game.id);
      toast.push({ tone: 'info', title: `${game.title} removido da biblioteca`, description: 'O arquivo do jogo não foi apagado.' });
      onDone();
      navigate('/');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <TextField
        label="Nome"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={200}
        required
        error={error && !title.trim() ? error : null}
      />

      {isRom ? (
        <>
          <SelectField
            label="Console"
            value={consoleId == null ? '' : String(consoleId)}
            onChange={(v) => {
              const id = v ? Number(v) : null;
              setConsoleId(id);
              if (!corePath) setCorePath(suggestCore(id, cores));
            }}
            options={[{ value: '', label: 'Desconhecido' }, ...CONSOLES_BY_NAME.map((c) => ({ value: String(c.id), label: c.name }))]}
          />
          <SelectField
            label="Core do RetroArch"
            value={corePath ?? ''}
            onChange={(v) => setCorePath(v || null)}
            options={[
              { value: '', label: 'Automático (sugerido pelo console)' },
              ...cores.map((c) => ({ value: c.path, label: c.name })),
              // Mantém visível um core configurado que não está mais na pasta.
              ...(corePath && !cores.some((c) => c.path === corePath) ? [{ value: corePath, label: `${corePath} (não encontrado)` }] : []),
            ]}
          />
        </>
      ) : game.steamAppId ? (
        // Abre pela Steam: argumentos daqui não chegariam ao jogo.
        <p className="muted">
          Este jogo abre pela Steam. As opções de inicialização ficam nas propriedades dele, na própria Steam.
        </p>
      ) : (
        <TextField
          label="Argumentos de inicialização"
          value={launchArgs}
          onChange={(e) => setLaunchArgs(e.target.value)}
          maxLength={2000}
        />
      )}

      {error && title.trim() && (
        <p className="form__error" role="alert">
          {error}
        </p>
      )}

      <div className="form__actions form__actions--split">
        <Button variant="danger" onClick={() => void handleRemove()} loading={remove.isPending}>
          {confirmRemove ? 'Clique de novo para confirmar' : 'Remover da biblioteca'}
        </Button>
        <div className="form__actions">
          <Button variant="ghost" onClick={onDone}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" loading={update.isPending}>
            Salvar
          </Button>
        </div>
      </div>
    </form>
  );
}
