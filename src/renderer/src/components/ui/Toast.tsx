import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { cx } from '@/lib/cx';
import { AlertIcon, CheckIcon, CloseIcon, TrophyIcon } from './icons';

export type ToastTone = 'info' | 'success' | 'warning' | 'error' | 'achievement';

export interface ToastInput {
  title: string;
  /** Texto pequeno acima do título (ex.: "Troféu de Ouro"). */
  eyebrow?: string;
  description?: string;
  tone?: ToastTone;
  imageUrl?: string | null;
  durationMs?: number;
}

interface ToastItem extends Required<Omit<ToastInput, 'imageUrl' | 'description' | 'eyebrow'>> {
  id: number;
  eyebrow?: string;
  description?: string;
  imageUrl?: string | null;
}

interface ToastApi {
  push(toast: ToastInput): void;
  dismiss(id: number): void;
}

const ToastContext = createContext<ToastApi | null>(null);
const MAX_VISIBLE = 5;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const push = useCallback(
    (input: ToastInput) => {
      const id = nextId.current++;
      const tone = input.tone ?? 'info';
      const durationMs = input.durationMs ?? (tone === 'error' ? 8000 : tone === 'achievement' ? 7000 : 5000);
      setToasts((list) => [...list, { ...input, id, tone, durationMs }].slice(-MAX_VISIBLE));
      timers.current.set(id, setTimeout(() => dismiss(id), durationMs));
    },
    [dismiss],
  );

  const api = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite" aria-relevant="additions">
        {toasts.map((t) => (
          <div key={t.id} className={cx('toast', `toast--${t.tone}`)} role={t.tone === 'error' ? 'alert' : 'status'}>
            {t.imageUrl ? (
              <img className="toast__image" src={t.imageUrl} alt="" width={48} height={48} />
            ) : (
              <span className="toast__icon">
                {t.tone === 'achievement' ? <TrophyIcon /> : t.tone === 'success' ? <CheckIcon /> : <AlertIcon />}
              </span>
            )}
            <div className="toast__content">
              {(t.eyebrow || t.tone === 'achievement') && (
                <span className="toast__eyebrow">{t.eyebrow ?? 'Conquista desbloqueada'}</span>
              )}
              <strong className="toast__title">{t.title}</strong>
              {t.description && <p className="toast__description">{t.description}</p>}
            </div>
            <button type="button" className="toast__close" aria-label="Dispensar notificação" onClick={() => dismiss(t.id)}>
              <CloseIcon size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast precisa estar dentro de <ToastProvider>');
  return ctx;
}
