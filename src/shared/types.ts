// Modelos de domínio compartilhados entre main, preload e renderer.

export type GameKind = 'retroarch' | 'executable';

export interface Game {
  id: number;
  title: string;
  kind: GameKind;
  path: string;
  corePath: string | null;
  launchArgs: string | null;
  consoleId: number | null;
  raGameId: number | null;
  romHash: string | null;
  /** Jogo da Steam (importado das lojas): abre pela Steam, não pelo .exe direto. */
  steamAppId: number | null;
  coverUrl: string | null;
  /** Imagem de fundo personalizada (hero). Sem ela, usa a captura do RetroAchievements. */
  backgroundUrl: string | null;
  iconUrl: string | null;
  favorite: boolean;
  playtimeSeconds: number;
  lastPlayedAt: string | null;
  createdAt: string;
  /** Categorias do usuário (PS4, Nintendo DS…) em que o jogo está. */
  categoryIds: number[];
}

export interface Category {
  id: number;
  name: string;
  /** Chave de shared/categoryIcons.ts escolhida pelo usuário; null = automático pelo nome. */
  icon: string | null;
  /** Console ligado à categoria (chave de shared/consoleCategories.ts); null = categoria livre do usuário. */
  console: string | null;
  /** Quantos jogos estão nela. */
  gameCount: number;
}

export interface AutoOrganizeResult {
  categoriesCreated: string[];
  gamesAssigned: number;
  /** Jogos cuja plataforma não deu para descobrir. */
  unknown: string[];
}

export interface NewGameInput {
  kind: GameKind;
  path: string;
  title?: string;
  corePath?: string | null;
  launchArgs?: string | null;
  consoleId?: number | null;
  raGameId?: number | null;
  /** Só pela importação das lojas (o "Adicionar jogo" manual não define). */
  steamAppId?: number | null;
}

export interface UpdateGameInput {
  id: number;
  title?: string;
  corePath?: string | null;
  launchArgs?: string | null;
  consoleId?: number | null;
  raGameId?: number | null;
  favorite?: boolean;
}

export type ArtworkSlot = 'cover' | 'background' | 'icon';

export interface SetArtworkInput {
  id: number;
  slot: ArtworkSlot;
  /** pick = abre o seletor de arquivo; reset = volta ao padrão (RA / ícone do executável). */
  action: 'pick' | 'reset';
}

/** Uma opção de arte encontrada online: `url` é a imagem inteira; `thumb` a miniatura já local (rv-media://). */
export interface ArtCandidate {
  url: string;
  thumb: string;
  width: number;
  height: number;
}

/** Resultado da busca de arte de um jogo no SteamGridDB. */
export interface ArtSearchResult {
  query: string;
  /** Jogos com nome parecido (para trocar se o primeiro não for o certo). */
  games: { id: number; name: string }[];
  selectedGameId: number | null;
  cover: ArtCandidate[];
  background: ArtCandidate[];
  icon: ArtCandidate[];
}

export interface ArtFillResult {
  updated: number;
  /** Títulos sem resultado no SteamGridDB (o nome pode precisar de ajuste). */
  notFound: string[];
}

export interface GameInspection {
  suggestedTitle: string;
  consoleId: number | null;
  suggestedCorePath: string | null;
  autoMatchSupported: boolean;
}

export type MatchReason =
  | 'matched'
  | 'no-console'
  | 'unsupported-format'
  | 'not-found'
  | 'no-credentials'
  | 'error';

export interface MatchResult {
  matched: boolean;
  reason: MatchReason;
  hash: string | null;
  raGameId: number | null;
  raTitle: string | null;
}

export interface AddGameResult {
  game: Game;
  match: MatchResult | null;
}

// ---------- Configurações ----------

export interface Settings {
  retroarchPath: string | null;
  raUsername: string | null;
  hasApiKey: boolean;
  hardcoreMode: boolean;
  notifyAchievements: boolean;
  /** A trophy key nunca sai do processo principal; o renderer só sabe se ela existe. */
  hasTrophyKey: boolean;
  /** Pasta do cofre de saves (já resolvida: o padrão é Documentos\RetroVault\Saves). */
  savesRoot: string;
  /** Backup do save ao fechar o jogo e a cada 15 min, se mudou. */
  autoBackupSaves: boolean;
  /** Usuário da conta do GitHub vinculada (o token nunca sai do main); null = sem conta. */
  githubLogin: string | null;
  /** Chave do SteamGridDB salva (ela nunca sai do main). */
  hasSgdbKey: boolean;
  /** catalog.json online da Loja; null = catálogo embutido no app. */
  storeCatalogUrl: string | null;
  /** Notificação do Windows quando um port instalado ganha versão nova (uma vez por versão). */
  notifyPortUpdates: boolean;
  /** Mostra no perfil do Discord o jogo aberto pelo RetroVault (só com o app do Discord aberto). */
  discordPresence: boolean;
}

export interface SettingsUpdate {
  /** 32 caracteres hexadecimais; string vazia remove a chave. */
  trophyKey?: string;
  retroarchPath?: string | null;
  raUsername?: string | null;
  /** String vazia remove a chave salva. */
  raApiKey?: string;
  hardcoreMode?: boolean;
  notifyAchievements?: boolean;
  autoBackupSaves?: boolean;
  notifyPortUpdates?: boolean;
  discordPresence?: boolean;
}

// ---------- RetroArch ----------

export interface CoreInfo {
  name: string;
  path: string;
}

export interface RetroArchStatus {
  found: boolean;
  exePath: string | null;
  configPath: string | null;
  cheevosEnabled: boolean;
  loggedInAs: string | null;
  cores: CoreInfo[];
}

// ---------- RetroAchievements (modelos normalizados) ----------

export type AchievementType = 'progression' | 'win_condition' | 'missable' | null;

export interface Achievement {
  id: number;
  title: string;
  description: string;
  points: number;
  trueRatio: number;
  type: AchievementType;
  badgeUrl: string;
  badgeLockedUrl: string;
  displayOrder: number;
  numAwarded: number;
  numAwardedHardcore: number;
  /** Percentual (0–100) de jogadores que desbloquearam. */
  rarity: number;
  unlockedAt: string | null;
  unlockedHardcoreAt: string | null;
}

export interface GameProgress {
  gameId: number;
  title: string;
  consoleId: number;
  consoleName: string;
  iconUrl: string | null;
  boxArtUrl: string | null;
  titleImageUrl: string | null;
  ingameImageUrl: string | null;
  numAchievements: number;
  numDistinctPlayers: number;
  earned: number;
  earnedHardcore: number;
  totalPoints: number;
  earnedPoints: number;
  /** 0–100 */
  completion: number;
  achievements: Achievement[];
}

export interface UserProfile {
  username: string;
  avatarUrl: string | null;
  memberSince: string | null;
  motto: string | null;
  richPresence: string | null;
  totalPoints: number;
  totalSoftcorePoints: number;
  totalTruePoints: number;
}

export interface RecentAchievement {
  achievementId: number;
  title: string;
  description: string;
  points: number;
  badgeUrl: string;
  gameId: number;
  gameTitle: string;
  gameIconUrl: string | null;
  consoleName: string;
  unlockedAt: string;
  hardcore: boolean;
}

export type AwardKind = 'mastered' | 'completed' | 'beaten-hardcore' | 'beaten-softcore' | null;

export interface CompletionEntry {
  gameId: number;
  title: string;
  iconUrl: string | null;
  consoleName: string;
  maxPossible: number;
  numAwarded: number;
  numAwardedHardcore: number;
  mostRecentAwardedAt: string | null;
  highestAward: AwardKind;
}

export interface RaGameSearchResult {
  id: number;
  title: string;
  consoleId: number;
  consoleName: string;
  iconUrl: string | null;
  numAchievements: number;
}

export interface ConsoleInfo {
  id: number;
  name: string;
  iconUrl: string | null;
}

// ---------- Troféus locais (estilo PS4/shadPS4) ----------

/** P = Platina, G = Ouro, S = Prata, B = Bronze (mesmo código do TROPCONF do PS4). */
export type TrophyGrade = 'P' | 'G' | 'S' | 'B';

export interface Trophy {
  id: number;
  name: string;
  detail: string;
  grade: TrophyGrade;
  hidden: boolean;
  iconUrl: string | null;
  unlockedAt: string | null;
  unlockSource: 'auto' | 'manual' | null;
}

/**
 * De onde vem a lista: pacote do dump do PS4, criada à mão, ou do emulador que já guarda os troféus
 * (RPCS3 = PS3, Vita3K = PS Vita; os desbloqueios vêm dele).
 */
export type TrophySource = 'ps4' | 'manual' | 'rpcs3' | 'vita3k';

export interface TrophySet {
  gameId: number;
  source: TrophySource;
  npCommId: string | null;
  title: string | null;
  iconUrl: string | null;
  /** Log monitorado para detectar desbloqueios automaticamente (null = só manual). */
  logPath: string | null;
  /** TROPUSR.DAT do emulador (rpcs3/vita3k): os desbloqueios são lidos dele. */
  progressPath: string | null;
  trophies: Trophy[];
}

export interface GradeCount {
  total: number;
  unlocked: number;
}

/** Resumo de um jogo para a página geral de troféus (sem a lista inteira). */
export interface TrophyGameSummary {
  gameId: number;
  title: string;
  iconUrl: string | null;
  source: TrophySource;
  byGrade: Record<TrophyGrade, GradeCount>;
  lastUnlockedAt: string | null;
}

export interface RecentTrophy {
  gameId: number;
  gameTitle: string;
  trophy: Trophy;
}

export interface TrophyOverview {
  games: TrophyGameSummary[];
  /** Últimos troféus obtidos em todos os jogos, do mais recente para o mais antigo. */
  recent: RecentTrophy[];
}

export interface TrophyInput {
  gameId: number;
  /** Ausente = novo troféu. */
  trophyId?: number;
  name: string;
  detail: string;
  grade: TrophyGrade;
  hidden: boolean;
}

// ---------- Cofre de saves ----------

export interface SaveLocation {
  path: string;
  /** auto = detectado; manual = adicionado pelo usuário. */
  source: 'auto' | 'manual';
  exists: boolean;
  isDirectory: boolean;
  sizeBytes: number;
}

/** session = ao fechar o jogo; auto = verificação periódica; initial = primeira proteção. */
export type SaveSnapshotReason = 'session' | 'auto' | 'manual' | 'initial' | 'pre-restore';

export interface SaveSnapshot {
  id: string;
  createdAt: string;
  reason: SaveSnapshotReason;
  files: number;
  sizeBytes: number;
}

export interface GameSaves {
  locations: SaveLocation[];
  /** Versões guardadas no cofre (inclui as de uma instalação anterior do mesmo jogo). */
  snapshots: SaveSnapshot[];
  /** Pasta deste jogo no cofre (null se ainda não houve backup). */
  vaultDir: string | null;
  /** true se as versões vieram de uma instalação anterior (jogo readicionado). */
  fromPreviousInstall: boolean;
}

// ---------- Nuvem ----------

export type CloudProviderId = 'onedrive' | 'googledrive' | 'dropbox';

export interface CloudProvider {
  id: CloudProviderId;
  name: string;
  /** Pasta sincronizada no PC (null = não instalado/configurado). */
  folder: string | null;
  account: string | null;
  /** O app de sincronização está aberto? Sem ele, nada sobe para a nuvem. */
  running: boolean;
  /** Dá para abrir o app de sincronização pelo RetroVault. */
  canStart: boolean;
  /** O cofre de saves está dentro desta pasta. */
  connected: boolean;
  downloadUrl: string;
}

// ---------- Atalhos na Steam ----------

export interface SteamAccount {
  /** Nome da pasta em userdata (id da conta). */
  id: string;
  /** Nome de exibição (loginusers.vdf); o id se não houver. */
  name: string;
  /** A conta usada por último neste PC. */
  mostRecent: boolean;
}

export interface SteamShortcutEntry {
  gameId: number;
  title: string;
  /** Já está na Steam por um atalho criado pelo RetroVault. */
  inSteam: boolean;
  /** Por que não dá para enviar (jogo da própria Steam, atalho seu já existente); null = pode. */
  blocked: string | null;
}

export interface SteamShortcutsOverview {
  steamFound: boolean;
  /** A Steam está aberta: ela regrava o arquivo ao fechar, então é preciso fechá-la antes de salvar. */
  steamRunning: boolean;
  accounts: SteamAccount[];
  /** Conta mostrada (a escolhida, ou a usada por último). */
  accountId: string | null;
  games: SteamShortcutEntry[];
  /** O próprio RetroVault está na Steam (atalho criado por ele). */
  launcherInSteam: boolean;
  /** O RetroVault pode se adicionar (só na versão instalada/empacotada). */
  launcherAvailable: boolean;
  /** Atalhos não-Steam que você criou (nunca alterados). */
  otherShortcuts: number;
}

export interface SteamShortcutsInput {
  accountId: string;
  gameIds: number[];
  includeLauncher: boolean;
}

export interface SteamShortcutsResult {
  added: number;
  updated: number;
  removed: number;
  skipped: { title: string; reason: string }[];
  /** Cópia do shortcuts.vdf anterior (null se não existia). */
  backupPath: string | null;
}

// ---------- Adicionar pasta ----------

export interface ScanCandidate {
  path: string;
  kind: GameKind;
  title: string;
  consoleId: number | null;
  /** Outros executáveis válidos da mesma pasta (o usuário pode trocar o principal). */
  alternatives: string[];
  inLibrary: boolean;
  /** Pré-selecionado na revisão; false para itens incertos (ex.: disco sem console definido). */
  recommended: boolean;
  note: string | null;
  /** Jogo da Steam: entra na biblioteca abrindo pela Steam. */
  steamAppId?: number | null;
}

export interface ScanResult {
  /** De onde vieram os jogos: uma pasta varrida ou as lojas instaladas (Epic, GOG…). Ausente = pasta. */
  source?: 'folder' | 'stores';
  root: string;
  candidates: ScanCandidate[];
  dirsVisited: number;
  /** true se a varredura parou num limite (pastas, tempo ou resultados). */
  truncated: boolean;
  elapsedMs: number;
}

export interface ScanProgress {
  dirsVisited: number;
  found: number;
  currentDir: string | null;
}

export interface BatchAddItem {
  kind: GameKind;
  path: string;
  title: string;
  consoleId: number | null;
  steamAppId?: number | null;
}

export interface BatchAddResult {
  added: number;
  failed: { title: string; message: string }[];
}

export interface BatchAddProgress {
  done: number;
  total: number;
  current: string | null;
}

// ---------- Backup e progresso ----------

/** auto = diário; manual = pedido pelo usuário; pre-migration / pre-restore = rede de segurança. */
export type BackupKind = 'auto' | 'manual' | 'pre-migration' | 'pre-restore';

export interface BackupInfo {
  /** Nome do arquivo (identificador usado para restaurar). */
  name: string;
  kind: BackupKind;
  createdAt: string;
  sizeBytes: number;
}

export interface ProgressImportResult {
  gamesMatched: number;
  trophiesRestored: number;
  playtimeUpdated: number;
  /** Títulos do arquivo sem jogo correspondente na biblioteca. */
  gamesNotFound: string[];
}

// ---------- Eventos ----------

export interface TrophyUnlockEvent {
  gameId: number;
  gameTitle: string;
  trophies: Trophy[];
}

export interface TrophyImportEvent {
  gameId: number;
  gameTitle: string;
  count: number;
}

export interface SessionEvent {
  gameId: number;
  durationSeconds: number;
}

export interface UnlockEvent {
  achievements: RecentAchievement[];
}
