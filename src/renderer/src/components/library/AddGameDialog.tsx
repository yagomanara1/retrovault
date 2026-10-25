import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { canIdentifyFormat, CONSOLES_BY_NAME, suggestCore } from '@shared/consoles';
import type { GameInspection, GameKind } from '@shared/types';
import { useAddGame, useRetroArchStatus } from '@/hooks/queries';
import { call, errorMessage } from '@/lib/api';
import { Button } from '../ui/Button';
import { SegmentedControl, SelectField, TextField } from '../ui/Form';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { FolderIcon } from '../ui/icons';
import { matchFeedback } from './matchFeedback';

const KIND_OPTIONS = [
  { value: 'retroarch', label: 'ROM (RetroArch)' },
  { value: 'executable', label: 'Executável / outro jogo' },
] as const;

const NONE = '';
/** Compactados de disco que o launcher ainda não lê para identificar. */
const PACKED_DISC_EXTENSIONS = new Set(['chd', 'pbp']);

interface AddGameDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AddGameDialog({ open, onClose }: AddGameDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Adicionar jogo"
      description="ROMs abrem no RetroArch com conquistas ativadas. Executáveis abrem diretamente."
      size="md"
    >
      <AddGameForm onDone={onClose} />
    </Modal>
  );
}

/** Formulário separado: o Modal só o monta quando aberto, então o estado reinicia a cada abertura. */
function AddGameForm({ onDone }: { onDone: () => void }) {
  const [kind, setKind] = useState<GameKind>('retroarch');
  const [path, setPath] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [consoleId, setConsoleId] = useState<number | null>(null);
  const [corePath, setCorePath] = useState<string | null>(null);
  const [launchArgs, setLaunchArgs] = useState('');
  const [inspection, setInspection] = useState<GameInspection | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: retroarch } = useRetroArchStatus();
  const addGame = useAddGame();
  const toast = useToast();
  const navigate = useNavigate();
  const cores = retroarch?.cores ?? [];

  function changeKind(next: GameKind) {
    setKind(next);
    setPath(null);
    setInspection(null);
    setTitle('');
    setConsoleId(null);
    setCorePath(null);
    setError(null);
  }

  async function pickFile() {
    setError(null);
    setPicking(true);
    try {
      const selected = await call('dialog:open-file', { kind: kind === 'retroarch' ? 'rom' : 'executable' });
      if (!selected) return;
      const info = await call('games:inspect', { path: selected, kind });
      setPath(selected);
      setInspection(info);
      setTitle(info.suggestedTitle);
      setConsoleId(info.consoleId);
      setCorePath(info.suggestedCorePath);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPicking(false);
    }
  }

  function changeConsole(value: string) {
    const id = value === NONE ? null : Number(value);
    setConsoleId(id);
    setCorePath(suggestCore(id, cores));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!path) {
      setError('Escolha um arquivo primeiro.');
      return;
    }
    setError(null);
    try {
      const isRom = kind === 'retroarch';
      const result = await addGame.mutateAsync({
        kind,
        path,
        title: title.trim() || undefined,
        consoleId: isRom ? consoleId : null,
        corePath: isRom ? corePath : null,
        launchArgs: isRom ? null : launchArgs.trim() || null,
      });
      toast.push(matchFeedback(result));
      onDone();
      navigate(`/game/${result.game.id}`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  // Mesma regra do main (canIdentifyFormat), com o console escolhido manualmente.
  const extension = path?.split('.').pop()?.toLowerCase() ?? '';
  const canIdentify = canIdentifyFormat(consoleId, extension);
  const autoMatchHint =
    kind !== 'retroarch' || !inspection
      ? null
      : canIdentify
        ? 'O jogo será identificado automaticamente no RetroAchievements pelo hash da ROM.'
        : PACKED_DISC_EXTENSIONS.has(extension)
          ? `Arquivos .${extension} ainda não são lidos para identificar o jogo. Em ISO, BIN/CUE ou CSO ele é identificado sozinho; senão, você vincula manualmente depois.`
          : 'Identificação automática indisponível para este formato — você poderá vincular manualmente depois.';

  return (
    <form className="form" onSubmit={submit} noValidate>
      <SegmentedControl label="Tipo de jogo" value={kind} onChange={changeKind} options={KIND_OPTIONS} />

      <div className="field">
        <span className="field__label" id="file-label">
          Arquivo
        </span>
        <div className="file-picker">
          <span className="file-picker__path" aria-labelledby="file-label" title={path ?? undefined}>
            {path ?? 'Nenhum arquivo selecionado'}
          </span>
          <Button icon={<FolderIcon />} onClick={pickFile} loading={picking}>
            Escolher…
          </Button>
        </div>
      </div>

      {path && (
        <>
          <TextField label="Nome na biblioteca" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />

          {kind === 'retroarch' ? (
            <>
              <SelectField
                label="Console"
                value={consoleId == null ? NONE : String(consoleId)}
                onChange={changeConsole}
                options={[
                  { value: NONE, label: 'Selecione…' },
                  ...CONSOLES_BY_NAME.map((c) => ({ value: String(c.id), label: c.name })),
                ]}
                hint={autoMatchHint}
              />
              <SelectField
                label="Core do RetroArch"
                value={corePath ?? NONE}
                onChange={(v) => setCorePath(v === NONE ? null : v)}
                options={[
                  { value: NONE, label: cores.length ? 'Automático / escolher depois' : 'Nenhum core encontrado' },
                  ...cores.map((c) => ({ value: c.path, label: c.name })),
                ]}
                hint={
                  retroarch && !retroarch.found
                    ? 'RetroArch não encontrado — configure o caminho em Configurações.'
                    : undefined
                }
              />
            </>
          ) : (
            <TextField
              label="Argumentos de inicialização (opcional)"
              value={launchArgs}
              onChange={(e) => setLaunchArgs(e.target.value)}
              placeholder='-fullscreen "--profile=Meu Perfil"'
              maxLength={2000}
            />
          )}
        </>
      )}

      {error && (
        <p className="form__error" role="alert">
          {error}
        </p>
      )}

      <div className="form__actions">
        <Button variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" loading={addGame.isPending} disabled={!path}>
          Adicionar à biblioteca
        </Button>
      </div>
    </form>
  );
}
