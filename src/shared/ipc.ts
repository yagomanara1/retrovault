// Contrato IPC tipado: única fonte de verdade para canais, entradas e saídas.
import type { AppUpdateState } from './appUpdate';
import type { EmulatorChoice, EmulatorsOverview } from './emulators';
import type {
  AddGameResult,
  ArtFillResult,
  ArtSearchResult,
  ArtworkSlot,
  AutoOrganizeResult,
  Category,
  BackupInfo,
  BatchAddItem,
  BatchAddProgress,
  BatchAddResult,
  CloudProvider,
  CloudProviderId,
  ScanProgress,
  ScanResult,
  ProgressImportResult,
  CompletionEntry,
  ConsoleInfo,
  Game,
  GameInspection,
  GameKind,
  GameProgress,
  GameSaves,
  NewGameInput,
  SaveSnapshot,
  RaGameSearchResult,
  RecentAchievement,
  RetroArchStatus,
  SessionEvent,
  Settings,
  SetArtworkInput,
  SettingsUpdate,
  SteamShortcutsInput,
  SteamShortcutsOverview,
  SteamShortcutsResult,
  TrophyImportEvent,
  TrophyInput,
  TrophyOverview,
  TrophySet,
  TrophyUnlockEvent,
  UnlockEvent,
  UpdateGameInput,
  UserProfile,
} from './types';
import type {
  CustomPortInput,
  GitHubStatus,
  InstallProgress,
  PortArt,
  RepoInspection,
  RomSetupResult,
  RomStatus,
  StoreCatalog,
  StoreInstall,
  StorePort,
  StoreRelease,
  UpdateAllResult,
} from './store';
import type { InstalledMod, ModDetails, ModListResult, ModProgress, ModSort } from './mods';

export type ErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'DUPLICATE'
  | 'FILE_MISSING'
  | 'ALREADY_RUNNING'
  | 'LAUNCH_FAILED'
  | 'RETROARCH_NOT_FOUND'
  | 'EMULATOR_NOT_FOUND'
  | 'CORE_MISSING'
  | 'RA_NOT_CONFIGURED'
  | 'RA_AUTH'
  | 'RA_HTTP'
  | 'RA_NETWORK'
  | 'TROPHY_KEY_MISSING'
  | 'TROPHY_KEY_INVALID'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'GITHUB_AUTH'
  | 'SGDB_AUTH'
  | 'CANCELLED'
  | 'STORE_HTTP'
  | 'STORE_NETWORK'
  /** A Steam está aberta: ela regravaria o shortcuts.vdf ao fechar. */
  | 'STEAM_RUNNING'
  | 'INTERNAL';

export interface IpcError {
  code: ErrorCode;
  message: string;
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError };

export interface RefreshInput {
  force?: boolean;
}

export type FileDialogKind = 'rom' | 'executable' | 'retroarch';

export interface IpcContract {
  'games:list': { input: void; output: Game[] };
  'games:inspect': { input: { path: string; kind: GameKind }; output: GameInspection };
  'games:add': { input: NewGameInput; output: AddGameResult };
  'games:update': { input: UpdateGameInput; output: Game };
  'games:remove': { input: number; output: void };
  'games:rematch': { input: number; output: AddGameResult };
  /** Retorna null se o usuário cancelar o seletor de arquivo. */
  'games:set-artwork': { input: SetArtworkInput; output: Game | null };
  /** Busca capa, fundo e ícone no SteamGridDB (miniaturas já locais). sgdbGameId troca o jogo encontrado. */
  'games:art-search': { input: { id: number; query?: string; sgdbGameId?: number }; output: ArtSearchResult };
  /** Aplica uma opção da busca (url do SteamGridDB). */
  'games:art-apply': { input: { id: number; slot: ArtworkSlot; url: string }; output: Game };
  /** Busca capa, fundo e ícone para os jogos de PC sem capa. */
  'games:art-fill-missing': { input: void; output: ArtFillResult };
  /** Imagem montada no editor de enquadramento (PNG/JPEG em base64). */
  'games:set-artwork-data': { input: { id: number; slot: ArtworkSlot; data: string }; output: Game };
  'games:launch': { input: number; output: void };
  /** Abre o seletor de pasta no main e varre a pasta escolhida; null se cancelado. */
  'library:scan': { input: void; output: ScanResult | null };
  'library:scan-cancel': { input: void; output: void };
  /** Jogos instalados por outras lojas (Steam, Epic, GOG, Ubisoft, Amazon, itch.io), para a mesma revisão. */
  'library:scan-stores': { input: void; output: ScanResult };
  'games:add-many': { input: { items: BatchAddItem[] }; output: BatchAddResult };
  /** Ids dos jogos cujo arquivo não existe mais (movido ou apagado). */
  'games:missing': { input: void; output: number[] };
  /** pick = escolher o arquivo (null se cancelado); auto = procurar o novo local (NOT_FOUND se não achar). */
  'games:relocate': { input: { id: number; action: 'pick' | 'auto' }; output: Game | null };
  'games:running': { input: void; output: number[] };
  'dialog:open-file': { input: { kind: FileDialogKind }; output: string | null };
  'settings:get': { input: void; output: Settings };
  'settings:update': { input: SettingsUpdate; output: Settings };
  'retroarch:status': { input: void; output: RetroArchStatus };
  'ra:profile': { input: RefreshInput; output: UserProfile };
  'ra:recent': { input: RefreshInput; output: RecentAchievement[] };
  'ra:completion': { input: RefreshInput; output: CompletionEntry[] };
  'ra:game-progress': { input: { raGameId: number; force?: boolean }; output: GameProgress };
  'ra:consoles': { input: void; output: ConsoleInfo[] };
  'ra:search': { input: { consoleId: number; query: string }; output: RaGameSearchResult[] };
  'app:open-external': { input: string; output: void };
  'app:update-status': { input: void; output: AppUpdateState };
  /** Procura versão nova do RetroVault agora (e baixa, se houver). */
  'app:update-check': { input: void; output: AppUpdateState };
  /** Fecha o app e instala a versão já baixada. */
  'app:update-install': { input: void; output: void };
  /** Emuladores próprios: instalados, escolha por console e tela cheia. */
  'emulators:overview': { input: void; output: EmulatorsOverview };
  'emulators:refresh': { input: void; output: EmulatorsOverview };
  /** "pick" abre o seletor de .exe no main; null volta para o encontrado sozinho. */
  'emulators:set-path': { input: { id: string; path: 'pick' | null }; output: EmulatorsOverview | null };
  /** null = automático. */
  'emulators:set-console': { input: { consoleId: number; choice: EmulatorChoice | null }; output: EmulatorsOverview };
  'emulators:set-fullscreen': { input: boolean; output: EmulatorsOverview };
  /** Jogos do RetroVault como atalhos não-Steam: situação de uma conta (null = a usada por último). */
  'steam:shortcuts': { input: { accountId: string | null }; output: SteamShortcutsOverview };
  'steam:shortcuts-apply': { input: SteamShortcutsInput; output: SteamShortcutsResult };
  /** Pede para a Steam fechar (steam://exit): ela precisa estar fechada para salvar os atalhos. */
  'steam:exit': { input: void; output: void };
  'categories:list': { input: void; output: Category[] };
  'categories:create': { input: string; output: Category };
  'categories:rename': { input: { id: number; name: string }; output: Category };
  /** Apaga a categoria; os jogos continuam na biblioteca. */
  'categories:delete': { input: number; output: void };
  /** icon = chave de shared/categoryIcons.ts, ou null para o automático. */
  'categories:set-icon': { input: { id: number; icon: string | null }; output: Category };
  'categories:move': { input: { id: number; direction: -1 | 1 }; output: Category[] };
  /** Substitui as categorias do jogo. */
  'categories:set-game': { input: { gameId: number; categoryIds: number[] }; output: Game };
  /** Cria categorias por plataforma e distribui os jogos ainda sem categoria. */
  'categories:auto-organize': { input: void; output: AutoOrganizeResult };
  'saves:get': { input: number; output: GameSaves };
  /** Backup manual agora; null se não há save para guardar. */
  'saves:backup': { input: number; output: SaveSnapshot | null };
  'saves:restore': { input: { gameId: number; snapshotId: string }; output: GameSaves };
  /** Abre o seletor (arquivo ou pasta) no main; null se cancelado. */
  'saves:add-path': { input: { gameId: number; kind: 'file' | 'folder' }; output: GameSaves | null };
  'saves:remove-path': { input: { gameId: number; path: string }; output: GameSaves };
  /** Abre a pasta do jogo no cofre (ou a raiz do cofre, sem gameId). */
  'saves:open-folder': { input: { gameId?: number }; output: void };
  /** Escolhe outra pasta para o cofre e move os backups; null se cancelado. */
  'saves:choose-root': { input: void; output: Settings | null };
  'cloud:providers': { input: void; output: CloudProvider[] };
  /** Coloca o cofre na pasta sincronizada (mesclando com um cofre que já esteja lá, ex.: outro PC). */
  'cloud:connect': { input: CloudProviderId; output: { settings: Settings; games: number; snapshots: number } };
  /** Volta o cofre para a pasta local; a cópia na nuvem é mantida. */
  'cloud:disconnect': { input: void; output: Settings };
  'cloud:start-client': { input: CloudProviderId; output: void };
  'backup:list': { input: void; output: BackupInfo[] };
  'backup:create': { input: void; output: BackupInfo };
  /** Agenda a restauração e reinicia o app (o arquivo do banco é trocado antes de abrir). */
  'backup:restore': { input: string; output: void };
  'backup:open-folder': { input: void; output: void };
  /** Abre "Salvar como" no main; null se cancelado. Retorna o caminho gravado. */
  'progress:export': { input: void; output: string | null };
  /** Abre o seletor no main; null se cancelado. */
  'progress:import': { input: void; output: ProgressImportResult | null };
  'trophies:get': { input: number; output: TrophySet | null };
  /** Página geral: resumo por jogo + troféus recentes de todos os jogos. */
  'trophies:overview': { input: void; output: TrophyOverview };
  /** Abre o seletor de .trp no main; null se cancelado. */
  'trophies:import-trp': { input: number; output: TrophySet | null };
  /** Procura o trophy00.trp do jogo sozinho; NOT_FOUND se não achar. */
  'trophies:auto-import': { input: number; output: TrophySet };
  'trophies:create-manual': { input: number; output: TrophySet };
  'trophies:delete-set': { input: number; output: void };
  'trophies:upsert': { input: TrophyInput; output: TrophySet };
  'trophies:delete': { input: { gameId: number; trophyId: number }; output: TrophySet };
  'trophies:set-unlocked': { input: { gameId: number; trophyId: number; unlocked: boolean }; output: TrophySet };
  /** pick = escolher arquivo; auto = detectar; clear = desligar a detecção automática. */
  'trophies:configure-log': { input: { gameId: number; action: 'pick' | 'auto' | 'clear' }; output: TrophySet | null };
  /** Catálogo da Loja (remoto em cache ou o embutido no app). */
  'store:catalog': { input: RefreshInput; output: StoreCatalog };
  /** Versões publicadas do port (o main resolve o repositório pelo id; o renderer não passa URLs). */
  'store:releases': { input: { portId: string; force?: boolean }; output: StoreRelease[] };
  /** Conta do GitHub vinculada e o limite de consultas atual. */
  'github:status': { input: void; output: GitHubStatus };
  /** Confere o token no GitHub e só então o guarda (cifrado). GITHUB_AUTH se for recusado. */
  'github:connect': { input: string; output: GitHubStatus };
  'github:disconnect': { input: void; output: GitHubStatus };
  /** Ports instalados e os que estão instalando agora. */
  'store:installs': { input: void; output: { installs: StoreInstall[]; installing: string[] } };
  /** Baixa e instala (a versão pedida ou a mais nova). Resolve no fim; o progresso vem por evento. */
  'store:install': { input: { portId: string; tag?: string }; output: StoreInstall };
  'store:cancel': { input: string; output: void };
  /** Save no cofre, pasta para a Lixeira; o jogo fica na biblioteca. manual = instalado pelo instalador do projeto (desinstalar pelo Windows). */
  'store:uninstall': { input: string; output: { manual: boolean } };
  'store:open-folder': { input: string; output: void };
  /** Volta para a versão anterior guardada no disco (sem baixar). */
  'store:rollback': { input: string; output: StoreInstall };
  /** Artes do port (locais, rv-media://); campos null quando não há. */
  'store:art': { input: string; output: PortArt };
  /** Testa e salva a URL do catálogo online (null volta ao embutido). */
  'store:set-catalog-url': { input: string | null; output: { settings: Settings; ports: number; skipped: number } };
  /** "Salvar como" no main com o catálogo atual em catalog.json; null se cancelado. */
  'store:export-catalog': { input: void; output: string | null };
  /** Confere a chave no SteamGridDB e só então a guarda (cifrada). */
  'sgdb:connect': { input: string; output: Settings };
  'sgdb:disconnect': { input: void; output: Settings };
  /** Atualizações dos ports instalados, por id. */
  'store:updates': { input: void; output: Record<string, { tag: string; name: string; sizeBytes: number }> };
  /** Mods do GameBanana do port (miniaturas já locais). */
  'mods:list': { input: { portId: string; page: number; sort: ModSort; query?: string }; output: ModListResult };
  'mods:details': { input: { portId: string; modId: number }; output: ModDetails };
  'mods:installed': { input: string; output: InstalledMod[] };
  /** Baixa (só do GameBanana) e põe na pasta de mods do port; o progresso vem pelo evento mods:progress. */
  'mods:install': { input: { portId: string; modId: number; fileId: number }; output: InstalledMod };
  'mods:uninstall': { input: { portId: string; modId: number }; output: void };
  /** Lê a versão mais recente de um repositório colado (link ou dono/repo) e sugere o arquivo de Windows. */
  'store:custom-inspect': { input: string; output: RepoInspection };
  /** Adiciona à Loja um port de um repositório do GitHub (validado como um item do catálogo). */
  'store:custom-add': { input: CustomPortInput; output: StorePort };
  /** Tira da Loja um port adicionado pelo usuário (só se não estiver instalado). */
  'store:custom-remove': { input: string; output: void };
  /** Atualiza todos os ports com versão nova (menos os de instalador e os abertos). O progresso vem por evento. */
  'store:update-all': { input: void; output: UpdateAllResult };
  /** null = o port não tem assistente de ROM no catálogo. */
  'store:rom-status': { input: string; output: RomStatus | null };
  /** Abre o seletor no main, confere e entrega a ROM; null se cancelado. */
  'store:rom-setup': { input: string; output: RomSetupResult | null };
  /** Mostra no Explorer o arquivo a selecionar quando o port pedir. */
  'store:rom-show': { input: string; output: void };
}

export type IpcChannel = keyof IpcContract;
export type IpcInput<C extends IpcChannel> = IpcContract[C]['input'];
export type IpcOutput<C extends IpcChannel> = IpcContract[C]['output'];

export interface EventContract {
  'session:started': { gameId: number };
  'session:ended': SessionEvent;
  'achievements:unlocked': UnlockEvent;
  'trophies:unlocked': TrophyUnlockEvent;
  'trophies:imported': TrophyImportEvent;
  /** A lista mudou no main (ex.: log detectado); o renderer só recarrega. */
  'trophies:changed': { gameId: number };
  /** Jogo encontrado sozinho em outra pasta (reparo ao iniciar). */
  'games:relocated': { gameId: number; title: string; path: string };
  /** O jogo mudou no main (ex.: arte do dump aplicada); o renderer só recarrega. */
  'games:changed': { gameId: number };
  'library:scan-progress': ScanProgress;
  'library:add-progress': BatchAddProgress;
  /** Backup automático de save criado (ao fechar o jogo ou na verificação periódica). */
  'saves:changed': { gameId: number };
  'store:install-progress': InstallProgress;
  /** A verificação de fundo achou (ou deixou de achar) atualizações de ports. */
  'store:updates-changed': { count: number };
  'mods:progress': ModProgress;
  'app:update-changed': AppUpdateState;
}

export type EventChannel = keyof EventContract;

// `satisfies` garante em tempo de compilação que todo canal está listado (whitelist do preload).
const invokeChannelMap = {
  'games:list': true,
  'games:inspect': true,
  'games:add': true,
  'games:update': true,
  'games:remove': true,
  'games:rematch': true,
  'games:set-artwork': true,
  'games:art-search': true,
  'games:art-apply': true,
  'games:art-fill-missing': true,
  'games:set-artwork-data': true,
  'games:launch': true,
  'games:running': true,
  'library:scan': true,
  'library:scan-cancel': true,
  'library:scan-stores': true,
  'games:add-many': true,
  'games:missing': true,
  'games:relocate': true,
  'dialog:open-file': true,
  'settings:get': true,
  'settings:update': true,
  'retroarch:status': true,
  'ra:profile': true,
  'ra:recent': true,
  'ra:completion': true,
  'ra:game-progress': true,
  'ra:consoles': true,
  'ra:search': true,
  'app:open-external': true,
  'app:update-status': true,
  'app:update-check': true,
  'app:update-install': true,
  'emulators:overview': true,
  'emulators:refresh': true,
  'emulators:set-path': true,
  'emulators:set-console': true,
  'emulators:set-fullscreen': true,
  'steam:shortcuts': true,
  'steam:shortcuts-apply': true,
  'steam:exit': true,
  'categories:list': true,
  'categories:create': true,
  'categories:rename': true,
  'categories:delete': true,
  'categories:set-icon': true,
  'categories:move': true,
  'categories:set-game': true,
  'categories:auto-organize': true,
  'saves:get': true,
  'saves:backup': true,
  'saves:restore': true,
  'saves:add-path': true,
  'saves:remove-path': true,
  'saves:open-folder': true,
  'saves:choose-root': true,
  'cloud:providers': true,
  'cloud:connect': true,
  'cloud:disconnect': true,
  'cloud:start-client': true,
  'backup:list': true,
  'backup:create': true,
  'backup:restore': true,
  'backup:open-folder': true,
  'progress:export': true,
  'progress:import': true,
  'trophies:get': true,
  'trophies:overview': true,
  'trophies:import-trp': true,
  'trophies:auto-import': true,
  'trophies:create-manual': true,
  'trophies:delete-set': true,
  'trophies:upsert': true,
  'trophies:delete': true,
  'trophies:set-unlocked': true,
  'trophies:configure-log': true,
  'store:catalog': true,
  'store:releases': true,
  'github:status': true,
  'github:connect': true,
  'github:disconnect': true,
  'store:installs': true,
  'store:install': true,
  'store:cancel': true,
  'store:uninstall': true,
  'store:open-folder': true,
  'store:rollback': true,
  'store:art': true,
  'store:set-catalog-url': true,
  'store:export-catalog': true,
  'sgdb:connect': true,
  'sgdb:disconnect': true,
  'store:updates': true,
  'store:update-all': true,
  'mods:list': true,
  'mods:details': true,
  'mods:installed': true,
  'mods:install': true,
  'mods:uninstall': true,
  'store:custom-inspect': true,
  'store:custom-add': true,
  'store:custom-remove': true,
  'store:rom-status': true,
  'store:rom-setup': true,
  'store:rom-show': true,
} satisfies Record<IpcChannel, true>;

const eventChannelMap = {
  'session:started': true,
  'session:ended': true,
  'achievements:unlocked': true,
  'trophies:unlocked': true,
  'trophies:imported': true,
  'trophies:changed': true,
  'games:relocated': true,
  'games:changed': true,
  'library:scan-progress': true,
  'library:add-progress': true,
  'saves:changed': true,
  'store:install-progress': true,
  'store:updates-changed': true,
  'mods:progress': true,
  'app:update-changed': true,
} satisfies Record<EventChannel, true>;

export const INVOKE_CHANNELS: ReadonlySet<string> = new Set(Object.keys(invokeChannelMap));
export const EVENT_CHANNELS: ReadonlySet<string> = new Set(Object.keys(eventChannelMap));

/** API exposta ao renderer via contextBridge (window.bridge). */
export interface Bridge {
  invoke<C extends IpcChannel>(channel: C, input: IpcInput<C>): Promise<IpcResult<IpcOutput<C>>>;
  on<E extends EventChannel>(event: E, listener: (payload: EventContract[E]) => void): () => void;
}
