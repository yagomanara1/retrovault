import { useCallback, useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Game, Trophy, TrophySet } from '@shared/types';
import {
  useConfigureTrophyLog,
  useDeleteTrophy,
  useDeleteTrophySet,
  useImportTrophies,
  useSetTrophyUnlocked,
} from '@/hooks/queries';
import { errorMessage, isApiError } from '@/lib/api';
import { Button } from '../ui/Button';
import { SegmentedControl, SelectField, Switch } from '../ui/Form';
import { ProgressBar } from '../ui/ProgressBar';
import { useToast } from '../ui/Toast';
import { PlusIcon, RefreshIcon, TrashIcon, TrophyIcon } from '../ui/icons';
import { TrophyEditorDialog } from './TrophyEditorDialog';
import { TrophyGradeBadge, TrophyRow } from './TrophyRow';
import {
  GRADE_LABEL,
  GRADE_ORDER,
  TROPHY_SOURCE_LABEL,
  type TrophyFilter,
  type TrophySort,
  filterTrophies,
  sortTrophies,
  trophyStats,
} from './trophyUtils';

const SORT_OPTIONS = [
  { value: 'default', label: 'Ordem do jogo' },
  { value: 'grade', label: 'Grau (Platina → Bronze)' },
  { value: 'recent', label: 'Obtidos recentemente' },
] as const;

/** "C:\…\gow3-windows\user\last_run.log" → "…\user\last_run.log" */
function shortPath(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts.length > 3 ? `…\\${parts.slice(-3).join('\\')}` : p;
}

export function TrophyPanel({ game, set }: { game: Game; set: TrophySet }) {
  const headingId = useId();
  const toast = useToast();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<TrophyFilter>('all');
  const [sort, setSort] = useState<TrophySort>('default');
  const [revealHidden, setRevealHidden] = useState(false);
  const [editor, setEditor] = useState<{ open: boolean; trophy?: Trophy }>({ open: false });
  const [confirmRemove, setConfirmRemove] = useState(false);

  const toggle = useSetTrophyUnlocked(game.id);
  const remove = useDeleteTrophy(game.id);
  const reimport = useImportTrophies(game.id);
  const removeSet = useDeleteTrophySet(game.id);
  const configureLog = useConfigureTrophyLog(game.id);

  const stats = useMemo(() => trophyStats(set.trophies), [set.trophies]);
  const visible = useMemo(() => sortTrophies(filterTrophies(set.trophies, filter), sort), [set.trophies, filter, sort]);
  const hasHidden = set.trophies.some((t) => t.hidden && !t.unlockedAt);
  const editable = set.source === 'manual';
  /** RPCS3/Vita3K: a lista e os desbloqueios vêm do emulador. */
  const emulator = set.source === 'rpcs3' ? 'RPCS3' : set.source === 'vita3k' ? 'Vita3K' : null;

  const fail = useCallback(
    (title: string) => (err: unknown) => {
      toast.push({ tone: 'error', title, description: errorMessage(err) });
      if (isApiError(err, 'TROPHY_KEY_MISSING', 'TROPHY_KEY_INVALID')) navigate('/settings');
    },
    [toast, navigate],
  );

  const onToggle = useCallback(
    (t: Trophy) => toggle.mutate({ trophyId: t.id, unlocked: !t.unlockedAt }, { onError: fail('Falha ao atualizar troféu') }),
    [toggle, fail],
  );
  const onEdit = useCallback((t: Trophy) => setEditor({ open: true, trophy: t }), []);
  const onDelete = useCallback(
    (t: Trophy) => remove.mutate(t.id, { onError: fail('Falha ao excluir troféu') }),
    [remove, fail],
  );

  function handleRemoveSet() {
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    removeSet.mutate(undefined, {
      onSuccess: () => toast.push({ tone: 'info', title: 'Lista de troféus removida' }),
      onError: fail('Falha ao remover a lista'),
    });
  }

  return (
    <section className="panel trophy-panel" aria-labelledby={headingId}>
      <header className="panel__header">
        <div className="trophy-panel__heading">
          {set.iconUrl && <img src={set.iconUrl} alt="" width={56} height={56} className="trophy-panel__set-icon" />}
          <div>
            <h2 id={headingId} className="panel__title">
              Troféus
            </h2>
            <p className="muted trophy-panel__subtitle">
              {set.source === 'manual'
                ? 'Lista personalizada'
                : `${set.title ?? TROPHY_SOURCE_LABEL[set.source]} · ${emulator ? `${TROPHY_SOURCE_LABEL[set.source]} · ` : ''}${set.npCommId ?? ''}`}
            </p>
          </div>
        </div>
        <div className="trophy-panel__actions">
          {editable && (
            <Button size="sm" variant="primary" icon={<PlusIcon size={14} />} onClick={() => setEditor({ open: true })}>
              Adicionar troféu
            </Button>
          )}
          {set.source === 'ps4' && (
            <Button
              size="sm"
              variant="ghost"
              icon={<RefreshIcon size={14} />}
              loading={reimport.isPending}
              onClick={() =>
                reimport.mutate(undefined, {
                  onSuccess: (s) => s && toast.push({ tone: 'success', title: 'Troféus reimportados', description: 'Os troféus obtidos foram mantidos.' }),
                  onError: fail('Falha ao reimportar'),
                })
              }
            >
              Reimportar .trp
            </Button>
          )}
          <Button size="sm" variant="danger" icon={<TrashIcon size={14} />} loading={removeSet.isPending} onClick={handleRemoveSet}>
            {confirmRemove ? 'Confirmar remoção' : 'Remover lista'}
          </Button>
        </div>
      </header>

      <div className="trophy-summary">
        <div className="trophy-summary__progress">
          <span className="trophy-summary__percent">{stats.percent}%</span>
          <ProgressBar
            value={stats.points}
            max={stats.maxPoints || 1}
            tone="gold"
            label="Progresso de troféus"
            valueText={`${stats.percent}% — ${stats.unlocked} de ${stats.total} troféus`}
          />
          <span className="muted">
            {stats.unlocked} de {stats.total} troféus
          </span>
        </div>
        <ul className="trophy-summary__grades" aria-label="Troféus por grau">
          {GRADE_ORDER.filter((g) => stats.byGrade[g].total > 0).map((g) => (
            <li key={g}>
              <TrophyGradeBadge grade={g} size={20} />
              <span>
                {stats.byGrade[g].unlocked}/{stats.byGrade[g].total}
              </span>
              <span className="sr-only">{GRADE_LABEL[g]}</span>
            </li>
          ))}
        </ul>
      </div>

      {emulator ? (
        <div className="trophy-detection">
          <TrophyIcon size={16} />
          <span>
            Os troféus vêm do {emulator}: os que você ganhar nele aparecem aqui na hora, com a data do emulador.
          </span>
        </div>
      ) : (
      <div className="trophy-detection">
        <TrophyIcon size={16} />
        {set.logPath ? (
          <span>
            Detecção automática ativa: lendo <code title={set.logPath}>{shortPath(set.logPath)}</code>
          </span>
        ) : (
          <span>Detecção automática desligada: marque os troféus manualmente.</span>
        )}
        <div className="trophy-detection__actions">
          {!set.logPath && game.kind === 'executable' && (
            <Button size="sm" variant="ghost" onClick={() => configureLog.mutate('auto', { onError: fail('Log não encontrado') })}>
              Detectar log
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => configureLog.mutate('pick', { onError: fail('Falha ao configurar log') })}>
            {set.logPath ? 'Alterar…' : 'Escolher log…'}
          </Button>
          {set.logPath && (
            <Button size="sm" variant="ghost" onClick={() => configureLog.mutate('clear')}>
              Desativar
            </Button>
          )}
        </div>
      </div>
      )}

      {set.trophies.length > 0 && (
        <div className="toolbar">
          <SegmentedControl
            label="Filtrar troféus"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: `Todos (${stats.total})` },
              { value: 'unlocked', label: `Obtidos (${stats.unlocked})` },
              { value: 'locked', label: `Não obtidos (${stats.total - stats.unlocked})` },
            ]}
          />
          <div className="toolbar__group">
            {hasHidden && <Switch label="Revelar ocultos" checked={revealHidden} onChange={setRevealHidden} />}
            <SelectField label="Ordenar por" value={sort} onChange={setSort} options={SORT_OPTIONS} className="select--inline" />
          </div>
        </div>
      )}

      {set.trophies.length === 0 ? (
        <p className="muted panel__empty">Nenhum troféu ainda. Use “Adicionar troféu” para criar a sua lista.</p>
      ) : visible.length === 0 ? (
        <p className="muted panel__empty">Nenhum troféu nesta categoria.</p>
      ) : (
        <ul className="trophy-list">
          {visible.map((t) => (
            <TrophyRow
              key={t.id}
              trophy={t}
              revealHidden={revealHidden}
              editable={editable}
              busy={toggle.isPending}
              onToggle={emulator ? undefined : onToggle}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}

      <TrophyEditorDialog
        gameId={game.id}
        trophy={editor.trophy}
        open={editor.open}
        onClose={() => setEditor({ open: false })}
      />
    </section>
  );
}
