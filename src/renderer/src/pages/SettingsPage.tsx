import { useSearchParams } from 'react-router-dom';
import { useAppUpdate, useEmulators, useRetroArchStatus, useSettings, useSteamShortcuts } from '@/hooks/queries';
import { AppUpdateSection, appUpdateSummary } from '@/components/settings/AppUpdateSection';
import { BackupSection } from '@/components/settings/BackupSection';
import { EmulatorsSection, emulatorsSummary } from '@/components/settings/EmulatorsSection';
import { GitHubSection } from '@/components/settings/GitHubSection';
import { PreferencesSection } from '@/components/settings/PreferencesSection';
import { RaAccountSection } from '@/components/settings/RaAccountSection';
import { RetroArchSection } from '@/components/settings/RetroArchSection';
import { SavesSection } from '@/components/settings/SavesSection';
import { SteamSection, steamSummary } from '@/components/settings/SteamSection';
import { StoreSection } from '@/components/settings/StoreSection';
import { TrophyKeySection } from '@/components/settings/TrophyKeySection';
import { Cascade, type CascadeItem } from '@/components/ui/Cascade';
import { LoadingBlock, Skeleton } from '@/components/ui/States';
import { DownloadIcon, FolderIcon, GamepadIcon, GearIcon, ImageIcon, LibraryIcon, LinkIcon, PlayIcon, RefreshIcon, StoreIcon, TrophyIcon } from '@/components/ui/icons';

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
