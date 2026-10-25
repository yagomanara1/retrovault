import { cx } from '@/lib/cx';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  /** Texto para leitores de tela. Omitido = decorativo (ex.: dentro de um botão com aria-busy). */
  label?: string;
  className?: string;
}

export function Spinner({ size = 'md', label, className }: SpinnerProps) {
  if (!label) return <span className={cx('spinner', `spinner--${size}`, className)} aria-hidden="true" />;
  return (
    <span role="status" className={cx('spinner-wrap', className)}>
      <span className={cx('spinner', `spinner--${size}`)} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
