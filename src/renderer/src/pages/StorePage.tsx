import { useDeferredValue, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QUIVER_SITE } from '@shared/store';
import { AddCustomPortDialog } from '@/components/store/AddCustomPortDialog';
import { PortTile } from '@/components/store/PortArtwork';
import { PortDetails } from '@/components/store/PortDetails';
import { UpdateAllButton } from '@/components/store/UpdateAllButton';
import { Button } from '@/components/ui/Button';
import { Cascade, type CascadeItem } from '@/components/ui/Cascade';
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { PlusIcon, SearchIcon, StoreIcon } from '@/components/ui/icons';
import { useStoreCatalog, useStoreInstalls, useStoreUpdates } from '@/hooks/queries';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { call, errorMessage } from '@/lib/api';
import { buildPortIndex, filterPorts } from '@/lib/search';

/** Cada port novo custa 1 das 60 consultas/hora do GitHub: as versões só são buscadas quando a seleção para. */
const RELEASES_SETTLE_MS = 400;

/**
 * Loja de ports. Cascata do PS5: ports à esquerda, detalhes à direita.
 * O port escolhido fica na URL (?port=), como a seção nas Configurações.
 */
export function StorePage() {
  const { data: catalog, isLoading, error, refetch, isFetching } = useStoreCatalog();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim());
  const [adding, setAdding] = useState(false);
  const toast = useToast();

  const { data: installsData } = useStoreInstalls();
  const { data: updates } = useStoreUpdates();
  const index = useMemo(() => buildPortIndex(catalog?.ports ?? []), [catalog]);
  const ports = useMemo(() => filterPorts(index, deferredQuery), [index, deferredQuery]);
  const items = useMemo<CascadeItem<string>[]>(() => {
    const installed = new Set(installsData?.installs.map((i) => i.portId));
    return ports.map((p) => ({
      id: p.id,
      label: p.name,
      description: p.original.title,
      icon: <PortTile port={p} size={44} />,
      trailing: updates?.[p.id] ? (
        <span className="store-pill store-pill--update">Atualização</span>
      ) : installed.has(p.id) ? (
        <span className="store-pill store-pill--installed">Instalado</span>
      ) : p.custom ? (
        <span className="store-pill">Seu</span>
      ) : undefined,
    }));
  }, [ports, installsData, updates]);

  const fromUrl = params.get('port');
  const selected = ports.find((p) => p.id === fromUrl) ?? ports[0] ?? null;
  // Fica aqui (e não no painel) porque o painel é recriado a cada troca de port.
  const settledId = useDebouncedValue(selected?.id ?? null, RELEASES_SETTLE_MS);

  if (isLoading) {
    return (
      <div className="page">
        <LoadingBlock label="Carregando a Loja…">
          <Skeleton className="skeleton--hero" />
        </LoadingBlock>
      </div>
    );
  }
  if (error || !catalog) {
    return (
      <div className="page">
        <ErrorState title="Não foi possível abrir a Loja" message={errorMessage(error)} onRetry={() => void refetch()} retrying={isFetching} />
      </div>
    );
  }

  return (
    <div className="page store">
      <div className="store__header">
        <h1 className="page__title">Loja de ports</h1>
        <p className="store__credit">
          Seleção baseada no ranking do{' '}
          <button type="button" className="store__credit-link" onClick={() => void call('app:open-external', QUIVER_SITE)}>
            Quiver Launcher
          </button>
          . Todo o crédito é de quem fez cada port.
        </p>
        <Button size="sm" icon={<PlusIcon size={14} />} onClick={() => setAdding(true)}>
          Adicionar do GitHub…
        </Button>
        <UpdateAllButton names={Object.fromEntries(catalog.ports.map((p) => [p.id, p.name]))} />
      </div>
      <AddCustomPortDialog
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={(port) => {
          setQuery('');
          setParams({ port: port.id }, { replace: true });
          toast.push({ tone: 'success', title: `${port.name} adicionado à Loja`, description: 'Agora é só baixar, como os outros ports.' });
        }}
      />
      <Cascade
        label="Ports disponíveis"
        items={items}
        value={selected?.id ?? ''}
        onChange={(id) => setParams({ port: id }, { replace: true })}
        listHeader={
          <div className="store__search">
            <SearchIcon size={16} />
            <label className="sr-only" htmlFor="store-search">
              Buscar port
            </label>
            <input
              id="store-search"
              type="search"
              className="store__search-input"
              placeholder="Buscar por jogo, port ou equipe"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        }
      >
        {selected ? (
          <PortDetails port={selected} settled={settledId === selected.id} />
        ) : (
          <EmptyState icon={<StoreIcon size={28} />} title="Nenhum port encontrado" description={`Nada corresponde a “${query.trim()}”.`} compact />
        )}
      </Cascade>
      <p className="store__footnote">
        {catalog.source === 'remote' ? 'Catálogo online' : 'Catálogo embutido no app'} · {catalog.ports.length} ports. A Loja só baixa os programas de
        código aberto publicados por cada projeto; o jogo vem da sua própria cópia.
      </p>
    </div>
  );
}
