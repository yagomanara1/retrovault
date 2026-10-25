const LOCALE = 'pt-BR';

const numberFmt = new Intl.NumberFormat(LOCALE);
const percentFmt = new Intl.NumberFormat(LOCALE, { style: 'percent', maximumFractionDigits: 1 });
const dateTimeFmt = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' });
const dateFmt = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'long' });
const relativeFmt = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });

export const formatNumber = (value: number) => numberFmt.format(value);

/** 512 → "512 B"; 76_000 → "74 KB"; 14_300_000 → "13,6 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString(LOCALE, { maximumFractionDigits: 1 })} MB`;
}

/** 0–100 → "12,5%"; valores ínfimos viram "<0,1%". */
export function formatPercent(value: number): string {
  if (value > 0 && value < 0.1) return `<${percentFmt.format(0.001)}`;
  return percentFmt.format(value / 100);
}

export function formatPlaytime(seconds: number): string {
  if (seconds < 60) return seconds > 0 ? 'menos de 1 min' : 'Nunca jogado';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes} min`;
  if (hours < 10 && minutes > 0) return `${hours} h ${minutes} min`;
  return `${formatNumber(hours)} h`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFmt.format(date);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : dateFmt.format(date);
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'nunca';
  const diffSeconds = (new Date(iso).getTime() - Date.now()) / 1000;
  if (!Number.isFinite(diffSeconds)) return '—';
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(diffSeconds) >= size) return relativeFmt.format(Math.round(diffSeconds / size), unit);
  }
  return 'agora mesmo';
}
