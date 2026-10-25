import { useState, type FormEvent } from 'react';
import { categoryIconOf } from '@shared/categoryIcons';
import type { Category } from '@shared/types';
import { useAutoOrganize, useCategories, useCreateCategory, useDeleteCategory, useMoveCategory, useRenameCategory } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Skeleton } from '../ui/States';
import { useToast } from '../ui/Toast';
import { ChevronDownIcon, ChevronUpIcon, PencilIcon, PlusIcon, RefreshIcon, TrashIcon } from '../ui/icons';
import { CategoryIcon } from './CategoryIcon';
import { CategoryIconPicker } from './CategoryIconPicker';

interface ManageCategoriesDialogProps {
  open: boolean;
  onClose: () => void;
}

/** Criar, renomear, reordenar e apagar categorias; e organizar a biblioteca por plataforma. */
export function ManageCategoriesDialog({ open, onClose }: ManageCategoriesDialogProps) {
  return (
    <Modal open={open} onClose={onClose} title="Categorias" description="Agrupe seus jogos por plataforma ou como preferir." size="md">
      <ManageBody />
    </Modal>
  );
}

function ManageBody() {
  const toast = useToast();
  const { data: categories, isLoading } = useCategories();
  const create = useCreateCategory();
  const organize = useAutoOrganize();
  const [name, setName] = useState('');
  const fail = (title: string) => (err: unknown) => toast.push({ tone: 'error', title, description: errorMessage(err) });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    create.mutate(name, { onSuccess: () => setName(''), onError: fail('Não foi possível criar') });
  }

  function autoOrganize() {
    organize.mutate(undefined, {
      onSuccess: (r) => {
        const created = r.categoriesCreated.length ? ` Novas categorias: ${r.categoriesCreated.join(', ')}.` : '';
        const unknown = r.unknown.length ? ` Sem plataforma identificada: ${r.unknown.slice(0, 3).join(', ')}${r.unknown.length > 3 ? '…' : ''}.` : '';
        toast.push({
          tone: r.gamesAssigned > 0 ? 'success' : 'info',
          title: r.gamesAssigned > 0 ? `${r.gamesAssigned} jogo(s) organizado(s)` : 'Nada para organizar',
          description: `${created}${unknown}`.trim() || 'Todos os jogos já têm categoria.',
        });
      },
      onError: fail('Falha ao organizar'),
    });
  }

  return (
    <div className="category-manager">
      <div className="category-manager__auto">
        <div>
          <strong>Organizar automaticamente</strong>
          <span className="muted">
            Cria uma categoria por plataforma (PlayStation 4, Nintendo DS…) e coloca nela os jogos que ainda não têm
            categoria. Os que você já organizou não mudam.
          </span>
        </div>
        <Button variant="primary" icon={<RefreshIcon size={16} />} loading={organize.isPending} onClick={autoOrganize}>
          Organizar
        </Button>
      </div>

      <form className="category-picker__new" onSubmit={submit}>
        <label className="sr-only" htmlFor="manage-new-category">
          Nova categoria
        </label>
        <input
          id="manage-new-category"
          className="input"
          placeholder="Nova categoria (ex.: PlayStation 3)"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" icon={<PlusIcon size={16} />} loading={create.isPending} disabled={!name.trim()}>
          Criar
        </Button>
      </form>

      {isLoading ? (
        <Skeleton className="skeleton--row" />
      ) : !categories?.length ? (
        <p className="muted">Nenhuma categoria ainda.</p>
      ) : (
        <ul className="category-manager__list">
          {categories.map((c, i) => (
            <CategoryRow key={c.id} category={c} isFirst={i === 0} isLast={i === categories.length - 1} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CategoryRow({ category: c, isFirst, isLast }: { category: Category; isFirst: boolean; isLast: boolean }) {
  const toast = useToast();
  const rename = useRenameCategory();
  const remove = useDeleteCategory();
  const move = useMoveCategory();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.name);
  const [confirming, setConfirming] = useState(false);
  const [pickingIcon, setPickingIcon] = useState(false);
  const fail = (title: string) => (err: unknown) => toast.push({ tone: 'error', title, description: errorMessage(err) });

  function save(event: FormEvent) {
    event.preventDefault();
    if (draft.trim() === c.name) return setEditing(false);
    rename.mutate({ id: c.id, name: draft }, { onSuccess: () => setEditing(false), onError: fail('Não foi possível renomear') });
  }

  return (
    <li className="category-manager__row">
      <button
        type="button"
        className="category-manager__icon"
        aria-expanded={pickingIcon}
        aria-label={`Trocar ícone de ${c.name}`}
        title="Trocar ícone"
        onClick={() => setPickingIcon((v) => !v)}
      >
        <CategoryIcon icon={categoryIconOf(c)} size={30} />
      </button>
      {editing ? (
        <form className="category-manager__edit" onSubmit={save}>
          <input
            className="input input--sm"
            value={draft}
            maxLength={40}
            autoFocus
            aria-label={`Novo nome para ${c.name}`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation(); // não fecha a janela inteira
                setDraft(c.name);
                setEditing(false);
              }
            }}
          />
          <Button type="submit" size="sm" variant="primary" loading={rename.isPending}>
            Salvar
          </Button>
        </form>
      ) : (
        <div className="category-manager__name">
          <strong>{c.name}</strong>
          <span className="muted">{c.gameCount === 1 ? '1 jogo' : `${c.gameCount} jogos`}</span>
        </div>
      )}
      {confirming ? (
        <div className="category-manager__actions">
          <span className="backup-list__warning">Os jogos continuam na biblioteca.</span>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Cancelar
          </Button>
          <Button size="sm" variant="danger" loading={remove.isPending} onClick={() => remove.mutate(c.id, { onError: fail('Não foi possível apagar') })}>
            Apagar
          </Button>
        </div>
      ) : (
        !editing && (
          <div className="category-manager__actions">
            <Button size="sm" variant="ghost" icon={<ChevronUpIcon size={16} />} aria-label={`Mover ${c.name} para cima`} disabled={isFirst || move.isPending} onClick={() => move.mutate({ id: c.id, direction: -1 })} />
            <Button size="sm" variant="ghost" icon={<ChevronDownIcon size={16} />} aria-label={`Mover ${c.name} para baixo`} disabled={isLast || move.isPending} onClick={() => move.mutate({ id: c.id, direction: 1 })} />
            <Button size="sm" variant="ghost" icon={<PencilIcon size={14} />} aria-label={`Renomear ${c.name}`} onClick={() => setEditing(true)} />
            <Button size="sm" variant="ghost" icon={<TrashIcon size={14} />} aria-label={`Apagar ${c.name}`} onClick={() => setConfirming(true)} />
          </div>
        )
      )}
      {pickingIcon && <CategoryIconPicker category={c} onDone={() => setPickingIcon(false)} />}
    </li>
  );
}
