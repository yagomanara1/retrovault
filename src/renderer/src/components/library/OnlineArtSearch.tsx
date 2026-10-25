import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ArtCandidate, ArtSearchResult, ArtworkSlot, Game } from '@shared/types';
import { useApplyArt, useArtSearch, useSettings } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { cx } from '@/lib/cx';
import { Button } from '../ui/Button';
import { SegmentedControl } from '../ui/Form';
import { useToast } from '../ui/Toast';
import { SearchIcon } from '../ui/icons';

const SLOTS = [
  { value: 'cover', label: 'Capas' },
  { value: 'background', label: 'Fundos' },
  { value: 'icon', label: 'Ícones' },
] as const;

const SLOT_NAME: Record<ArtworkSlot, string> = { cover: 'Capa', background: 'Fundo', icon: 'Ícone' };

/**
 * Busca de arte no SteamGridDB: várias opções de capa, fundo e ícone para escolher com um clique.
 * Sem a chave conectada, explica o que é e leva às Configurações.
 */
export function OnlineArtSearch({ game, onDone }: { game: Game; onDone?: () => void }) {
  const { data: settings } = useSettings();
  const navigate = useNavigate();
  const toast = useToast();
  const search = useArtSearch();
  const apply = useApplyArt();
  const [query, setQuery] = useState(game.title);
  const [slot, setSlot] = useState<ArtworkSlot>('cover');
  const [result, setResult] = useState<ArtSearchResult | null>(null);
  const [applying, setApplying] = useState<string | null>(null);

  if (!settings?.hasSgdbKey) {
    return (
      <div className="art-search art-search--setup">
        <p>
          <strong>Buscar artes online.</strong> Com uma chave gratuita do SteamGridDB, o RetroVault encontra capas, fundos e ícones do jogo e
          preenche sozinho os jogos de PC que você adicionar.
        </p>
        <Button
          size="sm"
          onClick={() => {
            onDone?.();
            navigate('/settings?secao=loja');
          }}
        >
          Conectar o SteamGridDB
        </Button>
      </div>
    );
  }

  function run(event?: FormEvent, sgdbGameId?: number) {
    event?.preventDefault();
    search.mutate(
      { id: game.id, query: query.trim() || undefined, sgdbGameId },
      { onSuccess: setResult, onError: (err) => toast.push({ tone: 'error', title: 'A busca falhou', description: errorMessage(err) }) },
    );
  }

  function choose(candidate: ArtCandidate) {
    setApplying(candidate.url);
    apply.mutate(
      { id: game.id, slot, url: candidate.url },
      {
        onSuccess: () => toast.push({ tone: 'success', title: `${SLOT_NAME[slot]} atualizado`, description: game.title }),
        onError: (err) => toast.push({ tone: 'error', title: 'Não foi possível aplicar', description: errorMessage(err) }),
        onSettled: () => setApplying(null),
      },
    );
  }

  const list = result ? result[slot] : [];
  return (
    <section className="art-search" aria-labelledby={`art-search-${game.id}`}>
      <h3 id={`art-search-${game.id}`} className="artwork-slot__title">
        Buscar online (SteamGridDB)
      </h3>
      <form className="art-search__form" onSubmit={run}>
        <label className="sr-only" htmlFor={`art-query-${game.id}`}>
          Nome do jogo
        </label>
        <input id={`art-query-${game.id}`} className="input input--sm" value={query} maxLength={100} onChange={(e) => setQuery(e.target.value)} />
        <Button type="submit" size="sm" variant="primary" icon={<SearchIcon size={14} />} loading={search.isPending}>
          Buscar
        </Button>
      </form>

      {result && (
        <>
          {result.games.length > 1 && (
            <label className="art-search__match">
              <span>Jogo encontrado</span>
              <select
                className="input input--sm"
                value={result.selectedGameId ?? ''}
                disabled={search.isPending}
                onChange={(e) => run(undefined, Number(e.target.value))}
              >
                {result.games.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <SegmentedControl label="Tipo de arte" value={slot} options={SLOTS} onChange={setSlot} />
          {list.length === 0 ? (
            <p className="muted" role="status">
              {result.games.length === 0 ? `Nada encontrado para “${result.query}”. Tente outro nome.` : 'Este jogo não tem esse tipo de arte no SteamGridDB.'}
            </p>
          ) : (
            <ul className={cx('art-search__grid', `art-search__grid--${slot}`)} aria-busy={search.isPending}>
              {list.map((c) => (
                <li key={c.url}>
                  <button
                    type="button"
                    className="art-search__option"
                    onClick={() => choose(c)}
                    disabled={applying !== null}
                    aria-label={`Usar esta ${SLOT_NAME[slot].toLowerCase()} (${c.width}×${c.height})`}
                  >
                    <img src={c.thumb} alt="" loading="lazy" decoding="async" />
                    {applying === c.url && <span className="art-search__applying">Aplicando…</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
