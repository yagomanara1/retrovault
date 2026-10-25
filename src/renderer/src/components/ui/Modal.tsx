import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cx } from '@/lib/cx';
import { Button } from './Button';
import { CloseIcon } from './icons';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Modal sobre <dialog> nativo: foco preso, Esc, inert do fundo e
 * restauração de foco vêm do navegador.
 */
export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={cx('modal', `modal--${size}`)}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        // Clique no backdrop (o próprio <dialog>, fora do conteúdo).
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="modal__inner">
          <header className="modal__header">
            <div>
              <h2 id={titleId} className="modal__title">
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className="modal__description">
                  {description}
                </p>
              )}
            </div>
            <Button variant="ghost" size="sm" icon={<CloseIcon />} aria-label="Fechar" onClick={onClose} />
          </header>
          <div className="modal__body">{children}</div>
          {footer && <footer className="modal__footer">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
