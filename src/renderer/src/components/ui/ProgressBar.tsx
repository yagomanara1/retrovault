import { cx } from '@/lib/cx';

interface ProgressBarProps {
  value: number;
  max?: number;
  /** Nome acessível da barra. */
  label: string;
  size?: 'xs' | 'sm' | 'md';
  tone?: 'accent' | 'gold' | 'muted';
  /** Texto lido pelo leitor de tela (ex.: "12 de 40"). */
  valueText?: string;
  className?: string;
}

export function ProgressBar({
  value,
  max = 100,
  label,
  size = 'md',
  tone = 'accent',
  valueText,
  className,
}: ProgressBarProps) {
  const safeMax = max > 0 ? max : 1;
  const clamped = Math.min(Math.max(value, 0), safeMax);
  const percent = (clamped / safeMax) * 100;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={clamped}
      aria-valuetext={valueText}
      className={cx('progress', `progress--${size}`, `progress--${tone}`, className)}
    >
      <div className="progress__fill" style={{ width: `${percent}%` }} />
    </div>
  );
}
