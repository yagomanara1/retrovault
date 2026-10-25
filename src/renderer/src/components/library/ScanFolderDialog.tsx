import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { consoleName } from '@shared/consoles';
import type { BatchAddItem, BatchAddProgress, BatchAddResult, ScanCandidate, ScanProgress, ScanResult } from '@shared/types';
import { qk } from '@/hooks/queries';
import { call, errorMessage, onEvent } from '@/lib/api';
import { cx } from '@/lib/cx';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { ProgressBar } from '../ui/ProgressBar';
import { Spinner } from '../ui/Spinner';
import { useToast } from '../ui/Toast';
import { FolderIcon, StoreIcon } from '../ui/icons';

/** Linhas renderizadas por vez: pastas de ROMs podem ter milhares de itens. */
const PAGE_SIZE = 200;

type Phase =
  | { step: 'idle' }
  | { step: 'scanning'; progress: ScanProgress | null }
  | { step: 'review'; result: ScanResult }
  | { step: 'adding'; progress: BatchAddProgress | null }
  | { step: 'done'; result: BatchAddResult };

/** Escolha do usuário para um candidato, indexada pelo caminho original do candidato. */
interface Choice {
  selected: boolean;
  title: string;
  /** Executável escolhido (pode ser uma das alternativas). */
  path: string;
}

interface ScanFolderDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * "Adicionar pasta": escolher → varrer (com progresso e cancelamento) → revisar → adicionar → resumo.
 * Fechar durante a varredura cancela; durante a adição o diálogo não fecha (a adição continua no main).
 */
export function ScanFolderDialog({ open, onClose }: ScanFolderDialogProps) {
  const [phase, setPhase] = useState<Phase>({ step: 'idle' });
  const toast = useToast();
  const qc = useQueryClient();

  // Progresso chega por eventos do main; só interessa na fase correspondente.
  useEffect(() => {
    if (phase.step === 'scanning') return onEvent('library:scan-progress', (progress) => setPhase({ step: 'scanning', progress }));
    if (phase.step === 'adding') return onEvent('library:add-progress', (progress) => setPhase({ step: 'adding', progress }));
    return undefined;
  }, [phase.step]);

  function close() {
    if (phase.step === 'adding') return;
    if (phase.step === 'scanning') void call('library:scan-cancel');
    setPhase({ step: 'idle' });
    onClose();
  }

  async function scan() {
    setPhase({ step: 'scanning', progress: null });
    try {
      const result = await call('library:scan');
      setPhase(result ? { step: 'review', result } : { step: 'idle' });
    } catch (err) {
      setPhase({ step: 'idle' });
      toast.push({ tone: 'error', title: 'Falha ao varrer a pasta', description: errorMessage(err) });
    }
  }

  async function scanStores() {
    setPhase({ step: 'scanning', progress: { dirsVisited: 0, found: 0, currentDir: 'Steam, Epic Games, GOG, Ubisoft Connect, Amazon Games, itch.io' } });
    try {
      setPhase({ step: 'review', result: await call('library:scan-stores') });
    } catch (err) {
      setPhase({ step: 'idle' });
      toast.push({ tone: 'error', title: 'Falha ao ler as lojas', description: errorMessage(err) });
    }
  }

  async function add(items: BatchAddItem[]) {
    setPhase({ step: 'adding', progress: { done: 0, total: items.length, current: null } });
    try {
      const result = await call('games:add-many', { items });
      setPhase({ step: 'done', result });
    } catch (err) {
      setPhase({ step: 'done', result: { added: 0, failed: [{ title: 'Importação', message: errorMessage(err) }] } });
    } finally {
      void qc.invalidateQueries({ queryKey: qk.games });
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Adicionar pasta"
      description="O RetroVault procura jogos de PC, ports e ROMs numa pasta ou nas lojas instaladas, e você escolhe o que adicionar."
      size="lg"
    >
      {phase.step === 'idle' && <IntroStep onScan={() => void scan()} onScanStores={() => void scanStores()} onCancel={close} />}
      {phase.step === 'scanning' && <ScanningStep progress={phase.progress} onCancel={close} />}
      {phase.step === 'review' && (
        <ReviewStep result={phase.result} onBack={() => setPhase({ step: 'idle' })} onAdd={(items) => void add(items)} />
      )}
      {phase.step === 'adding' && <AddingStep progress={phase.progress} />}
      {phase.step === 'done' && <DoneStep result={phase.result} onClose={close} />}
    </Modal>
  );
}

function IntroStep({ onScan, onScanStores, onCancel }: { onScan: () => void; onScanStores: () => void; onCancel: () => void }) {
  return (
    <div className="scan-intro">
      <ul className="scan-intro__list">
        <li>
          <strong>Jogos de PC e ports:</strong> o executável principal de cada pasta. Instaladores, auxiliares e emuladores ficam
          de fora.
        </li>
        <li>
          <strong>ROMs:</strong> pela extensão, ou pelo nome da pasta (<code>PS1</code>, <code>SNES</code>…) para .bin, .iso e
          .zip.
        </li>
        <li>Jogos de PS4 recebem troféus e arte do dump automaticamente.</li>
        <li>
          <strong>Lojas instaladas:</strong> os jogos que a Steam, Epic Games, GOG, Ubisoft Connect, Amazon Games e itch.io instalaram
          neste PC, lidos só dos registros locais delas (sem login). Jogos da Steam continuam abrindo pela Steam.
        </li>
      </ul>
      <div className="form__actions">
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button icon={<StoreIcon size={16} />} onClick={onScanStores}>
          Importar das lojas instaladas
        </Button>
        <Button variant="primary" icon={<FolderIcon size={16} />} onClick={onScan}>
          Escolher pasta…
        </Button>
      </div>
    </div>
  );
}

function ScanningStep({ progress, onCancel }: { progress: ScanProgress | null; onCancel: () => void }) {
  return (
    <div className="scan-status" role="status" aria-live="polite">
      <Spinner size="lg" />
      <p>
        <strong>Procurando jogos…</strong>
        <br />
        <span className="muted">
          {progress ? `${progress.dirsVisited} pastas · ${progress.found} jogos encontrados` : 'Escolha a pasta na janela que abriu.'}
        </span>
      </p>
      {progress?.currentDir && (
        <span className="scan-status__dir muted" title={progress.currentDir}>
          {progress.currentDir}
        </span>
      )}
      <Button variant="ghost" onClick={onCancel}>
        Cancelar
      </Button>
    </div>
  );
}

function AddingStep({ progress: p }: { progress: BatchAddProgress | null }) {
  return (
    <div className="scan-status" role="status" aria-live="polite">
      <p>
        <strong>Adicionando jogos…</strong>
        <br />
        <span className="muted">{p ? `${p.done} de ${p.total}${p.current ? ` · ${p.current}` : ''}` : 'Preparando…'}</span>
      </p>
      <ProgressBar value={p?.done ?? 0} max={p?.total || 1} label="Progresso da importação" valueText={p ? `${p.done} de ${p.total}` : undefined} />
      <span className="muted">ROMs são identificadas no RetroAchievements; pode levar alguns segundos por jogo.</span>
    </div>
  );
}

function ReviewStep({ result, onBack, onAdd }: { result: ScanResult; onBack: () => void; onAdd: (items: BatchAddItem[]) => void }) {
  const byPath = useMemo(() => new Map(result.candidates.map((c) => [c.path, c])), [result.candidates]);
  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(
      result.candidates.map((c) => [c.path, { selected: c.recommended && !c.inLibrary, title: c.title, path: c.path }]),
    ),
  );
  const [visible, setVisible] = useState(PAGE_SIZE);

  const fromStores = result.source === 'stores';
  const groups = useMemo(
    () =>
      fromStores
        ? // Lojas: um grupo por loja (a loja vem na observação de cada jogo).
          [...new Set(result.candidates.map((c) => c.note ?? 'Outras'))].sort().map((store) => ({ label: store, items: result.candidates.filter((c) => (c.note ?? 'Outras') === store) }))
        : [
            { label: 'Jogos de PC e ports', items: result.candidates.filter((c) => c.kind === 'executable') },
            { label: 'ROMs', items: result.candidates.filter((c) => c.kind === 'retroarch') },
          ].filter((g) => g.items.length > 0),
    [result.candidates, fromStores],
  );
  const addable = result.candidates.filter((c) => !c.inLibrary);
  const selected = addable.filter((c) => choices[c.path]?.selected);

  // Estável: as linhas são memo e não devem re-renderizar quando outra linha muda.
  const update = useCallback(
    (key: string, patch: Partial<Choice>) => setChoices((prev) => ({ ...prev, [key]: { ...prev[key]!, ...patch } })),
    [],
  );
  const selectAll = (value: boolean) =>
    setChoices((prev) => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, { ...v, selected: value && !byPath.get(k)!.inLibrary }])));

  function submit() {
    onAdd(
      selected.map((c) => {
        const choice = choices[c.path]!;
        return { kind: c.kind, path: choice.path, title: choice.title.trim() || c.title, consoleId: c.consoleId, steamAppId: c.steamAppId ?? null };
      }),
    );
  }

  if (result.candidates.length === 0 && fromStores) {
    return (
      <div className="scan-done">
        <p>
          <strong>Nenhum jogo encontrado nas lojas instaladas.</strong>
        </p>
        <p className="muted">
          O RetroVault procura os jogos instalados pela Steam, Epic Games, GOG, Ubisoft Connect, Amazon Games e itch.io. Jogos da Xbox / Microsoft
          Store não abrem por um .exe comum e ficam de fora.
        </p>
        <div className="form__actions">
          <Button variant="primary" onClick={onBack}>
            Voltar
          </Button>
        </div>
      </div>
    );
  }

  if (result.candidates.length === 0) {
    return (
      <div className="scan-done">
        <p>
          <strong>Nenhum jogo encontrado</strong> em <code>{result.root}</code>.
        </p>
        <p className="muted">
          Foram verificadas {result.dirsVisited} pastas. ROMs com extensão genérica (.bin, .iso, .zip) precisam estar numa pasta
          com o nome do console (ex.: <code>PS1</code>).
        </p>
        <div className="form__actions">
          <Button variant="primary" onClick={onBack}>
            Escolher outra pasta
          </Button>
        </div>
      </div>
    );
  }

  let rendered = 0;
  return (
    <div className="scan-review">
      <div className="scan-review__toolbar">
        <span className="muted">
          {fromStores
            ? `${result.candidates.length} jogos nas lojas instaladas. Alguns pedem a loja aberta para iniciar (proteção da própria loja).`
            : `${result.candidates.length} encontrados em ${result.dirsVisited} pastas`}
          {result.truncated && ' (a busca parou num limite; escolha uma subpasta para ver o resto)'}
        </span>
        <div className="scan-review__bulk">
          <Button size="sm" variant="ghost" onClick={() => selectAll(true)}>
            Marcar todos
          </Button>
          <Button size="sm" variant="ghost" onClick={() => selectAll(false)}>
            Desmarcar todos
          </Button>
        </div>
      </div>

      <div className="scan-review__list">
        {groups.map((group) => {
          const slice = group.items.slice(0, Math.max(0, visible - rendered));
          rendered += slice.length;
          if (slice.length === 0) return null;
          return (
            <section key={group.label} aria-label={group.label}>
              <h3 className="section-title">
                {group.label} ({group.items.length})
              </h3>
              <ul className="scan-list">
                {slice.map((c) => (
                  <CandidateRow key={c.path} candidate={c} choice={choices[c.path]!} onChange={update} />
                ))}
              </ul>
            </section>
          );
        })}
        {visible < result.candidates.length && (
          <Button variant="ghost" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
            Mostrar mais {Math.min(PAGE_SIZE, result.candidates.length - visible)}
          </Button>
        )}
      </div>

      <div className="form__actions form__actions--split">
        <Button variant="ghost" onClick={onBack}>
          {fromStores ? 'Voltar' : 'Outra pasta'}
        </Button>
        <Button variant="primary" disabled={selected.length === 0} onClick={submit}>
          {selected.length === 0 ? 'Nenhum selecionado' : `Adicionar ${selected.length} jogo(s)`}
        </Button>
      </div>
    </div>
  );
}

const CandidateRow = memo(function CandidateRow({
  candidate: c,
  choice,
  onChange,
}: {
  candidate: ScanCandidate;
  choice: Choice;
  onChange: (key: string, patch: Partial<Choice>) => void;
}) {
  const options = [c.path, ...c.alternatives];
  const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

  return (
    <li className={cx('scan-item', c.inLibrary && 'scan-item--disabled')}>
      <input
        type="checkbox"
        className="scan-item__check"
        checked={choice.selected}
        disabled={c.inLibrary}
        onChange={(e) => onChange(c.path, { selected: e.target.checked })}
        aria-label={`Adicionar ${choice.title}`}
      />
      <div className="scan-item__body">
        <input
          className="input input--sm scan-item__title"
          value={choice.title}
          disabled={c.inLibrary}
          maxLength={200}
          onChange={(e) => onChange(c.path, { title: e.target.value })}
          aria-label={`Nome de ${c.title} na biblioteca`}
        />
        <span className="scan-item__path muted" title={choice.path}>
          {choice.path}
        </span>
        {c.note && <span className="scan-item__note">{c.note}</span>}
      </div>
      <div className="scan-item__side">
        {c.inLibrary ? (
          <span className="tag">Já na biblioteca</span>
        ) : c.kind === 'retroarch' ? (
          <span className={cx('tag', c.consoleId == null && 'tag--warn')}>{c.consoleId == null ? 'Console a definir' : consoleName(c.consoleId)}</span>
        ) : options.length > 1 ? (
          <select
            className="input input--sm"
            value={choice.path}
            onChange={(e) => onChange(c.path, { path: e.target.value })}
            aria-label={`Executável de ${choice.title}`}
          >
            {options.map((p) => (
              <option key={p} value={p}>
                {fileName(p)}
              </option>
            ))}
          </select>
        ) : (
          <span className="tag">PC</span>
        )}
      </div>
    </li>
  );
});

function DoneStep({ result, onClose }: { result: BatchAddResult; onClose: () => void }) {
  return (
    <div className="scan-done">
      <p>
        <strong>{result.added} jogo(s) adicionado(s).</strong>{' '}
        {result.added > 0 && <span className="muted">Troféus e arte de jogos de PS4 chegam em segundo plano.</span>}
      </p>
      {result.failed.length > 0 && (
        <>
          <p className="form__error" role="alert">
            {result.failed.length} não puderam ser adicionados:
          </p>
          <ul className="scan-done__failed">
            {result.failed.map((f, i) => (
              <li key={`${f.title}-${i}`}>
                <strong>{f.title}</strong>: {f.message}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="form__actions">
        <Button variant="primary" onClick={onClose}>
          Concluir
        </Button>
      </div>
    </div>
  );
}
