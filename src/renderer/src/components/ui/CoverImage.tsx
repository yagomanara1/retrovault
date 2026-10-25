import { memo, useState } from 'react';
import { cx } from '@/lib/cx';

interface CoverImageProps {
  cover: string | null;
  icon?: string | null;
  title: string;
  className?: string;
  variant?: 'portrait' | 'square';
}

function initials(title: string): string {
  return (
    title
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '?'
  );
}

/**
 * Capa do jogo com fallback progressivo: capa → ícone centralizado → iniciais.
 * Decorativa (alt=""), pois o título sempre aparece ao lado.
 */
export const CoverImage = memo(function CoverImage({ cover, icon, title, className, variant = 'portrait' }: CoverImageProps) {
  // Guarda a URL que falhou (não um boolean): trocar a imagem limpa o erro automaticamente.
  const [failedCover, setFailedCover] = useState<string | null>(null);
  const [failedIcon, setFailedIcon] = useState<string | null>(null);
  const showCover = cover && cover !== failedCover;

  return (
    <div className={cx('cover', `cover--${variant}`, className)}>
      {showCover ? (
        <img src={cover} alt="" loading="lazy" decoding="async" onError={() => setFailedCover(cover)} />
      ) : icon && icon !== failedIcon ? (
        <>
          {/* O próprio ícone, ampliado e desfocado, preenche o espaço que sobra (estilo Steam). */}
          <span className="cover__icon-backdrop" style={{ backgroundImage: `url("${icon}")` }} aria-hidden="true" />
          <img className="cover__icon" src={icon} alt="" loading="lazy" onError={() => setFailedIcon(icon)} />
        </>
      ) : (
        <span className="cover__initials" aria-hidden="true">
          {initials(title)}
        </span>
      )}
    </div>
  );
});
