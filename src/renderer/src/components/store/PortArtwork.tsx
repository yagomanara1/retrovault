import type { StorePort } from '@shared/store';
import { useStoreArt } from '@/hooks/queries';
import { cx } from '@/lib/cx';
import { CategoryIcon } from '../categories/CategoryIcon';

/**
 * Ladrilho do port: quadrado escuro com a capa do jogo original inteira dentro (ou o ícone do
 * SteamGridDB, ou o logo/banner que o próprio projeto publica). Sem arte ainda, o símbolo da
 * plataforma no mesmo ladrilho, para a lista não "pular".
 */
export function PortTile({ port, size, className }: { port: StorePort; size: number; className?: string }) {
  const { data: art } = useStoreArt(port.id);
  const src = art?.icon ?? art?.cover ?? art?.logo;
  return (
    <span className={cx('port-tile', className)} style={{ width: size, height: size }} aria-hidden="true">
      {src ? (
        <img className={art?.icon ? 'port-tile__icon' : 'port-tile__cover'} src={src} alt="" loading="lazy" decoding="async" />
      ) : (
        <CategoryIcon icon={port.original.platform} size={Math.round(size * 0.62)} />
      )}
    </span>
  );
}

/**
 * Topo da página do port: banner (hero) com o logo por cima. Sem banner nem logo, não ocupa
 * espaço (o cabeçalho continua igual).
 */
export function PortBanner({ port }: { port: StorePort }) {
  const { data: art } = useStoreArt(port.id);
  if (!art || (!art.hero && !art.logo)) return null;
  return (
    <div className={art.hero ? 'port-banner' : 'port-banner port-banner--logo-only'} aria-hidden="true">
      {art.hero && <img className="port-banner__hero" src={art.hero} alt="" decoding="async" />}
      {art.logo && <img className="port-banner__logo" src={art.logo} alt="" decoding="async" />}
    </div>
  );
}
