import { consoleName } from '@shared/consoles';
import { emulatorsForConsole, getEmulator, type EmulatorChoice, type EmulatorsOverview } from '@shared/emulators';
import { useEmulatorActions, useEmulators } from '@/hooks/queries';
import { call, errorMessage } from '@/lib/api';
import { Button } from '../ui/Button';
import { SelectField, Switch } from '../ui/Form';
import { LoadingBlock, Skeleton } from '../ui/States';
import { useToast } from '../ui/Toast';
import { CheckIcon, FolderIcon, LinkIcon, RefreshIcon } from '../ui/icons';

const AUTO = 'auto';

/** Nome de quem abre o console (para a lista das Configurações e a página do jogo). */
export function emulatorLabel(choice: EmulatorChoice): string {
  return choice === 'retroarch' ? 'RetroArch' : (getEmulator(choice)?.name ?? choice);
}

/** Resumo para a lista de seções das Configurações. */
export function emulatorsSummary(overview: EmulatorsOverview | undefined): string {
  if (!overview) return 'Verificando…';
  const own = overview.consoles.filter((c) => c.effective !== 'retroarch').length;
  const installed = overview.emulators.filter((e) => e.path).length;
  return own ? `${own} ${own === 1 ? 'console abre' : 'consoles abrem'} fora do RetroArch` : `Tudo pelo RetroArch · ${installed} emulador(es) encontrado(s)`;
}

/**
 * Qual programa abre as ROMs de cada console: o RetroArch (padrão) ou um emulador próprio
 * (PCSX2, Dolphin…). Os emuladores são achados nas pastas de instalação ou indicados à mão.
 */
export function EmulatorsSection() {
  const { data: overview, isLoading } = useEmulators();
  const actions = useEmulatorActions();
  const toast = useToast();
  const fail = (title: string) => (err: unknown) => toast.push({ tone: 'error', title, description: errorMessage(err) });

  if (isLoading || !overview) {
    return (
      <LoadingBlock label="Procurando emuladores…">
        <Skeleton className="skeleton--hero" />
      </LoadingBlock>
    );
  }

  return (
    <section className="panel" aria-labelledby="emulators-heading">
      <header className="panel__header">
        <h2 id="emulators-heading" className="panel__title">
          Emuladores
        </h2>
        <Button variant="ghost" size="sm" icon={<RefreshIcon size={14} />} loading={actions.refresh.isPending} onClick={() => actions.refresh.mutate()}>
          Procurar de novo
        </Button>
      </header>
      <p className="muted">
        Por padrão, as ROMs abrem no RetroArch. Aqui você escolhe um emulador próprio para cada console, como o PCSX2 para PS2 ou o Dolphin
        para GameCube e Wii. No automático, o RetroVault só troca de programa quando o RetroArch não tem core para o console e o emulador
        próprio está instalado.
      </p>

      <Switch
        label="Abrir os emuladores em tela cheia"
        description="Vale para os emuladores próprios; o RetroArch segue a configuração dele."
        checked={overview.fullscreen}
        onChange={(fullscreen) => actions.setFullscreen.mutate(fullscreen, { onError: fail('Não foi possível salvar') })}
      />

      <h3 className="emulators__subtitle">Quem abre cada console</h3>
      <ul className="emulators__consoles">
        {overview.consoles.map((c) => {
          const options = [
            { value: AUTO, label: 'Automático' },
            { value: 'retroarch', label: c.retroArchCore ? 'RetroArch' : 'RetroArch (sem core instalado)' },
            ...emulatorsForConsole(c.consoleId).map((e) => {
              const installed = overview.emulators.find((s) => s.id === e.id)?.path;
              return { value: e.id, label: installed ? e.name : `${e.name} (não encontrado)` };
            }),
          ];
          return (
            <li key={c.consoleId} className="emulators__console">
              <SelectField
                label={consoleName(c.consoleId)}
                value={c.choice ?? AUTO}
                options={options}
                onChange={(value) =>
                  actions.setConsole.mutate({ consoleId: c.consoleId, choice: value === AUTO ? null : value }, { onError: fail('Não foi possível trocar') })
                }
                hint={
                  c.effective === 'retroarch' && !c.retroArchCore
                    ? `Sem core no RetroArch: instale um core (Online Updater) ou o ${emulatorsForConsole(c.consoleId)[0]?.name ?? 'emulador'}.`
                    : `Abre no ${emulatorLabel(c.effective)}${!c.choice ? ' (automático)' : ''}`
                }
              />
            </li>
          );
        })}
      </ul>

      <h3 className="emulators__subtitle">Emuladores</h3>
      <ul className="emulators__list">
        {overview.emulators.map((e) => (
          <li key={e.id} className="emulators__item">
            <div className="emulators__info">
              <div className="emulators__name">
                <strong>{e.name}</strong>
                <span className="muted"> · {e.consoles.map((id) => consoleName(id)).join(', ')}</span>
              </div>
              <div className="emulators__path" title={e.path ?? undefined}>
                {e.path ? (
                  <>
                    <CheckIcon size={13} /> {e.path}
                    {e.configuredPath ? '' : ' (encontrado sozinho)'}
                  </>
                ) : e.configuredPath ? (
                  `O arquivo indicado não existe mais: ${e.configuredPath}`
                ) : (
                  'Não encontrado nas pastas de instalação.'
                )}
              </div>
              <div className="emulators__note muted">
                {e.retroAchievements
                  ? 'Conquistas: entre na sua conta do RetroAchievements nas configurações do próprio emulador.'
                  : 'Sem RetroAchievements neste emulador: para conquistas, use o RetroArch.'}
              </div>
            </div>
            <div className="emulators__actions">
              <Button size="sm" icon={<FolderIcon size={14} />} loading={actions.pickPath.isPending && actions.pickPath.variables === e.id} onClick={() => actions.pickPath.mutate(e.id, { onError: fail('Executável recusado') })}>
                Procurar…
              </Button>
              {e.configuredPath && (
                <Button size="sm" variant="ghost" onClick={() => actions.clearPath.mutate(e.id)}>
                  Usar o encontrado
                </Button>
              )}
              <Button size="sm" variant="ghost" icon={<LinkIcon size={14} />} onClick={() => void call('app:open-external', e.site)}>
                Site
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
