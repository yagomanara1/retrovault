import type { ReactNode } from 'react';

interface SettingsPanelProps {
  /** Prefixo do id do título (`${id}-heading`), que dá nome à região para leitores de tela. */
  id: string;
  title: string;
  /** Botões do cabeçalho, à direita do título (ex.: "Abrir pasta", "Verificar novamente"). */
  actions?: ReactNode;
  children: ReactNode;
}

/** Moldura de cada seção das Configurações: região nomeada pelo título, com as ações no cabeçalho. */
export function SettingsPanel({ id, title, actions, children }: SettingsPanelProps) {
  const headingId = `${id}-heading`;
  return (
    <section className="panel" aria-labelledby={headingId}>
      <header className="panel__header">
        <h2 id={headingId} className="panel__title">
          {title}
        </h2>
        {actions}
      </header>
      {children}
    </section>
  );
}
