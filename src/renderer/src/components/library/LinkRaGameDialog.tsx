import { useMemo, useState } from 'react';
import { CONSOLES_BY_NAME } from '@shared/consoles';
import type { Game } from '@shared/types';
import { useRaConsoles, useRaSearch, useUpdateGame } from '@/hooks/queries';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { errorMessage } from '@/lib/api';
import { Button } from '../ui/Button';
import { SelectField, TextField } from '../ui/Form';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';
import { useToast } from '../ui/Toast';

interface LinkRaGameDialogProps {
  game: Game;
  open: boolean;
  onClose: () => void;
}

export function LinkRaGameDialog({ game, open, onClose }: LinkRaGameDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Vincular ao RetroAchievements"
      description="Escolha o jogo correspondente para exibir as conquistas da sua conta."
      size="lg"
    >
      <LinkForm game={game} onDone={onClose} />
    </Modal>
  );
}

function LinkForm({ game, onDone }: { game: Game; onDone: () => void }) {
  const [consoleId, setConsoleId] = useState<number | null>(game.consoleId);
  const [query, setQuery] = useState(game.title);
  const [manualId, setManualId] = useState('');
  const debouncedQuery = useDebouncedValue(query, 300);

  // Lista completa de consoles da API (inclui PS2, GameCube etc. para emuladores standalone).
  const consoles = useRaConsoles();
  const consoleOptions = useMemo(() => {
    const list = consoles.data?.length
      ? consoles.data.map((c) => ({ value: String(c.id), label: c.name }))
      : CONSOLES_BY_NAME.map((c) => ({ value: String(c.id), label: c.name }));
    return [{ value: '', label: 'Selecione o console…' }, ...list];
  }, [consoles.data]);

  const search = useRaSearch(consoleId, debouncedQuery);
  const update = useUpdateGame();
  const toast = useToast();

  async function link(raGameId: number | null) {
    try {
      const updated = await update.mutateAsync({ id: game.id, raGameId });
      toast.push(
        raGameId
          ? { tone: 'success', title: 'Jogo vinculado', description: `${updated.title} agora mostra suas conquistas.` }
          : { tone: 'info', title: 'Vínculo removido' },
      );
      onDone();
    } catch (err) {
      toast.push({ tone: 'error', title: 'Falha ao vincular', description: errorMessage(err) });
    }
  }

  const manualIdNumber = Number(manualId);
  const manualValid = Number.isInteger(manualIdNumber) && manualIdNumber > 0;

  return (
    <div className="form">
      <div className="form__row">
        <SelectField
          label="Console"
          value={consoleId == null ? '' : String(consoleId)}
          onChange={(v) => setConsoleId(v ? Number(v) : null)}
          options={consoleOptions}
        />
        <TextField label="Buscar título" type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="search-results" aria-live="polite" aria-busy={search.isFetching}>
        {consoleId == null ? (
          <p className="muted">Selecione um console para buscar.</p>
        ) : search.isFetching && !search.data ? (
          <Spinner label="Buscando jogos… (a primeira busca de um console baixa o catálogo)" />
        ) : search.isError ? (
          <p className="form__error">{errorMessage(search.error)}</p>
        ) : search.data && search.data.length === 0 ? (
          <p className="muted">Nenhum jogo com conquistas encontrado para “{debouncedQuery}”.</p>
        ) : (
          <ul className="search-results__list">
            {search.data?.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="search-result"
                  onClick={() => void link(r.id)}
                  disabled={update.isPending}
                  aria-current={r.id === game.raGameId ? 'true' : undefined}
                >
                  {r.iconUrl && <img src={r.iconUrl} alt="" width={40} height={40} loading="lazy" />}
                  <span className="search-result__title">{r.title}</span>
                  <span className="search-result__meta">
                    {r.numAchievements} conquistas · ID {r.id}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="form__row form__row--end">
        <TextField
          label="Ou informe o ID do jogo no RetroAchievements"
          inputMode="numeric"
          value={manualId}
          onChange={(e) => setManualId(e.target.value.replace(/\D/g, ''))}
          placeholder="ex.: 1446"
          hint="O ID aparece na URL: retroachievements.org/game/1446"
        />
        <Button variant="primary" disabled={!manualValid} loading={update.isPending} onClick={() => void link(manualIdNumber)}>
          Vincular ID
        </Button>
      </div>

      {game.raGameId && (
        <div className="form__actions form__actions--start">
          <Button variant="danger" onClick={() => void link(null)} disabled={update.isPending}>
            Remover vínculo atual (ID {game.raGameId})
          </Button>
        </div>
      )}
    </div>
  );
}
