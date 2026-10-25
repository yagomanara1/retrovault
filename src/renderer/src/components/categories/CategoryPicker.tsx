import { useState, type FormEvent } from 'react';
import { categoryIconOf } from '@shared/categoryIcons';
import type { Game } from '@shared/types';
import { useCategories, useCreateCategory, useSetGameCategories } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Skeleton } from '../ui/States';
import { useToast } from '../ui/Toast';
import { PlusIcon } from '../ui/icons';
import { CategoryIcon } from './CategoryIcon';

/** A partir de quantas categorias aparece a busca. */
const FILTER_FROM = 8;
const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

interface CategoryPickerProps {
  game: Game;
  open: boolean;
  onClose: () => void;
}

/**
 * Escolher as categorias de um jogo (pode estar em várias) e criar uma nova sem sair daqui.
 * Cada marcação salva na hora: não existe "Salvar" para esquecer.
 */
export function CategoryPicker({ game, open, onClose }: CategoryPickerProps) {
  return (
    <Modal open={open} onClose={onClose} title="Categorias" description={game.title} size="sm">
      <PickerBody game={game} />
    </Modal>
  );
}

function PickerBody({ game }: { game: Game }) {
  const toast = useToast();
  const { data: categories, isLoading } = useCategories();
  const setGame = useSetGameCategories();
  const create = useCreateCategory();
  const [name, setName] = useState('');
  const [filter, setFilter] = useState('');
  const needle = normalize(filter.trim());
  // Com uma categoria por console a lista é longa; a busca evita rolar (a ordem não muda ao marcar).
  const shown = (categories ?? []).filter((c) => !needle || normalize(c.name).includes(needle));
  const fail =(title: string) => (err: unknown) => toast.push({ tone: 'error', title, description: errorMessage(err) });

  function toggle(categoryId: number, checked: boolean) {
    const next = checked ? [...game.categoryIds, categoryId] : game.categoryIds.filter((id) => id !== categoryId);
    setGame.mutate({ gameId: game.id, categoryIds: next }, { onError: fail('Não foi possível salvar') });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    create.mutate(name, {
      onSuccess: (category) => {
        setName('');
        // A nova categoria já entra marcada para este jogo.
        setGame.mutate({ gameId: game.id, categoryIds: [...game.categoryIds, category.id] }, { onError: fail('Não foi possível salvar') });
      },
      onError: fail('Não foi possível criar'),
    });
  }

  return (
    <div className="category-picker">
      {isLoading ? (
        <Skeleton className="skeleton--sidebar" />
      ) : !categories?.length ? (
        <p className="muted">Nenhuma categoria ainda. Crie a primeira abaixo (ex.: PlayStation 4, Nintendo DS).</p>
      ) : (
        <>
        {categories.length > FILTER_FROM && (
          <input
            className="input input--sm"
            type="search"
            placeholder="Buscar categoria ou console…"
            aria-label="Buscar categoria"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        )}
        {shown.length === 0 && <p className="muted">Nenhuma categoria com “{filter.trim()}”.</p>}
        <ul className="category-picker__list" aria-label="Categorias do jogo">
          {shown.map((c) => (
            <li key={c.id}>
              <label className="category-picker__item">
                <input
                  type="checkbox"
                  checked={game.categoryIds.includes(c.id)}
                  disabled={setGame.isPending}
                  onChange={(e) => toggle(c.id, e.target.checked)}
                />
                <CategoryIcon icon={categoryIconOf(c)} size={20} />
                <span className="category-picker__name">{c.name}</span>
                <span className="muted category-picker__count">{c.gameCount}</span>
              </label>
            </li>
          ))}
        </ul>
        </>
      )}
      <form className="category-picker__new" onSubmit={submit}>
        <label className="sr-only" htmlFor={`new-category-${game.id}`}>
          Nova categoria
        </label>
        <input
          id={`new-category-${game.id}`}
          className="input input--sm"
          placeholder="Nova categoria…"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" size="sm" icon={<PlusIcon size={14} />} loading={create.isPending} disabled={!name.trim()}>
          Criar
        </Button>
      </form>
    </div>
  );
}
