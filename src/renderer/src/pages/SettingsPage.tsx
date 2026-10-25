import { useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Cascade, type CascadeItem } from '@/components/ui/Cascade';
import type { Settings } from '@shared/types';
import { useQueryClient } from '@tanstack/react-query';
import { qk, useAppUpdate, useEmulators, useRetroArchStatus, useSettings, useSteamShortcuts, useUpdateSettings } from '@/hooks/queries';
import { EmulatorsSection, emulatorsSummary } from '@/components/settings/EmulatorsSection';
import { SteamSection, steamSummary } from '@/components/settings/SteamSection';
import { AppUpdateSection, appUpdateSummary } from '@/components/settings/AppUpdateSection';
import { call, errorMessage } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { BackupSection } from '@/components/settings/BackupSection';
import { CloudProviders } from '@/components/settings/CloudProviders';
import { GitHubSection } from '@/components/settings/GitHubSection';
import { StoreSection } from '@/components/settings/StoreSection';
import { Button } from '@/components/ui/Button';
import { SegmentedControl, Switch, TextField } from '@/components/ui/Form';
import { useMotionPreference } from '@/hooks/useMotionPreference';
import { LoadingBlock, Skeleton } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { AlertIcon, CheckIcon, DownloadIcon, FolderIcon, GamepadIcon, GearIcon, LibraryIcon, LinkIcon, ImageIcon, PlayIcon, RefreshIcon, StoreIcon, TrophyIcon } from '@/components/ui/icons';

const RA_SETTINGS_URL = 'https://retroachievements.org/settings';

type SectionId = 'conta' | 'github' | 'loja' | 'retroarch' | 'emuladores' | 'steam' | 'trofeus' | 'preferencias' | 'saves' | 'backup' | 'atualizacoes';
const SECTION_IDS: readonly SectionId[] = ['conta', 'github', 'loja', 'retroarch', 'emuladores', 'steam', 'trofeus', 'preferencias', 'saves', 'backup', 'atualizacoes'];

/** Configurações em cascata (como no PS5): seções à esquerda, a escolhida à direita. A seção fica na URL. */
export function SettingsPage() {
  const { data: settings } = useSettings();
  const { data: retroarch } = useRetroArchStatus();
  const { data: appUpdate } = useAppUpdate();
  const { data: emulators } = useEmulators();
  const { data: steam } = useSteamShortcuts(null);
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get('secao') as SectionId | null;
  const section: SectionId = fromUrl && SECTION_IDS.includes(fromUrl) ? fromUrl : 'conta';

  if (!settings) {
    return (
      <LoadingBlock label="Carregando configurações…">
        <Skeleton className="skeleton--hero" />
      </LoadingBlock>
    );
  }

  const items: CascadeItem<SectionId>[] = [
    {
      id: 'conta',
      label: 'Conta do RetroAchievements',
      description: settings.raUsername && settings.hasApiKey ? `Conectado como ${settings.raUsername}` : 'Não conectado',
      icon: <LinkIcon size={20} />,
    },
    {
      id: 'github',
      label: 'Conta do GitHub',
      description: settings.githubLogin ? `Conectado como ${settings.githubLogin} · Loja com 5.000 consultas/h` : 'Não conectado · Loja com 60 consultas/h',
      icon: <StoreIcon size={20} />,
    },
    {
      id: 'loja',
      label: 'Loja de ports',
      description: `${settings.storeCatalogUrl ? 'Catálogo online' : 'Catálogo embutido'} · capas ${settings.hasSgdbKey ? 'do SteamGridDB' : 'dos projetos'}`,
      icon: <ImageIcon size={20} />,
    },
    {
      id: 'retroarch',
      label: 'RetroArch',
      description: retroarch ? (retroarch.found ? `${retroarch.cores.length} cores instalados` : 'Não encontrado') : 'Verificando…',
      icon: <PlayIcon size={18} />,
    },
    {
      id: 'emuladores',
      label: 'Emuladores',
      description: emulatorsSummary(emulators),
      icon: <GamepadIcon size={20} />,
    },
    {
      id: 'steam',
      label: 'Steam',
      description: steamSummary(steam),
      icon: <LibraryIcon size={20} />,
    },
    {
      id: 'trofeus',
      label: 'Troféus de PS4',
      description: settings.hasTrophyKey ? 'Trophy key salva' : 'Sem trophy key',
      icon: <TrophyIcon size={20} />,
    },
    {
      id: 'preferencias',
      label: 'Preferências',
      description: `Hardcore ${settings.hardcoreMode ? 'ligado' : 'desligado'} · notificações ${settings.notifyAchievements ? 'ligadas' : 'desligadas'}`,
      icon: <GearIcon size={20} />,
    },
    {
      id: 'saves',
      label: 'Cofre de saves',
      description: settings.autoBackupSaves ? 'Backup automático ligado' : 'Backup automático desligado',
      icon: <FolderIcon size={20} />,
    },
    {
      id: 'backup',
      label: 'Backup e progresso',
      description: 'Backups da biblioteca, exportar e importar',
      icon: <RefreshIcon size={20} />,
    },
    {
      id: 'atualizacoes',
      label: 'Atualizações do RetroVault',
      description: appUpdateSummary(appUpdate),
      icon: <DownloadIcon size={20} />,
    },
  ];

  return (
    <div className="page settings">
      <h1 className="page__title">Configurações</h1>
      <Cascade label="Seções das configurações" items={items} value={section} onChange={(id) => setParams({ secao: id }, { replace: true })}>
        {section === 'conta' && <RaAccountSection settings={settings} />}
        {section === 'github' && <GitHubSection />}
        {section === 'loja' && <StoreSection settings={settings} />}
        {section === 'retroarch' && <RetroArchSection settings={settings} />}
        {section === 'emuladores' && <EmulatorsSection />}
        {section === 'steam' && <SteamSection />}
        {section === 'trofeus' && <TrophyKeySection settings={settings} />}
        {section === 'preferencias' && <PreferencesSection settings={settings} />}
        {section === 'saves' && <SavesSection settings={settings} />}
        {section === 'backup' && <BackupSection />}
        {section === 'atualizacoes' && <AppUpdateSection />}
      </Cascade>
    </div>
  );
}

function RaAccountSection({ settings }: { settings: Settings }) {
  const [username, setUsername] = useState(settings.raUsername ?? '');
  const [apiKey, setApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateSettings();
  const toast = useToast();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!username.trim()) {
      setError('Informe seu usuário do RetroAchievements.');
      return;
    }
    if (!apiKey.trim() && !settings.hasApiKey) {
      setError('Informe sua Web API Key.');
      return;
    }
    try {
      const newKey = apiKey.trim();
      await update.mutateAsync(newKey ? { raUsername: username.trim(), raApiKey: newKey } : { raUsername: username.trim() });
      setApiKey('');
      setTesting(true);
      const profile = await call('ra:profile', { force: true });
      toast.push({
        tone: 'success',
        title: `Conectado como ${profile.username}`,
        description: `${formatNumber(profile.totalPoints)} pontos no RetroAchievements.`,
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setTesting(false);
    }
  }

  async function clearKey() {
    await update.mutateAsync({ raApiKey: '' });
    toast.push({ tone: 'info', title: 'API key removida' });
  }

  return (
    <section className="panel" aria-labelledby="ra-heading">
      <header className="panel__header">
        <h2 id="ra-heading" className="panel__title">
          Conta do RetroAchievements
        </h2>
      </header>
      <p className="muted">
        O RetroArch registra conquistas na sua conta do RetroAchievements. O launcher usa a Web API (somente leitura)
        para exibir seu progresso. Sua chave fica cifrada no sistema (DPAPI do Windows).
      </p>
      <form className="form" onSubmit={submit} noValidate>
        <div className="form__row">
          <TextField
            label="Usuário"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={64}
          />
          <TextField
            label="Web API Key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={settings.hasApiKey ? '•••••••• (salva)' : 'Cole sua chave aqui'}
            hint={
              <>
                Encontre em{' '}
                <a href={RA_SETTINGS_URL} target="_blank" rel="noreferrer">
                  retroachievements.org/settings
                </a>{' '}
                → “Keys”.
              </>
            }
          />
        </div>
        {error && (
          <p className="form__error" role="alert">
            {error}
          </p>
        )}
        <div className="form__actions form__actions--start">
          <Button type="submit" variant="primary" loading={update.isPending || testing}>
            Salvar e testar conexão
          </Button>
          {settings.hasApiKey && (
            <Button variant="ghost" onClick={() => void clearKey()}>
              Remover chave
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}

function StatusLine({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className={ok ? 'status-line status-line--ok' : 'status-line status-line--warn'}>
      {ok ? <CheckIcon size={16} /> : <AlertIcon size={16} />}
      <span>{children}</span>
    </li>
  );
}

function RetroArchSection({ settings }: { settings: Settings }) {
  const { data: status, isFetching, refetch } = useRetroArchStatus();
  const update = useUpdateSettings();
  const toast = useToast();

  async function browse() {
    try {
      const file = await call('dialog:open-file', { kind: 'retroarch' });
      if (file) await update.mutateAsync({ retroarchPath: file });
    } catch (err) {
      toast.push({ tone: 'error', title: 'Falha ao salvar caminho', description: errorMessage(err) });
    }
  }

  const accountMismatch =
    status?.loggedInAs && settings.raUsername && status.loggedInAs.toLowerCase() !== settings.raUsername.toLowerCase();

  return (
    <section className="panel" aria-labelledby="retroarch-heading">
      <header className="panel__header">
        <h2 id="retroarch-heading" className="panel__title">
          RetroArch
        </h2>
        <Button variant="ghost" size="sm" icon={<RefreshIcon />} loading={isFetching} onClick={() => void refetch()}>
          Verificar novamente
        </Button>
      </header>

      <div className="file-picker">
        <span className="file-picker__path" title={status?.exePath ?? undefined}>
          {status?.exePath ?? settings.retroarchPath ?? 'Detectando automaticamente…'}
        </span>
        <Button icon={<FolderIcon />} onClick={() => void browse()} loading={update.isPending}>
          Procurar…
        </Button>
        {settings.retroarchPath && (
          <Button variant="ghost" onClick={() => update.mutate({ retroarchPath: null })}>
            Detectar automaticamente
          </Button>
        )}
      </div>

      {status && (
        <ul className="status-list">
          <StatusLine ok={status.found}>
            {status.found ? 'RetroArch encontrado.' : 'RetroArch não encontrado. Instale-o (retroarch.com) ou indique o retroarch.exe.'}
          </StatusLine>
          {status.found && (
            <>
              <StatusLine ok={status.cores.length > 0}>
                {status.cores.length > 0
                  ? `${status.cores.length} cores instalados.`
                  : 'Nenhum core instalado. No RetroArch: Menu principal → Online Updater → Core Downloader.'}
              </StatusLine>
              <StatusLine ok={Boolean(status.loggedInAs)}>
                {status.loggedInAs
                  ? `Conquistas: RetroArch logado como ${status.loggedInAs}.`
                  : 'RetroArch não está logado no RetroAchievements. Abra o RetroArch → Configurações → Conquistas, ative-as e informe usuário e senha (só uma vez).'}
              </StatusLine>
              {accountMismatch && (
                <StatusLine ok={false}>
                  A conta logada no RetroArch ({status.loggedInAs}) é diferente da configurada aqui ({settings.raUsername}).
                  Os desbloqueios irão para a conta do RetroArch.
                </StatusLine>
              )}
            </>
          )}
        </ul>
      )}
    </section>
  );
}

const TROPHY_KEY_PATTERN = /^[0-9a-fA-F]{32}$/;

function TrophyKeySection({ settings }: { settings: Settings }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateSettings();
  const toast = useToast();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = key.trim();
    if (!TROPHY_KEY_PATTERN.test(value)) {
      setError('A trophy key tem 32 caracteres hexadecimais (0–9, A–F).');
      return;
    }
    setError(null);
    try {
      await update.mutateAsync({ trophyKey: value });
      setKey('');
      toast.push({ tone: 'success', title: 'Trophy key salva', description: 'Agora você pode importar troféus de jogos de PS4.' });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <section className="panel" aria-labelledby="trophy-key-heading">
      <header className="panel__header">
        <h2 id="trophy-key-heading" className="panel__title">
          Troféus de PS4
        </h2>
      </header>
      <p className="muted">
        Os nomes e descrições dos troféus no <code>trophy00.trp</code> são criptografados. Assim como no shadPS4, é
        preciso a trophy key (ReleaseTrophyKey) do seu próprio console. Ela fica cifrada pelo Windows e nunca é exibida.
      </p>
      <form className="form" onSubmit={submit} noValidate>
        <TextField
          label="Trophy key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(e) => setKey(e.target.value.replace(/\s/g, ''))}
          placeholder={settings.hasTrophyKey ? '•••••••• (salva)' : '32 caracteres hexadecimais'}
          maxLength={32}
          error={error}
        />
        <div className="form__actions form__actions--start">
          <Button type="submit" variant="primary" loading={update.isPending} disabled={!key}>
            Salvar chave
          </Button>
          {settings.hasTrophyKey && (
            <Button
              variant="ghost"
              onClick={() =>
                update.mutate(
                  { trophyKey: '' },
                  { onSuccess: () => toast.push({ tone: 'info', title: 'Trophy key removida' }) },
                )
              }
            >
              Remover chave
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}

/** Pasta do cofre de saves (pode ser uma pasta do OneDrive/Google Drive) e backup automático. */
function SavesSection({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  const qc = useQueryClient();
  const toast = useToast();
  const [moving, setMoving] = useState(false);

  async function chooseRoot() {
    setMoving(true);
    try {
      const next = await call('saves:choose-root');
      if (!next) return;
      qc.setQueryData(qk.settings, next);
      void qc.invalidateQueries({ queryKey: ['saves'] });
      toast.push({ tone: 'success', title: 'Pasta de saves alterada', description: `Os backups foram movidos para ${next.savesRoot}.` });
    } catch (err) {
      toast.push({ tone: 'error', title: 'Não foi possível trocar a pasta', description: errorMessage(err) });
    } finally {
      setMoving(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="saves-heading">
      <header className="panel__header">
        <h2 id="saves-heading" className="panel__title">
          Cofre de saves
        </h2>
        <Button variant="ghost" size="sm" icon={<FolderIcon size={14} />} onClick={() => void call('saves:open-folder', {})}>
          Abrir pasta
        </Button>
      </header>
      <p className="muted">
        Os saves de cada jogo são copiados para esta pasta, separada dos jogos. Se você apagar e reinstalar um jogo, o
        progresso continua aqui.
      </p>
      <div className="file-picker">
        <span className="file-picker__path" title={settings.savesRoot}>
          {settings.savesRoot}
        </span>
        <Button icon={<FolderIcon />} onClick={() => void chooseRoot()} loading={moving}>
          Alterar…
        </Button>
      </div>
      <CloudProviders />
      <Switch
        label="Backup automático dos saves"
        description="Guarda o save ao fechar o jogo e verifica a cada 15 minutos (só grava quando muda). Mantém as últimas 15 versões de cada jogo."
        checked={settings.autoBackupSaves}
        onChange={(autoBackupSaves) => update.mutate({ autoBackupSaves })}
        disabled={update.isPending}
      />
    </section>
  );
}

function PreferencesSection({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  return (
    <section className="panel" aria-labelledby="prefs-heading">
      <header className="panel__header">
        <h2 id="prefs-heading" className="panel__title">
          Preferências
        </h2>
      </header>
      <Switch
        label="Modo Hardcore"
        description="Desativa save states, rewind e cheats no RetroArch; conquistas valem pontos Hardcore."
        checked={settings.hardcoreMode}
        onChange={(hardcoreMode) => update.mutate({ hardcoreMode })}
        disabled={update.isPending}
      />
      <Switch
        label="Notificações de conquistas e troféus"
        description="Mostra uma notificação do Windows quando uma conquista ou troféu for desbloqueado durante o jogo."
        checked={settings.notifyAchievements}
        onChange={(notifyAchievements) => update.mutate({ notifyAchievements })}
        disabled={update.isPending}
      />
      <Switch
        label="Mostrar no Discord o que estou jogando"
        description="Enquanto um jogo aberto pelo RetroVault roda, seu perfil do Discord mostra o nome dele, a plataforma e há quanto tempo você joga. Só funciona com o app do Discord aberto neste PC."
        checked={settings.discordPresence}
        onChange={(discordPresence) => update.mutate({ discordPresence })}
        disabled={update.isPending}
      />
      <MotionSetting />
    </section>
  );
}

const MOTION_OPTIONS = [
  { value: 'system', label: 'Seguir o Windows' },
  { value: 'full', label: 'Sempre suaves' },
  { value: 'reduced', label: 'Reduzidas' },
] as const;

/** Preferência local deste computador (não vai para o banco): só muda a aparência. */
function MotionSetting() {
  const [motion, setMotion] = useMotionPreference();
  const systemReduces = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return (
    <div className="switch-row">
      <div>
        <div className="switch-row__label">Animações</div>
        <p className="field__hint">
          {systemReduces
            ? 'Os "Efeitos de animação" do Windows estão desligados; em "Seguir o Windows" o app troca de tela sem animar.'
            : 'Transições ao passar o mouse, selecionar jogos e trocar de tela.'}
        </p>
      </div>
      <SegmentedControl label="Animações" value={motion} options={MOTION_OPTIONS} onChange={setMotion} />
    </div>
  );
}
