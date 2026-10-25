import type { ReactNode } from 'react';
import { CATEGORY_ICONS, iconParts, type CategoryIconKey } from '@shared/categoryIcons';
import { cx } from '@/lib/cx';

// Símbolos próprios que remetem a cada console (não são os logotipos oficiais, marcas registradas).
// Desenhados num grid 24×24, traço branco sobre o quadrado colorido do ícone. Ícones com selo
// (PS2, Game Boy Color…) não têm desenho aqui: usam o da família, menor, com o selo no canto.

/** Exportado para o teste conferir que todo ícone tem um desenho (próprio ou emprestado). */
export const GLYPHS: Partial<Record<CategoryIconKey, ReactNode>> = {
  // Os quatro símbolos dos botões: triângulo, círculo, xis e quadrado.
  playstation: (
    <>
      <path d="M7.5 3.8 10.6 9H4.4z" />
      <circle cx="16.5" cy="6.7" r="2.7" />
      <path d="m5 14.3 5 5m0-5-5 5" />
      <rect x="14" y="14.3" width="5" height="5" rx="0.6" />
    </>
  ),
  // Portátil horizontal com tela larga.
  psp: (
    <>
      <rect x="1.8" y="7" width="20.4" height="10" rx="5" />
      <rect x="7" y="9" width="10" height="6" rx="0.8" />
      <path d="M4.3 12h1.4M18.6 11.2v.1M19.6 12.6v.1" />
    </>
  ),
  // Dobrável de duas telas iguais.
  ds: (
    <>
      <rect x="5" y="2.5" width="14" height="8.5" rx="1.6" />
      <rect x="5" y="13" width="14" height="8.5" rx="1.6" />
      <rect x="8" y="4.5" width="8" height="4.5" rx="0.5" />
      <rect x="8" y="15" width="8" height="4.5" rx="0.5" />
    </>
  ),
  // Tela de cima mais larga e o direcional analógico embaixo.
  n3ds: (
    <>
      <rect x="3" y="2.5" width="18" height="8.5" rx="1.6" />
      <rect x="5" y="13" width="14" height="8.5" rx="1.6" />
      <rect x="6.5" y="4.5" width="11" height="4.5" rx="0.5" />
      <circle cx="7.6" cy="16.2" r="1.3" />
      <rect x="10" y="15" width="5.5" height="4.5" rx="0.5" />
    </>
  ),
  // Tela entre os dois controles destacáveis.
  switch: (
    <>
      <path d="M6 5.5H4.6A2.6 2.6 0 0 0 2 8.1v7.8a2.6 2.6 0 0 0 2.6 2.6H6z" />
      <path d="M18 5.5h1.4A2.6 2.6 0 0 1 22 8.1v7.8a2.6 2.6 0 0 1-2.6 2.6H18z" />
      <rect x="6" y="5.5" width="12" height="13" rx="0.6" />
      <circle cx="4" cy="9.5" r="0.7" fill="currentColor" />
      <circle cx="20" cy="14.5" r="0.7" fill="currentColor" />
    </>
  ),
  // Controle remoto vertical.
  wii: (
    <>
      <rect x="8.5" y="2" width="7" height="20" rx="3.3" />
      <path d="M12 5.2v2.6M10.7 6.5h2.6" />
      <circle cx="12" cy="11.5" r="1.3" />
      <path d="M11.3 16.5h1.4M11.3 18.5h1.4" />
    </>
  ),
  // Cubo em perspectiva.
  gamecube: (
    <>
      <path d="M12 2.8 20.2 7.4v9.2L12 21.2l-8.2-4.6V7.4z" />
      <path d="M3.8 7.4 12 12l8.2-4.6M12 12v9.2" />
    </>
  ),
  // Controle em "tridente" com três pegadas.
  n64: (
    <>
      <path d="M3 8.5c0-1.6 1.2-2.5 2.6-2.5h12.8C19.8 6 21 6.9 21 8.5c0 2.2-.9 4.6-2.3 6.2l-1.7.2-1.4 5.6h-1.8L12.6 15h-1.2l-1.2 5.5H8.4L7 14.9l-1.7-.2C3.9 13.1 3 10.7 3 8.5z" />
      <path d="M6.3 9.4h2.4M7.5 8.2v2.4" />
      <circle cx="16.8" cy="9.4" r="0.8" fill="currentColor" />
    </>
  ),
  // Controle arredondado com quatro botões em losango.
  snes: (
    <>
      <rect x="1.8" y="7" width="20.4" height="10" rx="5" />
      <path d="M5.4 12h3.2M7 10.4v3.2" />
      <circle cx="17" cy="10" r="0.9" />
      <circle cx="17" cy="14" r="0.9" />
      <circle cx="15" cy="12" r="0.9" />
      <circle cx="19" cy="12" r="0.9" />
    </>
  ),
  // Controle retangular com dois botões redondos.
  nes: (
    <>
      <rect x="1.8" y="7" width="20.4" height="10" rx="1.4" />
      <path d="M4.6 12h3.4M6.3 10.3v3.4" />
      <path d="M10 13h1.6M12.4 13H14" />
      <circle cx="16.4" cy="12.6" r="1.1" fill="currentColor" />
      <circle cx="19.2" cy="12.6" r="1.1" fill="currentColor" />
    </>
  ),
  // Portátil vertical com tela em cima.
  gameboy: (
    <>
      <path d="M6.2 2h11.6c.8 0 1.4.6 1.4 1.4V18a4 4 0 0 1-4 4H6.2c-.8 0-1.4-.6-1.4-1.4V3.4c0-.8.6-1.4 1.4-1.4z" />
      <rect x="7.3" y="4.4" width="9.4" height="7.2" rx="0.6" />
      <path d="M7.4 16h3M8.9 14.5v3" />
      <circle cx="14.4" cy="16.6" r="0.9" fill="currentColor" />
      <circle cx="16.4" cy="15" r="0.9" fill="currentColor" />
    </>
  ),
  // Portátil horizontal com tela no centro.
  gba: (
    <>
      <path d="M7 6.5h10c2.8 0 5 2.4 5 5.5s-2.2 5.5-5 5.5H7c-2.8 0-5-2.4-5-5.5s2.2-5.5 5-5.5z" />
      <rect x="7.2" y="8.6" width="9.6" height="6.8" rx="0.6" />
      <path d="M3.5 12h2M4.5 11v2" />
      <circle cx="19.4" cy="11.2" r="0.7" fill="currentColor" />
      <circle cx="18.5" cy="13" r="0.7" fill="currentColor" />
    </>
  ),
  // Esfera com um X curvo.
  xbox: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M7.2 6.2c2.6 1.6 6.2 5.6 9.8 11.8M16.8 6.2c-2.6 1.6-6.2 5.6-9.8 11.8" />
    </>
  ),
  // Controle de três botões grandes.
  sega: (
    <>
      <path d="M6.5 7h11a4.8 4.8 0 0 1 0 9.6h-1.4L14 18.4h-4l-2.1-1.8H6.5a4.8 4.8 0 0 1 0-9.6z" />
      <path d="M4.6 11.8h3.2M6.2 10.2v3.2" />
      <circle cx="14.6" cy="12.6" r="0.9" fill="currentColor" />
      <circle cx="16.8" cy="11.6" r="0.9" fill="currentColor" />
      <circle cx="19" cy="10.6" r="0.9" fill="currentColor" />
    </>
  ),
  // Espiral.
  dreamcast: <path d="M12 3.2a8.8 8.8 0 1 0 8.8 8.8 6 6 0 0 0-6-6 3.8 3.8 0 0 0-3.8 3.8 2 2 0 0 0 2 2" />,
  // Manche de fliperama.
  arcade: (
    <>
      <rect x="3.5" y="15" width="17" height="5.5" rx="1.6" />
      <path d="M10 15V9" />
      <circle cx="10" cy="6.4" r="2.6" fill="currentColor" />
      <circle cx="16.2" cy="12.8" r="1.2" />
    </>
  ),
  pc: (
    <>
      <rect x="2.8" y="3.8" width="18.4" height="12.4" rx="1.6" />
      <path d="M12 16.2v3.6M8.3 20h7.4" />
    </>
  ),
  // Portátil largo com tela grande e dois analógicos embaixo.
  vita: (
    <>
      <rect x="1.8" y="7" width="20.4" height="10" rx="5" />
      <rect x="7" y="8.8" width="10" height="6.4" rx="0.8" />
      <circle cx="4.7" cy="14.1" r="0.9" fill="currentColor" />
      <circle cx="19.3" cy="14.1" r="0.9" fill="currentColor" />
    </>
  ),
  // Controle-tablet com a tela no meio.
  wiiu: (
    <>
      <rect x="1.8" y="6" width="20.4" height="12" rx="3" />
      <rect x="6.6" y="8" width="10.8" height="8" rx="0.6" />
      <circle cx="4.2" cy="9.4" r="0.8" />
      <circle cx="19.8" cy="9.4" r="0.8" />
      <path d="M3.4 13.6h1.6M4.2 12.8v1.6" />
    </>
  ),
  // Anel de luz em quatro partes em volta de um X.
  xbox360: (
    <>
      <circle cx="12" cy="12" r="8.6" strokeDasharray="11.5 2" />
      <path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6" />
    </>
  ),
  // Visor de duas lentes sobre o suporte.
  virtualboy: (
    <>
      <path d="M3 6.5h18A1.5 1.5 0 0 1 22.5 8v4a3 3 0 0 1-3 3h-15a3 3 0 0 1-3-3V8A1.5 1.5 0 0 1 3 6.5z" />
      <circle cx="8" cy="10.8" r="2" />
      <circle cx="16" cy="10.8" r="2" />
      <path d="M12 15v4.2M8.5 20.5h7" />
    </>
  ),
  // Portátil pequeno com um botão grande.
  pokemini: (
    <>
      <rect x="6" y="3.5" width="12" height="17" rx="3" />
      <rect x="8.3" y="6" width="7.4" height="6" rx="0.6" />
      <circle cx="12" cy="16.2" r="1.8" />
    </>
  ),
  // Disco com o reflexo.
  segacd: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.2" />
      <path d="M12 5.6a6.4 6.4 0 0 1 6.4 6.4" />
    </>
  ),
  // Planeta com anel.
  saturn: (
    <>
      <circle cx="12" cy="12" r="5.2" />
      <ellipse cx="12" cy="12" rx="10.2" ry="3.4" transform="rotate(-20 12 12)" />
    </>
  ),
  // Console quadradinho com a entrada do cartão.
  pcengine: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="1.6" />
      <path d="M7 9h10" />
      <rect x="7" y="12.4" width="4.2" height="3.6" rx="0.5" />
      <circle cx="16" cy="14.2" r="1" />
    </>
  ),
  // Joystick de uma alavanca e um botão.
  atari2600: (
    <>
      <rect x="5" y="13" width="14" height="8" rx="1.6" />
      <path d="M12 13V7" />
      <circle cx="12" cy="5.4" r="1.9" fill="currentColor" />
      <circle cx="8" cy="16" r="1.1" fill="currentColor" />
    </>
  ),
  // Portátil bem largo, tela no meio e pegadas nas pontas.
  lynx: (
    <>
      <rect x="1.5" y="7" width="21" height="10" rx="2.5" />
      <rect x="8" y="9" width="8.5" height="6" rx="0.5" />
      <path d="M3.8 12h2.4M5 10.8v2.4" />
      <circle cx="19.3" cy="10.8" r="0.8" fill="currentColor" />
      <circle cx="19.3" cy="13.6" r="0.8" fill="currentColor" />
    </>
  ),
  // Portátil compacto com o direcional em disco.
  ngp: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="4" />
      <rect x="6" y="7" width="12" height="6.4" rx="0.6" />
      <circle cx="7.6" cy="16.4" r="1.4" />
      <circle cx="15.4" cy="16.6" r="0.8" fill="currentColor" />
      <circle cx="17.8" cy="15.8" r="0.8" fill="currentColor" />
    </>
  ),
  // Botões nos dois lados da tela (o jogo pode ser segurado deitado ou em pé).
  wonderswan: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <rect x="7.5" y="8.2" width="9" height="7.6" rx="0.5" />
      <circle cx="4.8" cy="10" r="0.7" fill="currentColor" />
      <circle cx="4.8" cy="12.6" r="0.7" fill="currentColor" />
      <circle cx="19.2" cy="13.4" r="0.7" fill="currentColor" />
      <circle cx="19.2" cy="16" r="0.7" fill="currentColor" />
    </>
  ),
  // Controle com o disco em cima e o teclado numérico.
  colecovision: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2" />
      <circle cx="12" cy="6.4" r="1.8" />
      <path d="M9.6 11.2h0M12 11.2h0M14.4 11.2h0M9.6 13.8h0M12 13.8h0M14.4 13.8h0M9.6 16.4h0M12 16.4h0M14.4 16.4h0" strokeWidth="2.4" />
    </>
  ),
  // Monitor vertical com desenho vetorial.
  vectrex: (
    <>
      <rect x="5" y="2.5" width="14" height="19" rx="1.8" />
      <rect x="7.2" y="4.8" width="9.6" height="11" rx="0.6" />
      <path d="M9.2 13.4 12 7.4l2.8 6z" />
      <path d="M8.5 18.6h7" />
    </>
  ),
  // Computador-teclado.
  msx: (
    <>
      <rect x="1.8" y="7" width="20.4" height="10" rx="1.4" />
      <path d="M4.6 10h1M7.2 10h1M9.8 10h1M12.4 10h1M15 10h1M17.6 10h1.8M5.6 12.5h1M8.2 12.5h1M10.8 12.5h1M13.4 12.5h1M16 12.5h1M7.5 15h9" />
    </>
  ),
  gamepad: (
    <>
      <path d="M7 7h10a5 5 0 0 1 4.9 6l-.6 3a2.6 2.6 0 0 1-4.5 1.2L15 15H9l-1.8 2.2a2.6 2.6 0 0 1-4.5-1.2l-.6-3A5 5 0 0 1 7 7z" />
      <path d="M6.2 11h3M7.7 9.5v3" />
      <circle cx="15.8" cy="10" r="0.8" fill="currentColor" />
      <circle cx="17.8" cy="12" r="0.8" fill="currentColor" />
    </>
  ),
  star: <path d="m12 3.2 2.6 5.5 6 .7-4.4 4.1 1.2 5.9L12 16.5l-5.4 2.9 1.2-5.9-4.4-4.1 6-.7z" fill="currentColor" />,
  heart: (
    <path
      d="M12 20s-7.8-4.6-7.8-10.2A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 7.8 2.8C19.8 15.4 12 20 12 20z"
      fill="currentColor"
    />
  ),
  trophy: (
    <>
      <path d="M8 20.5h8M12 16.5v4M7 3.5h10v5a5 5 0 0 1-10 0z" />
      <path d="M17 4.5h3v2a3 3 0 0 1-3 3M7 4.5H4v2a3 3 0 0 0 3 3" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  flag: <path d="M5 21V4m0 0c3-1.6 5.4 1.6 8.4 0S18 2.4 19 4v9c-1 1.6-3.6.4-5.6 1.4S8 16.6 5 15" />,
};

interface CategoryIconProps {
  icon: CategoryIconKey;
  /** Lado do ícone em px (o desenho se ajusta). */
  size?: number;
  className?: string;
}

/** Tamanho do selo pelo número de letras ("2" grande, "7800" pequeno), no grid 24×24. */
const BADGE_FONT = [0, 14, 11, 9, 7.4] as const;
/** Escala do desenho da família quando há selo (fica no canto de cima, à esquerda). */
const BADGE_GLYPH_SCALE = 0.62;

/** Ícone de categoria no estilo dos ícones de app do macOS: quadrado arredondado colorido com o símbolo. */
export function CategoryIcon({ icon, size = 18, className }: CategoryIconProps) {
  const { color } = CATEGORY_ICONS[icon];
  const { glyph, badge } = iconParts(icon);
  const strokeWidth = size < 20 ? 2.1 : 1.7;
  return (
    <span
      className={cx('category-icon', className)}
      style={{ width: size, height: size, borderRadius: size * 0.27, ['--icon-color' as string]: color }}
      aria-hidden="true"
    >
      <svg
        width={size * 0.74}
        height={size * 0.74}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {badge ? (
          <>
            {/* O traço compensa a escala para não ficar mais fino que o dos outros ícones. */}
            <g transform={`scale(${BADGE_GLYPH_SCALE})`} strokeWidth={strokeWidth / BADGE_GLYPH_SCALE}>
              {GLYPHS[glyph]}
            </g>
            <text
              x="23.6"
              y="23.2"
              textAnchor="end"
              fontSize={BADGE_FONT[Math.min(badge.length, 4)]}
              fontWeight={800}
              letterSpacing="-0.3"
              fill="currentColor"
              stroke="none"
            >
              {badge}
            </text>
          </>
        ) : (
          GLYPHS[glyph]
        )}
      </svg>
    </span>
  );
}
