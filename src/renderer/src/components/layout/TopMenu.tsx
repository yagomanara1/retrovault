import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useProfile, useStoreUpdates } from '@/hooks/queries';
import { cx } from '@/lib/cx';
import { ManageCategoriesDialog } from '../categories/ManageCategoriesDialog';
import { AddGameDialog } from '../library/AddGameDialog';
import { ScanFolderDialog } from '../library/ScanFolderDialog';
import { CloseIcon, FolderIcon, GearIcon, HomeIcon, LibraryIcon, PlusIcon, SearchIcon, StoreIcon, TagIcon, TrophyIcon } from '../ui/icons';

/** Busca da fileira (só na tela inicial); nas outras telas a lupa leva até ela. */
export interface TopMenuSearch {
  query: string;
  onQueryChange: (query: string) => void;
  /** Abre já com o campo aberto (ex.: veio da lupa de outra tela). */
  initiallyOpen?: boolean;
}

interface TopMenuProps {
  search?: TopMenuSearch;
  onShowGrid?: () => void;
}

/**
 * Menu do canto superior direito em todas as telas (como no PS5: busca, ajustes, avatar e relógio).
 * O ícone da tela atual fica marcado; fora da tela inicial aparece o 🏠 para voltar.
 */
export function TopMenu({ search, onShowGrid }: TopMenuProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { data: profile } = useProfile();
  const { data: updates } = useStoreUpdates();
  const updateCount = updates ? Object.keys(updates).length : 0;
  const [searchOpen, setSearchOpen] = useState(!!search?.initiallyOpen || !!search?.query);
  const [dialog, setDialog] = useState<'add' | 'scan' | 'categories' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isHome = pathname === '/';

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  function closeSearch() {
    search?.onQueryChange('');
    setSearchOpen(false);
  }

  return (
    <div className="ps-menu">
      {search && searchOpen ? (
        <div className="ps-menu__search" role="search">
          <SearchIcon size={16} />
          <label className="sr-only" htmlFor="home-search">
            Buscar jogo
          </label>
          <input
            id="home-search"
            ref={inputRef}
            type="search"
            placeholder="Buscar jogo"
            value={search.query}
            onChange={(e) => search.onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                closeSearch();
              }
            }}
          />
          <button type="button" className="ps-menu__search-close" onClick={closeSearch} aria-label="Fechar busca">
            <CloseIcon size={14} />
          </button>
        </div>
      ) : (
        <MenuButton
          label="Buscar"
          onClick={() => (search ? setSearchOpen(true) : navigate('/?view=console', { state: { openSearch: true } }))}
        >
          <SearchIcon size={19} />
        </MenuButton>
      )}
      {!isHome && (
        <MenuButton label="Início" onClick={() => navigate('/?view=console')}>
          <HomeIcon size={19} />
        </MenuButton>
      )}
      <MenuButton
        label={updateCount ? `Loja de ports (${updateCount} ${updateCount === 1 ? 'atualização' : 'atualizações'})` : 'Loja de ports'}
        current={pathname === '/loja'}
        onClick={() => navigate('/loja')}
        badge={updateCount}
      >
        <StoreIcon size={19} />
      </MenuButton>
      <MenuButton label="Adicionar jogo" onClick={() => setDialog('add')}>
        <PlusIcon size={20} />
      </MenuButton>
      <MenuButton label="Adicionar pasta de jogos" onClick={() => setDialog('scan')}>
        <FolderIcon size={19} />
      </MenuButton>
      <MenuButton label="Categorias" onClick={() => setDialog('categories')}>
        <TagIcon size={19} />
      </MenuButton>
      <MenuButton label="Ver em grade" onClick={onShowGrid ?? (() => navigate('/?view=grid'))}>
        <LibraryIcon size={19} />
      </MenuButton>
      <MenuButton label="Conquistas" current={pathname === '/profile'} onClick={() => navigate('/profile')}>
        <TrophyIcon size={19} />
      </MenuButton>
      <MenuButton label="Configurações" current={pathname === '/settings'} onClick={() => navigate('/settings')}>
        <GearIcon size={19} />
      </MenuButton>
      {profile?.avatarUrl && (
        <button
          type="button"
          className="ps-menu__avatar"
          onClick={() => navigate('/profile?tab=ra')}
          aria-label={`Perfil de ${profile.username} no RetroAchievements`}
          title={profile.username}
        >
          <img src={profile.avatarUrl} alt="" width={34} height={34} />
        </button>
      )}
      <Clock />

      <AddGameDialog open={dialog === 'add'} onClose={() => setDialog(null)} />
      <ScanFolderDialog open={dialog === 'scan'} onClose={() => setDialog(null)} />
      <ManageCategoriesDialog open={dialog === 'categories'} onClose={() => setDialog(null)} />
    </div>
  );
}

function MenuButton({
  label,
  onClick,
  current,
  badge,
  children,
}: {
  label: string;
  onClick: () => void;
  current?: boolean;
  /** Número no canto (ex.: atualizações de ports); 0 ou ausente esconde. O rótulo já diz o número. */
  badge?: number;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cx('ps-menu__btn', current && 'ps-menu__btn--current')}
      onClick={onClick}
      aria-label={label}
      aria-current={current ? 'page' : undefined}
      title={label}
    >
      {children}
      {!!badge && (
        <span className="ps-menu__badge" aria-hidden="true">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  return (
    <time className="ps-menu__clock" dateTime={now.toISOString()}>
      {now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
    </time>
  );
}
