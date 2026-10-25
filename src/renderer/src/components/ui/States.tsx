import type { CSSProperties, ReactNode } from 'react';
import { cx } from '@/lib/cx';
import { Button } from './Button';
import { AlertIcon, RefreshIcon } from './icons';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ icon, title, description, action, compact }: EmptyStateProps) {
  return (
    <div className={cx('state', compact && 'state--compact')}>
      {icon && <div className="state__icon">{icon}</div>}
      <h2 className="state__title">{title}</h2>
      {description && <p className="state__description">{description}</p>}
      {action && <div className="state__action">{action}</div>}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
  compact?: boolean;
  action?: ReactNode;
}

export function ErrorState({ title = 'Algo deu errado', message, onRetry, retrying, compact, action }: ErrorStateProps) {
  return (
    <div className={cx('state', 'state--error', compact && 'state--compact')} role="alert">
      <div className="state__icon">
        <AlertIcon size={28} />
      </div>
      <h2 className="state__title">{title}</h2>
      <p className="state__description">{message}</p>
      <div className="state__action">
        {onRetry && (
          <Button icon={<RefreshIcon />} onClick={onRetry} loading={retrying}>
            Tentar novamente
          </Button>
        )}
        {action}
      </div>
    </div>
  );
}

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div className={cx('skeleton', className)} style={style} aria-hidden="true" />;
}

/** Bloco de carregamento acessível: anuncia o carregamento e esconde os placeholders. */
export function LoadingBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div aria-busy="true">
      <span className="sr-only" role="status">
        {label}
      </span>
      {children}
    </div>
  );
}
