import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CATEGORY_ICONS } from '@shared/categoryIcons';
import { QUIVER_SITE, type StorePort, type StoreRelease } from '@shared/store';
import { PortBanner, PortTile } from '@/components/store/PortArtwork';
import { Button } from '@/components/ui/Button';
import { Cascade, type CascadeItem } from '@/components/ui/Cascade';
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '@/components/ui/States';
import { AlertIcon, CheckIcon, DownloadIcon, PlusIcon, SearchIcon, StoreIcon, TrashIcon } from '@/components/ui/icons';
import { AddCustomPortDialog } from '@/components/store/AddCustomPortDialog';
import { ModsPanel } from '@/components/store/ModsPanel';
import { PortActions } from '@/components/store/PortActions';
import { useAiGuard } from '@/components/store/useAiGuard';
import { usePortInstaller } from '@/components/store/usePortInstaller';
import {
  useInstallProgress,
  useRunningGames,
  useSettings,
  useStoreCatalog,
  useStoreInstalls,
  useStoreReleases,
  useStoreUpdates,
  useUpdateAllPorts,
  useCustomPorts,
} from '@/hooks/queries';
import { useToast } from '@/components/ui/Toast';
import { call, errorMessage, isApiError } from '@/lib/api';
import { formatBytes, formatDate } from '@/lib/format';

/**
 * Busca sem acento, maiúsculas nem pontuação: "majoras" acha "Majora's", "zelda64" acha "Zelda 64:".
 * Apóstrofos somem (juntam a palavra); o resto da pontuação vira espaço.
 */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ');
}

/** Texto pesquisável de cada port, calculado uma vez por catálogo (não a cada tecla). */
function searchIndex(ports: readonly StorePort[]): { port: StorePort; text: string; compact: string }[] {
  return ports.map((port) => {
    const text = normalize(`${port.name} ${port.original.title} ${port.developer} ${port.tags.join(' ')}`);
    return { port, text, compact: text.replace(/ /g, '') };
  });
}

function filterPorts(index: ReturnType<typeof searchIndex>, query: string): StorePort[] {
  const words = normalize(query).split(' ').filter(Boolean);
  return index.filter(({ text, compact }) => words.every((w) => text.includes(w) || compact.includes(w))).map(({ port }) => port);
}

/**
 * "Atualizar tudo (N)": aparece só quando há atualizações. Os ports de instalador e os abertos
 * ficam de fora (o resumo diz quais e por quê); o progresso de cada um aparece na própria página.
 */
function UpdateAllButton({ names }: { names: Record<string, string> }) {
  const { data: updates } = useStoreUpdates();
  const updateAll = useUpdateAllPorts();
  const toast = useToast();
  const count = updates ? Object.keys(updates).length : 0;
  if (count === 0 && !updateAll.isPending) return null;
  const list = (ids: string[]) => ids.map((id) => names[id] ?? id).join(', ');
  return (
    <Button
      size="sm"
      variant="primary"
      icon={<DownloadIcon size={14} />}
      loading={updateAll.isPending}
      onClick={() =>
        updateAll.mutate(undefined, {
          onSuccess: ({ updated, skipped, failed }) => {
            const installers = skipped.filter((s) => s.reason === 'installer').map((s) => s.portId);
            const running = skipped.filter((s) => s.reason === 'running').map((s) => s.portId);
            const notes = [
              installers.length ? `Pelo instalador (atualize na página do port): ${list(installers)}.` : '',
              running.length ? `Abertos agora (feche e tente de novo): ${list(running)}.` : '',
              failed.length ? `Com erro: ${failed.map((f) => `${names[f.portId] ?? f.portId} (${f.message})`).join('; ')}.` : '',
            ].filter(Boolean);
            toast.push({
              tone: failed.length ? 'error' : updated.length ? 'success' : 'info',
              title: updated.length ? `${updated.length} ${updated.length === 1 ? 'port atualizado' : 'ports atualizados'}` : 'Nenhum port atualizado',
              description: notes.join(' ') || list(updated),
            });
          },
          onError: (err) => toast.push({ tone: 'error', title: 'Não foi possível atualizar', description: errorMessage(err) }),
        })
      }
    >
      {updateAll.isPending ? 'Atualizando…' : `Atualizar tudo (${count})`}
    </Button>
  );
}

/**
 * Loja de ports (Etapa 1: só leitura). Cascata do PS5: ports à esquerda, detalhes à direita.
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
  const index = useMemo(() => searchIndex(catalog?.ports ?? []), [catalog]);
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
  // Cada port novo custa 1 das 60 consultas/hora do GitHub: as versões só são buscadas quando a
  // seleção para. Fica aqui (e não no painel) porque o painel é recriado a cada troca de port.
  const settledId = useSettled(selected?.id ?? null, RELEASES_SETTLE_MS);

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
        <UpdateAllButton names={Object.fromEntries((catalog?.ports ?? []).map((p) => [p.id, p.name]))} />
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

/** Port adicionado pelo usuário: lembra que não passou pela curadoria e permite tirá-lo da Loja. */
function CustomPortNotice({ port, installed }: { port: StorePort; installed: boolean }) {
  const { remove } = useCustomPorts();
  const toast = useToast();
  const [, setParams] = useSearchParams();
  const busy = installed || !!useInstallProgress()[port.id];
  return (
    <div className="store-port__custom" role="note">
      <span>Adicionado por você · sem curadoria da Loja.</span>
      <Button
        size="sm"
        variant="ghost"
        icon={<TrashIcon size={14} />}
        disabled={busy}
        title={busy ? 'Desinstale (ou espere a instalação terminar) antes de remover da Loja' : undefined}
        loading={remove.isPending}
        onClick={() =>
          remove.mutate(port.id, {
            onSuccess: () => {
              setParams({}, { replace: true });
              toast.push({ tone: 'info', title: `${port.name} removido da Loja` });
            },
            onError: (err) => toast.push({ tone: 'error', title: 'Não foi possível remover', description: errorMessage(err) }),
          })
        }
      >
        Remover da Loja
      </Button>
    </div>
  );
}

/** `settled`: a seleção parou; só então as versões são buscadas (ver StorePage). */
function PortDetails({ port, settled }: { port: StorePort; settled: boolean }) {
  const platform = port.original.system ?? CATEGORY_ICONS[port.original.platform].label;
  const installed = !!useStoreInstalls().data?.installs.some((i) => i.portId === port.id);
  return (
    <div className="store-port">
      <section className="panel store-port__hero" aria-labelledby="store-port-name">
        <PortBanner port={port} />
        <div className="store-port__head">
          <PortTile port={port} size={112} className="port-tile--large" />
          <div className="store-port__titles">
            <p className="store-port__eyebrow">
              {platform} · {port.tags.includes('Recompilação') ? 'Recompilação' : 'Port'}
              {port.ai === 'generated' && <span className="store-ai store-ai--generated">Gerado por IA</span>}
              {port.ai === 'assisted' && <span className="store-ai">Feito com ajuda de IA</span>}
            </p>
            <h2 id="store-port-name" className="store-port__name">
              {port.name}
            </h2>
            <p className="store-port__origin">
              <span className="store-port__based">Baseado em</span>
              <span className="store-port__chip">{port.original.title}</span>
              <span>por {port.developer}</span>
            </p>
          </div>
        </div>
        <p className="store-port__summary">{port.summary}</p>
        {port.tags.length > 0 && (
          <ul className="store-port__tags" aria-label="Etiquetas">
            {port.tags.map((t) => (
              <li key={t} className="store-port__tag">
                {t}
              </li>
            ))}
          </ul>
        )}
        <PortActions port={port} settled={settled} />
        {port.custom && <CustomPortNotice port={port} installed={installed} />}
        {/* Instalado e com assistente: o painel "ROM do jogo" já diz o que falta. */}
        {!(installed && port.setup) &&
          (port.requires.kind === 'none' ? (
            <div className="store-port__requirement store-port__requirement--free" role="note">
              <CheckIcon size={18} />
              <div>
                <strong>{port.requires.label}.</strong>
                {port.requires.note && <span> {port.requires.note}</span>}
              </div>
            </div>
          ) : (
            <div className="store-port__requirement" role="note">
              <AlertIcon size={18} />
              <div>
                <strong>Você precisa da sua própria cópia: {port.requires.label}.</strong>
                {port.requires.note && <span> {port.requires.note}</span>}
                <span className="store-port__requirement-hint"> A Loja nunca baixa o jogo, só o programa.</span>
              </div>
            </div>
          ))}
        {port.description && <p className="store-port__description">{port.description}</p>}
      </section>
      {port.mods && settled && <ModsPanel port={port} installed={installed} />}
      <ReleaseList port={port} settled={settled} />
    </div>
  );
}

/** Valor que só muda depois de ficar parado `ms` (passar pela lista ou digitar não dispara buscas). */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

const RELEASES_SETTLE_MS = 400;

function ReleaseList({ port, settled }: { port: StorePort; settled: boolean }) {
  const query = useStoreReleases(port.id, settled);
  const { data: settings } = useSettings();
  const navigate = useNavigate();
  const { data: releases, error, refetch, isFetching } = query;
  // Já em cache: aparece na hora; senão, esqueleto até a seleção parar e a busca terminar.
  const isLoading = !releases && !error && (query.isLoading || !settled);
  // "Mais recente" = a primeira versão estável (o GitHub lista da mais nova para a mais antiga).
  const latestTag = releases?.find((r) => !r.prerelease)?.tag;
  const installed = useStoreInstalls().data?.installs.find((i) => i.portId === port.id) ?? null;
  const installing = !!useInstallProgress()[port.id];
  const { data: running = [] } = useRunningGames();
  const { install, rollback } = usePortInstaller(port);
  const [guard, aiModal] = useAiGuard(port);
  const locked = installing || install.isPending || rollback.isPending || (installed?.gameId != null && running.includes(installed.gameId));

  /** Ação de cada versão: instalada / voltar para ela (guardada no disco) / instalar esta. */
  const actionFor = (r: StoreRelease) => {
    if (!r.windowsAsset) return null;
    const isActive = installed?.tag === r.tag && (!r.windowsAsset.sha256 || r.windowsAsset.sha256 === installed.sha256);
    if (isActive) return <span className="store-pill store-pill--installed">Instalada</span>;
    if (installed?.previous?.tag === r.tag) {
      return (
        <Button size="sm" variant="secondary" disabled={locked} onClick={() => rollback.mutate(port.id)}>
          Usar esta (já baixada)
        </Button>
      );
    }
    return (
      <Button size="sm" variant="ghost" disabled={locked} onClick={() => guard(() => install.mutate({ portId: port.id, tag: r.tag }))}>
        Instalar esta versão
      </Button>
    );
  };

  return (
    <section className="panel" aria-labelledby="store-releases-heading" aria-busy={isLoading}>
      <header className="panel__header">
        <h2 id="store-releases-heading" className="panel__title">
          Versões
        </h2>
        <span className="muted store-releases__source">github.com/{port.source.repo}</span>
      </header>
      {isLoading ? (
        <LoadingBlock label="Buscando versões…">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="store-release__skeleton" />
          ))}
        </LoadingBlock>
      ) : error ? (
        <ErrorState
          compact
          title="Não foi possível buscar as versões"
          message={errorMessage(error)}
          onRetry={() => void refetch()}
          retrying={isFetching}
          action={
            // Limite sem conta estourado: o atalho leva direto para vincular a conta.
            isApiError(error, 'RATE_LIMITED') && !settings?.githubLogin ? (
              <Button variant="primary" onClick={() => navigate('/settings?secao=github')}>
                Conectar conta do GitHub
              </Button>
            ) : undefined
          }
        />
      ) : !releases?.length ? (
        <p className="muted panel__empty">Este projeto ainda não publicou versões.</p>
      ) : (
        <ul className="store-releases">
          {releases.map((r) => (
            <ReleaseRow key={r.tag} release={r} latest={r.tag === latestTag} action={actionFor(r)} />
          ))}
        </ul>
      )}
      {aiModal}
    </section>
  );
}

function ReleaseRow({ release: r, latest, action }: { release: StoreRelease; latest: boolean; action: ReactNode }) {
  return (
    <li className="store-release">
      <div className="store-release__main">
        <span className="store-release__name">{r.name}</span>
        {r.name !== r.tag && <span className="store-release__tag">{r.tag}</span>}
        {latest && <span className="store-pill store-pill--latest">Mais recente</span>}
        {r.prerelease && <span className="store-pill">Prévia</span>}
        {action && <span className="store-release__action">{action}</span>}
      </div>
      <div className="store-release__meta">
        {r.publishedAt && <span>{formatDate(r.publishedAt)}</span>}
        {r.windowsAsset ? (
          <span>
            {r.windowsAsset.name} · {formatBytes(r.windowsAsset.size)}
          </span>
        ) : (
          <span className="store-release__missing">Sem arquivo para Windows nesta versão</span>
        )}
      </div>
      {r.notes.trim() && (
        <details className="store-release__notes">
          <summary>Notas da versão</summary>
          <pre>{r.notes}</pre>
        </details>
      )}
    </li>
  );
}
