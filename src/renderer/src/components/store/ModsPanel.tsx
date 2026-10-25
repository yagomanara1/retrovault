import { useDeferredValue, useState } from 'react';
import type { ModSort, ModSummary } from '@shared/mods';
import type { StorePort } from '@shared/store';
import { modKey, useInstalledMods, useModActions, useModDetails, useModList, useModProgress } from '@/hooks/queries';
import { call, errorMessage } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { Button } from '../ui/Button';
import { SegmentedControl } from '../ui/Form';
import { Modal } from '../ui/Modal';
import { ErrorState, Skeleton } from '../ui/States';
import { useToast } from '../ui/Toast';
import { CheckIcon, DownloadIcon, HeartIcon, LinkIcon, SearchIcon, TrashIcon } from '../ui/icons';

const SORTS = [
  { value: 'popular', label: 'Mais curtidos' },
  { value: 'downloads', label: 'Mais baixados' },
  { value: 'newest', label: 'Recentes' },
] as const;

type Tab = 'browse' | 'installed';

/**
 * Mods do GameBanana para o port: explorar (busca e ordenação), ver detalhes e instalar com um clique
 * na pasta de mods do port; e a lista dos instalados, com "Remover".
 */
export function ModsPanel({ port, installed }: { port: StorePort; installed: boolean }) {
  const [tab, setTab] = useState<Tab>('browse');
  const [sort, setSort] = useState<ModSort>('popular');
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query.trim());
  const [openMod, setOpenMod] = useState<number | null>(null);
  const list = useModList(port.id, sort, deferred, tab === 'browse');
  const { data: installedMods = [] } = useInstalledMods(port.id, installed);
  const installedIds = new Set(installedMods.map((m) => m.modId));
  const mods = list.data?.pages.flatMap((p) => p.mods) ?? [];

  return (
    <section className="panel mods" aria-labelledby={`mods-${port.id}`}>
      <header className="panel__header">
        <h2 id={`mods-${port.id}`} className="panel__title">
          Mods
        </h2>
        <SegmentedControl
          label="Mostrar"
          value={tab}
          options={[
            { value: 'browse', label: 'Explorar' },
            { value: 'installed', label: `Instalados (${installedMods.length})` },
          ]}
          onChange={setTab}
        />
      </header>
      {!installed && <p className="muted mods__note">Instale o port para adicionar mods. Dá para explorar antes.</p>}

      {tab === 'browse' ? (
        <>
          <div className="mods__toolbar">
            <div className="store__search mods__search">
              <SearchIcon size={16} />
              <label className="sr-only" htmlFor={`mods-search-${port.id}`}>
                Buscar mod
              </label>
              <input
                id={`mods-search-${port.id}`}
                type="search"
                className="store__search-input"
                placeholder="Buscar mod"
                value={query}
                maxLength={80}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <SegmentedControl label="Ordenar" value={sort} options={SORTS} onChange={setSort} />
          </div>
          {list.isError ? (
            <ErrorState title="Não foi possível carregar os mods" message={errorMessage(list.error)} onRetry={() => void list.refetch()} retrying={list.isFetching} />
          ) : list.isLoading ? (
            <div className="mods__grid" aria-busy="true">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="mods__skeleton" />
              ))}
            </div>
          ) : mods.length === 0 ? (
            <p className="muted" role="status">
              {deferred ? `Nenhum mod com “${deferred}”.` : 'Ainda não há mods para este port no GameBanana.'}
            </p>
          ) : (
            <>
              <ul className="mods__grid">
                {mods.map((m) => (
                  <li key={m.id}>
                    <ModCard mod={m} installed={installedIds.has(m.id)} onOpen={() => setOpenMod(m.id)} />
                  </li>
                ))}
              </ul>
              {list.hasNextPage && (
                <div className="mods__more">
                  <Button size="sm" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                    Carregar mais
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <InstalledList port={port} />
      )}
      <p className="muted mods__credit">
        Mods da comunidade no GameBanana. A Loja baixa só os arquivos publicados lá, confere o tamanho e o MD5 e põe na pasta de mods do port.
      </p>
      <ModDialog port={port} modId={openMod} canInstall={installed} onClose={() => setOpenMod(null)} />
    </section>
  );
}

function ModCard({ mod, installed, onOpen }: { mod: ModSummary; installed: boolean; onOpen: () => void }) {
  return (
    <button type="button" className="mod-card" onClick={onOpen} aria-label={`${mod.name}${installed ? ' (instalado)' : ''}`}>
      <span className="mod-card__image">{mod.thumb ? <img src={mod.thumb} alt="" loading="lazy" decoding="async" /> : null}</span>
      <span className="mod-card__name">{mod.name}</span>
      <span className="mod-card__meta">
        {installed && (
          <span className="store-pill store-pill--installed">
            <CheckIcon size={11} /> Instalado
          </span>
        )}
        {mod.category && <span>{mod.category}</span>}
        <span className="mod-card__likes">
          <HeartIcon size={11} /> {mod.likes}
        </span>
      </span>
    </button>
  );
}

function ModDialog({ port, modId, canInstall, onClose }: { port: StorePort; modId: number | null; canInstall: boolean; onClose: () => void }) {
  const { data: mod, isLoading, error } = useModDetails(port.id, modId);
  const { data: installedMods = [] } = useInstalledMods(port.id, canInstall);
  const { install } = useModActions(port.id);
  const progress = useModProgress();
  const toast = useToast();
  const [image, setImage] = useState(0);
  const current = modId !== null ? installedMods.find((m) => m.modId === modId) : undefined;
  const running = modId !== null ? progress[modKey(port.id, modId)] : undefined;

  return (
    <Modal open={modId !== null} onClose={onClose} title={mod?.name ?? 'Mod'} description={mod ? `por ${mod.author ?? 'autor desconhecido'}${mod.version ? ` · versão ${mod.version}` : ''}` : undefined} size="lg">
      {isLoading ? (
        <Skeleton className="skeleton--hero" />
      ) : error || !mod ? (
        <p className="field__error" role="alert">
          {errorMessage(error)}
        </p>
      ) : (
        <div className="mod-detail">
          {mod.images.length > 0 && (
            <div className="mod-detail__gallery">
              <img className="mod-detail__image" src={mod.images[Math.min(image, mod.images.length - 1)]} alt="" />
              {mod.images.length > 1 && (
                <div className="mod-detail__thumbs" role="group" aria-label="Imagens">
                  {mod.images.map((src, i) => (
                    <button key={src} type="button" aria-label={`Imagem ${i + 1}`} aria-pressed={i === image} onClick={() => setImage(i)}>
                      <img src={src} alt="" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <p className="mod-detail__stats muted">
            {mod.category && <span>{mod.category}</span>}
            <span>
              <HeartIcon size={12} /> {mod.likes}
            </span>
            <span>
              <DownloadIcon size={12} /> {mod.downloads}
            </span>
          </p>
          {mod.text && <div className="mod-detail__text">{mod.text}</div>}
          <h3 className="artwork-slot__title">Arquivos</h3>
          <ul className="mod-detail__files">
            {mod.files.map((f) => {
              const isCurrent = current?.fileId === f.id;
              return (
                <li key={f.id} className="mod-detail__file">
                  <div>
                    <strong>{f.name}</strong>
                    <span className="muted">
                      {formatBytes(f.size)}
                      {!f.scanOk && ' · ainda não conferido contra vírus pelo GameBanana'}
                    </span>
                    {f.description && <span className="muted">{f.description}</span>}
                  </div>
                  {running && install.isPending && install.variables?.fileId === f.id ? (
                    <progress className="mod-detail__progress" value={running.received} max={running.total || 1} aria-label="Baixando" />
                  ) : (
                    <Button
                      size="sm"
                      variant={isCurrent ? 'secondary' : 'primary'}
                      icon={<DownloadIcon size={14} />}
                      disabled={!canInstall || !f.scanOk || install.isPending}
                      title={!canInstall ? 'Instale o port primeiro' : undefined}
                      loading={install.isPending && install.variables?.fileId === f.id}
                      onClick={() =>
                        install.mutate(
                          { modId: mod.id, fileId: f.id },
                          {
                            onSuccess: (m) => toast.push({ tone: 'success', title: `${m.name} instalado`, description: `${m.files.length} arquivo(s) na pasta de mods. Abra o jogo para usar.` }),
                            onError: (err) => toast.push({ tone: 'error', title: 'Não foi possível instalar', description: errorMessage(err) }),
                          },
                        )
                      }
                    >
                      {isCurrent ? 'Reinstalar' : current ? 'Trocar por este' : 'Instalar'}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          <Button variant="ghost" size="sm" icon={<LinkIcon size={14} />} onClick={() => void call('app:open-external', mod.url)}>
            Ver no GameBanana
          </Button>
        </div>
      )}
    </Modal>
  );
}

function InstalledList({ port }: { port: StorePort }) {
  const { data: mods = [], isLoading } = useInstalledMods(port.id);
  const { uninstall } = useModActions(port.id);
  const toast = useToast();
  if (isLoading) return <Skeleton className="mods__skeleton" />;
  if (mods.length === 0) return <p className="muted">Nenhum mod instalado. Escolha um em "Explorar".</p>;
  return (
    <ul className="mods__installed">
      {mods.map((m) => (
        <li key={m.modId}>
          <div>
            <strong>{m.name}</strong>
            <span className="muted">
              {m.version ? `versão ${m.version} · ` : ''}
              {m.files.map((f) => f.split('/').pop()).join(', ')}
            </span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            icon={<TrashIcon size={14} />}
            loading={uninstall.isPending && uninstall.variables === m.modId}
            onClick={() =>
              uninstall.mutate(m.modId, {
                onSuccess: () => toast.push({ tone: 'info', title: `${m.name} removido` }),
                onError: (err) => toast.push({ tone: 'error', title: 'Não foi possível remover', description: errorMessage(err) }),
              })
            }
          >
            Remover
          </Button>
        </li>
      ))}
    </ul>
  );
}
