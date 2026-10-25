import { useId } from 'react';
import { autoCategoryIcon, CATEGORY_ICON_KEYS, CATEGORY_ICONS } from '@shared/categoryIcons';
import type { Category } from '@shared/types';
import { useSetCategoryIcon } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { cx } from '@/lib/cx';
import { useToast } from '../ui/Toast';
import { CategoryIcon } from './CategoryIcon';

/**
 * Grade de ícones de uma categoria (grupo de rádio nativo: setas navegam, o nome é anunciado).
 * "Automático" segue o nome da categoria ("PlayStation 4" → símbolo PlayStation).
 */
export function CategoryIconPicker({ category, onDone }: { category: Category; onDone: () => void }) {
  const toast = useToast();
  const setIcon = useSetCategoryIcon();
  const name = useId();
  const auto = autoCategoryIcon(category.name);

  function choose(icon: string | null) {
    setIcon.mutate(
      { id: category.id, icon },
      { onSuccess: onDone, onError: (err) => toast.push({ tone: 'error', title: 'Não foi possível trocar o ícone', description: errorMessage(err) }) },
    );
  }

  const options: { key: string | null; icon: (typeof CATEGORY_ICON_KEYS)[number]; label: string }[] = [
    { key: null, icon: auto, label: `Automático (${CATEGORY_ICONS[auto].label})` },
    ...CATEGORY_ICON_KEYS.map((k) => ({ key: k, icon: k, label: CATEGORY_ICONS[k].label })),
  ];

  return (
    <div className="icon-picker" role="radiogroup" aria-label={`Ícone de ${category.name}`}>
      {options.map((o) => {
        const selected = category.icon === o.key;
        return (
          <label key={o.key ?? 'auto'} className={cx('icon-picker__option', selected && 'icon-picker__option--selected', o.key === null && 'icon-picker__option--auto')} title={o.label}>
            <input type="radio" className="sr-only" name={name} checked={selected} disabled={setIcon.isPending} onChange={() => choose(o.key)} />
            <CategoryIcon icon={o.icon} size={30} />
            <span className={o.key === null ? 'icon-picker__auto-label' : 'sr-only'}>{o.key === null ? 'Auto' : o.label}</span>
          </label>
        );
      })}
    </div>
  );
}
