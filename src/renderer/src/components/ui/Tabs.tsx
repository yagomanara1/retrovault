import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '@/lib/cx';

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
}

interface TabsProps<T extends string> {
  /** Nome acessível do grupo de abas. */
  label: string;
  value: T;
  onChange: (value: T) => void;
  tabs: readonly TabItem<T>[];
  /** Conteúdo da aba ativa (renderizado dentro do tabpanel). */
  children: ReactNode;
}

/**
 * Abas no padrão WAI-ARIA: setas ←/→, Home/End movem o foco e ativam a aba;
 * só a aba ativa entra na ordem de Tab (roving tabindex).
 */
export function Tabs<T extends string>({ label, value, onChange, tabs, children }: TabsProps<T>) {
  const baseId = useId();
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const tabId = (v: T) => `${baseId}-tab-${v}`;
  const panelId = `${baseId}-panel`;

  function onKeyDown(event: KeyboardEvent) {
    const index = tabs.findIndex((t) => t.value === value);
    const next =
      event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? tabs.length - 1
      : -1;
    if (next < 0) return;
    event.preventDefault();
    const target = tabs[next]!.value;
    onChange(target);
    refs.current.get(target)?.focus();
  }

  return (
    <div className="tabs">
      <div role="tablist" aria-label={label} className="tabs__list" onKeyDown={onKeyDown}>
        {tabs.map((t) => {
          const selected = t.value === value;
          return (
            <button
              key={t.value}
              ref={(el) => {
                if (el) refs.current.set(t.value, el);
                else refs.current.delete(t.value);
              }}
              type="button"
              role="tab"
              id={tabId(t.value)}
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              className={cx('tabs__tab', selected && 'tabs__tab--active')}
              onClick={() => onChange(t.value)}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={panelId} aria-labelledby={tabId(value)} className="tabs__panel" tabIndex={0}>
        {children}
      </div>
    </div>
  );
}
