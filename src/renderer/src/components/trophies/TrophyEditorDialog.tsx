import { useState, type FormEvent } from 'react';
import type { Trophy, TrophyGrade } from '@shared/types';
import { useUpsertTrophy } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { Button } from '../ui/Button';
import { SelectField, Switch, TextField } from '../ui/Form';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { GRADE_LABEL, GRADE_ORDER } from './trophyUtils';

interface TrophyEditorDialogProps {
  gameId: number;
  /** undefined = criar novo troféu. */
  trophy?: Trophy;
  open: boolean;
  onClose: () => void;
}

export function TrophyEditorDialog({ gameId, trophy, open, onClose }: TrophyEditorDialogProps) {
  return (
    <Modal open={open} onClose={onClose} title={trophy ? 'Editar troféu' : 'Novo troféu'} size="sm">
      <TrophyForm gameId={gameId} trophy={trophy} onDone={onClose} />
    </Modal>
  );
}

const GRADE_OPTIONS = GRADE_ORDER.map((g) => ({ value: g, label: GRADE_LABEL[g] }));

function TrophyForm({ gameId, trophy, onDone }: { gameId: number; trophy?: Trophy; onDone: () => void }) {
  const [name, setName] = useState(trophy?.name ?? '');
  const [detail, setDetail] = useState(trophy?.detail ?? '');
  const [grade, setGrade] = useState<TrophyGrade>(trophy?.grade ?? 'B');
  const [hidden, setHidden] = useState(trophy?.hidden ?? false);
  const [error, setError] = useState<string | null>(null);
  const upsert = useUpsertTrophy(gameId);
  const toast = useToast();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError('Dê um nome ao troféu.');
      return;
    }
    try {
      await upsert.mutateAsync({ trophyId: trophy?.id, name: name.trim(), detail: detail.trim(), grade, hidden });
      toast.push({ tone: 'success', title: trophy ? 'Troféu atualizado' : 'Troféu criado' });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <TextField
        label="Nome"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={120}
        autoFocus
        error={error && !name.trim() ? error : null}
      />
      <TextField label="Descrição" value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={500} />
      <SelectField label="Grau" value={grade} onChange={setGrade} options={GRADE_OPTIONS} />
      <Switch
        label="Troféu oculto"
        description="Nome e descrição ficam escondidos até ser obtido."
        checked={hidden}
        onChange={setHidden}
      />
      {error && name.trim() && (
        <p className="form__error" role="alert">
          {error}
        </p>
      )}
      <div className="form__actions">
        <Button variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" loading={upsert.isPending}>
          Salvar
        </Button>
      </div>
    </form>
  );
}
