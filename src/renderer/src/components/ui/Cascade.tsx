import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '@/lib/cx';

export interface CascadeItem<T extends string> {
  id: T;
  label: ReactNode;
  /** Linha secundária (ex.: "Conectado como jogador123"). */
  description?: ReactNode;
  /** Ícone ou miniatura à esquerda. */
  icon?: ReactNode;
  /** Informação à direita (ex.: percentual). */
  trailing?: ReactNode;
}

interface CascadeProps<T extends string> {
  /** Nome acessível da lista. */
  label: string;
  items: readonly CascadeItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Conteúdo do item ativo (painel à direita). */
  children: ReactNode;
  /** Cabeçalho opcional acima da lista (ex.: filtros). */
  listHeader?: ReactNode;
}

/**
 * Layout em cascata do PS5: lista grande à esquerda, conteúdo do item ativo à direita (desliza ao trocar).
 * Semântica de abas verticais: ↑ ↓ Home End navegam e ativam; só o item ativo entra no Tab.
 */
export function Cascade<T extends string>({ label, items, value, onChange, children, listHeader }: CascadeProps<T>) {
  const baseId = useId();
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const tabId = (id: T) => `${baseId}-tab-${id}`;
  const panelId = `${baseId}-panel`;

  function onKeyDown(event: KeyboardEvent) {
    const index = items.findIndex((i) => i.id === value);
    const next =
      event.key === 'ArrowDown' ? Math.min(items.length - 1, index + 1)
      : event.key === 'ArrowUp' ? Math.max(0, index - 1)
      : event.key === 'Home' ? 0
      : event.key === 'End' ? items.length - 1
      : -1;
    if (next < 0 || next === index) return;
    event.preventDefault();
    const target = items[next]!.id;
    onChange(target);
    refs.current.get(target)?.focus();
  }

  return (
    <div className="cascade">
      <div className="cascade__nav">
        {listHeader}
        <div role="tablist" aria-label={label} aria-orientation="vertical" className="cascade__list" onKeyDown={onKeyDown}>
          {items.map((item) => {
            const selected = item.id === value;
            return (
              <button
                key={item.id}
                ref={(el) => {
                  if (el) refs.current.set(item.id, el);
                  else refs.current.delete(item.id);
                }}
                type="button"
                role="tab"
                id={tabId(item.id)}
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                className={cx('cascade__item', selected && 'cascade__item--active')}
                onClick={() => onChange(item.id)}
              >
                {item.icon && <span className="cascade__icon">{item.icon}</span>}
                <span className="cascade__text">
                  <span className="cascade__label">{item.label}</span>
                  {item.description && <span className="cascade__description">{item.description}</span>}
                </span>
                {item.trailing && <span className="cascade__trailing">{item.trailing}</span>}
              </button>
            );
          })}
        </div>
      </div>
      {/* key: o painel entra deslizando a cada troca, como a cascata do PS5. */}
      <div key={value} role="tabpanel" id={panelId} aria-labelledby={tabId(value)} className="cascade__panel" tabIndex={0}>
        {children}
      </div>
    </div>
  );
}
