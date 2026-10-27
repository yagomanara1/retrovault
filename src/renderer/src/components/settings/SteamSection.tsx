import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SteamShortcutsOverview, SteamShortcutsResult } from '@shared/types';
import { useSteamShortcuts } from '@/hooks/queries';
import { call, errorMessage } from '@/lib/api';
import { Button } from '../ui/Button';
import { SelectField, Switch } from '../ui/Form';
import { LoadingBlock, Skeleton } from '../ui/States';
import { useToast } from '../ui/Toast';
import { AlertIcon, CheckIcon, RefreshIcon } from '../ui/icons';
import { SettingsPanel } from './SettingsPanel';

/** Resumo para a lista de seções das Configurações. */
export function steamSummary(overview: SteamShortcutsOverview | undefined): string {
  if (!overview) return 'Verificando…';
  if (!overview.steamFound) return 'Steam não encontrada';
  const inSteam = overview.games.filter((g) => g.inSteam).length + (overview.launcherInSteam ? 1 : 0);
  return inSteam ? `${inSteam} atalho(s) do RetroVault na Steam` : 'Nenhum jogo do RetroVault na Steam';
}

/**
 * Jogos do RetroVault como "jogo não-Steam": aparecem na biblioteca e no Big Picture, com Steam Input.
 * A lista marcada é o que fica na Steam; atalhos que o usuário criou à mão nunca são alterados.
 */
export function SteamSection() {
  const [accountId, setAccountId] = useState<string | null>(null);
  const { data: overview, isLoading, isFetching, refetch } = useSteamShortcuts(accountId);
  const reload = useCallback(() => void refetch(), [refetch]);

  if (isLoading || !overview) {
    return (
      <LoadingBlock label="Procurando a Steam…">
        <Skeleton className="skeleton--hero" />
      </LoadingBlock>
    );
  }

  return (
    <SettingsPanel
      id="steam"
      title="Steam"
      actions={
        <Button variant="ghost" size="sm" icon={<RefreshIcon size={14} />} loading={isFetching} onClick={() => void refetch()}>
          Verificar de novo
        </Button>
      }
    >
      <p className="muted">
        Leve jogos do RetroVault para a Steam como "jogo não-Steam": eles aparecem na biblioteca e no Big Picture, com o Steam Input
        (qualquer controle) e o overlay. Cada atalho abre o jogo direto (o executável, o RetroArch ou o emulador escolhido). Jogos da
        própria Steam e atalhos que você criou à mão ficam como estão.
      </p>

      {!overview.steamFound ? (
        <ul className="status-list">
          <li className="status-line status-line--warn">
            <AlertIcon size={16} />
            <span>A Steam não foi encontrada neste PC.</span>
          </li>
        </ul>
      ) : overview.accounts.length === 0 || !overview.accountId ? (
        <p className="muted">Nenhuma conta da Steam neste PC ainda. Entre na Steam uma vez e volte aqui.</p>
      ) : (
        // Trocar de conta (ou recarregar) recomeça a seleção a partir do que está na Steam.
        <ShortcutEditor key={overview.accountId} overview={overview} onAccountChange={setAccountId} onReload={reload} />
      )}
    </SettingsPanel>
  );
}

function ShortcutEditor({
  overview,
  onAccountChange,
  onReload,
}: {
  overview: SteamShortcutsOverview;
  onAccountChange: (id: string) => void;
  onReload: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const eligible = useMemo(() => overview.games.filter((g) => !g.blocked), [overview.games]);
  const firstTime = !overview.games.some((g) => g.inSteam) && !overview.launcherInSteam;
  // Primeira vez: tudo marcado (fácil desmarcar); depois, exatamente o que já está na Steam.
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set((firstTime ? eligible : eligible.filter((g) => g.inSteam)).map((g) => g.gameId)),
  );
  const [includeLauncher, setIncludeLauncher] = useState(overview.launcherAvailable && (firstTime || overview.launcherInSteam));
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Desde quando esperamos a Steam fechar (null = não esperando). */
  const [closingSince, setClosingSince] = useState<number | null>(null);
  const [result, setResult] = useState<SteamShortcutsResult | null>(null);

  // Esperando a Steam fechar: confere a cada 2 s, por até 30 s.
  useEffect(() => {
    if (closingSince === null) return;
    if (!overview.steamRunning || Date.now() - closingSince > 30_000) {
      setClosingSince(null);
      return;
    }
    const timer = setTimeout(onReload, 2000);
    return () => clearTimeout(timer);
  }, [closingSince, overview, onReload]);

  const toAdd = eligible.filter((g) => selected.has(g.gameId) && !g.inSteam).length + (includeLauncher && !overview.launcherInSteam ? 1 : 0);
  const toRemove = eligible.filter((g) => !selected.has(g.gameId) && g.inSteam).length + (!includeLauncher && overview.launcherInSteam ? 1 : 0);
  const toKeep = eligible.filter((g) => selected.has(g.gameId) && g.inSteam).length + (includeLauncher && overview.launcherInSteam ? 1 : 0);
  const nothingToDo = toAdd === 0 && toRemove === 0 && toKeep === 0;
  // Mudou a seleção: a confirmação vale para a lista nova.
  useEffect(() => setConfirming(false), [selected, includeLauncher]);

  const toggle = (gameId: number, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(gameId);
      else next.delete(gameId);
      return next;
    });

  async function save() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setSaving(true);
    try {
      const res = await call('steam:shortcuts-apply', { accountId: overview.accountId!, gameIds: [...selected], includeLauncher });
      setResult(res);
      toast.push({
        tone: 'success',
        title: 'Atalhos salvos na Steam',
        description: `${res.added} novo(s), ${res.updated} atualizado(s), ${res.removed} removido(s). Abra a Steam para ver.`,
      });
      void qc.invalidateQueries({ queryKey: ['steam'] });
    } catch (err) {
      toast.push({ tone: 'error', title: 'Não foi possível salvar na Steam', description: errorMessage(err) });
      onReload();
    } finally {
      setSaving(false);
    }
  }

  async function closeSteam() {
    try {
      await call('steam:exit');
      setClosingSince(Date.now());
    } catch (err) {
      toast.push({ tone: 'error', title: 'Não foi possível fechar a Steam', description: errorMessage(err) });
    }
  }

  return (
    <>
      {overview.accounts.length > 1 && (
        <SelectField
          label="Conta da Steam"
          value={overview.accountId!}
          options={overview.accounts.map((a) => ({ value: a.id, label: a.mostRecent ? `${a.name} (usada por último)` : a.name }))}
          onChange={onAccountChange}
          hint="Os atalhos não-Steam são de cada conta."
        />
      )}

      <ul className="status-list">
        {overview.steamRunning ? (
          <li className="status-line status-line--warn">
            <AlertIcon size={16} />
            <span>
              A Steam está aberta. Ela precisa estar fechada para salvar: aberta, ela desfaz a mudança quando sai.{' '}
              <Button size="sm" loading={closingSince !== null} onClick={() => void closeSteam()}>
                Fechar a Steam
              </Button>
            </span>
          </li>
        ) : (
          <li className="status-line status-line--ok">
            <CheckIcon size={16} />
            <span>Steam fechada: pronto para salvar.</span>
          </li>
        )}
        {overview.otherShortcuts > 0 && (
          <li className="status-line status-line--ok">
            <CheckIcon size={16} />
            <span>{overview.otherShortcuts} atalho(s) não-Steam criados por você: ficam como estão.</span>
          </li>
        )}
      </ul>

      {overview.launcherAvailable && (
        <Switch
          label="Adicionar o próprio RetroVault"
          description="Abre o RetroVault pela Steam (útil no Big Picture)."
          checked={includeLauncher}
          onChange={setIncludeLauncher}
        />
      )}

      <div className="steam-shortcuts__toolbar">
        <h3 className="emulators__subtitle">Jogos na Steam</h3>
        <div className="scan-review__bulk">
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(eligible.map((g) => g.gameId)))}>
            Marcar todos
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Desmarcar todos
          </Button>
        </div>
      </div>
      {overview.games.length === 0 ? (
        <p className="muted">A biblioteca está vazia.</p>
      ) : (
        <ul className="steam-shortcuts__list">
          {overview.games.map((g) => (
            <li key={g.gameId} className="steam-shortcuts__item">
              <label className="steam-shortcuts__label">
                <input
                  type="checkbox"
                  checked={!g.blocked && selected.has(g.gameId)}
                  disabled={!!g.blocked}
                  onChange={(e) => toggle(g.gameId, e.target.checked)}
                />
                <span className="steam-shortcuts__title">{g.title}</span>
              </label>
              <span className="steam-shortcuts__state muted">{g.blocked ?? (g.inSteam ? 'Na Steam' : '')}</span>
            </li>
          ))}
        </ul>
      )}

      {result && result.skipped.length > 0 && (
        <div className="steam-shortcuts__skipped" role="status">
          <strong>Não enviados:</strong>
          <ul>
            {result.skipped.map((s) => (
              <li key={s.title}>
                {s.title}: <span className="muted">{s.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="form__actions form__actions--split">
        <span className="muted">
          {confirming
            ? `Adicionar ${toAdd}, manter/atualizar ${toKeep}, remover ${toRemove}. Uma cópia do arquivo atual é guardada antes. Clique de novo para confirmar.`
            : 'Ao salvar, a lista marcada é o que fica na Steam.'}
        </span>
        <Button
          variant="primary"
          loading={saving}
          disabled={overview.steamRunning || nothingToDo}
          onClick={() => void save()}
        >
          {confirming ? 'Confirmar' : 'Salvar na Steam'}
        </Button>
      </div>
    </>
  );
}
