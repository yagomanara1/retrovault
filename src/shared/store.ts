// Tipos da Loja de ports: o catálogo só descreve onde cada port publica suas versões.
// Nada de jogo é distribuído: o usuário fornece a própria ROM ou os arquivos do jogo.
import type { CategoryIconKey } from './categoryIcons';
import type { PortMods } from './mods';

/**
 * O que o port precisa que o usuário forneça (cópia própria do jogo original).
 * `none`: jogo gratuito, liberado pelos autores (ex.: OpenTyrian); não há cópia a fornecer.
 */
export interface StoreRequirement {
  kind: 'rom' | 'game-files' | 'none';
  /** Ex.: "ROM de Ocarina of Time (Nintendo 64)". */
  label: string;
  note?: string;
}

/** Uma versão do jogo aceita pelo port (hash oficial publicado pelo projeto, ou o código do cartucho). */
export interface AcceptedRom {
  name: string;
  sha1?: string;
  md5?: string;
  sha256?: string;
  /** Para quem não publica hash: código do cartucho no cabeçalho (ex.: "NBKE") e a revisão. */
  header?: { code: string; version: number };
}

/**
 * Como o port recebe o jogo:
 * - copy: o RetroVault coloca a ROM conferida em `target` (relativo à pasta do port);
 * - in-app: o próprio port pede o arquivo na primeira vez; o RetroVault confere antes
 *   (e gera uma cópia .z64 quando o formato não serve).
 */
export interface StoreSetup {
  method: 'copy' | 'in-app';
  target?: string;
  /** Versões aceitas; sem lista, nada é conferido (ex.: arquivos de disco de Xbox 360). */
  accepted?: AcceptedRom[];
  /** O que acontece ao abrir o port pela primeira vez (texto para a tela). */
  instructions: string;
}

/** Estado da ROM de um port instalado. */
export interface RomStatus {
  method: StoreSetup['method'];
  /** ready = ROM no lugar (copy); verified = conferida, o port pede ao abrir (in-app); missing = falta. */
  state: 'ready' | 'verified' | 'missing';
  versionName: string | null;
  /** Arquivo para selecionar quando o port pedir (o original ou a cópia .z64 gerada). */
  fileToSelect: string | null;
}

export interface RomSetupResult {
  status: RomStatus;
  /** copied = colocada na pasta do port; converted = cópia .z64 criada; verified = só conferida. */
  action: 'copied' | 'converted' | 'verified';
  detected: string;
}

export interface StorePort {
  id: string;
  name: string;
  /**
   * Jogo original e plataforma (chave de ícone de categoria: n64, xbox…). `system` é o nome exato do
   * console quando o ícone é de uma família (ex.: "PlayStation 2" com o ícone "playstation").
   */
  original: { title: string; platform: CategoryIconKey; system?: string };
  developer: string;
  summary: string;
  description: string;
  tags: string[];
  source: { type: 'github'; repo: string };
  /** Regex (sem diferenciar maiúsculas) que reconhece o arquivo de Windows numa versão. */
  assets: { windows: string };
  /** Executável a abrir, relativo à pasta do port (ex.: "soh.exe"). Sem ele, o instalador escolhe sozinho. */
  executable?: string;
  /**
   * Como instalar o arquivo de Windows; sem o campo, vale o deduzido pelo nome (ver installKind):
   * archive (.zip/.7z), portable (.exe sozinho) ou installer (setup .exe/.msi do projeto).
   */
  install?: InstallKind;
  /** Para installer: onde o jogo costuma ficar depois de instalado (variáveis %LOCALAPPDATA% etc. valem). */
  installedExe?: string[];
  /** Marcação de uso de IA no projeto (como o catálogo de referência informa). */
  ai?: 'none' | 'assisted' | 'generated';
  requires: StoreRequirement;
  /** Como o jogo (ROM) chega ao port; sem isso, a tela só mostra o requisito. */
  setup?: StoreSetup;
  /**
   * Artes sem SteamGridDB (só https de hosts permitidos): `logo` publicado pelo projeto e `boxart`,
   * a capa do jogo original (libretro-thumbnails, as mesmas que o RetroArch usa).
   */
  art?: { logo?: string; boxart?: string };
  /** Nome para buscar a arte no SteamGridDB, quando o título original não acha (ex.: subtítulos). */
  artQuery?: string;
  homepage?: string;
  /** Página do port no Quiver Launcher (só o slug; o endereço é montado por `quiverPageUrl`). */
  quiver?: string;
  /** Mods no GameBanana: onde o port os procura e quais arquivos lê. */
  mods?: PortMods;
  /** Adicionado pelo próprio usuário (não vem do catálogo): sem curadoria, removível. Nunca vem do catalog.json. */
  custom?: boolean;
}

/** Um arquivo da versão mais recente de um repositório, candidato a pacote de Windows. */
export interface RepoAssetOption {
  name: string;
  size: number;
  /** Regra que reconhece este arquivo nas próximas versões (números variam; x64, win64 e afins ficam fixos). */
  pattern: string;
}

/** O que se descobre de um repositório colado na Loja, antes de adicioná-lo. */
export interface RepoInspection {
  repo: string;
  /** Nome sugerido para o port (o do repositório). */
  suggestedName: string;
  /** Jogo original sugerido: o nome sem "Launcher", "Port", "Recomp"… (é o nome buscado para a capa). */
  suggestedTitle: string;
  latestTag: string;
  /** Arquivos que podem ser o pacote de Windows; o primeiro é o sugerido. */
  assets: RepoAssetOption[];
}

/** Port adicionado pelo usuário a partir de um repositório do GitHub. */
export interface CustomPortInput {
  repo: string;
  name: string;
  originalTitle: string;
  platform: string;
  system?: string;
  assetPattern: string;
  requiresKind: StoreRequirement['kind'];
  requiresLabel: string;
}

export interface StoreCatalog {
  ports: StorePort[];
  /** remote = baixado da URL configurada; embedded = o que vem com o app (offline ou sem URL). */
  source: 'remote' | 'embedded';
}

export interface StoreAsset {
  name: string;
  size: number;
  downloadUrl: string;
  /** SHA-256 publicado pelo GitHub ("sha256:…"), quando existe. */
  sha256: string | null;
}

/** Site do Quiver Launcher, de onde vem boa parte da seleção da Loja (crédito em texto, sem a marca). */
export const QUIVER_SITE = 'https://quiverlauncher.com';

/** Slug de uma página do Quiver: minúsculas, números e hífens. */
export const QUIVER_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Página do port no Quiver. O catálogo só informa o slug, então o link nunca sai desse site. */
export function quiverPageUrl(slug: string): string {
  return `${QUIVER_SITE}/apps/${encodeURIComponent(slug)}`;
}

/** Versão a instalar: a pedida, ou a estável mais nova com arquivo de Windows (prévia só se não houver estável). */
export function chooseRelease(releases: readonly StoreRelease[], tag?: string): StoreRelease | null {
  if (tag) return releases.find((r) => r.tag === tag) ?? null;
  return releases.find((r) => !r.prerelease && r.windowsAsset) ?? releases.find((r) => r.windowsAsset) ?? null;
}

/** Artes de um port, já locais (rv-media://); cada uma pode faltar. */
export interface PortArt {
  /** Capa vertical (600×900). */
  cover: string | null;
  /** Banner largo para o topo da página. */
  hero: string | null;
  /** Logo com fundo transparente. */
  logo: string | null;
  /** Ícone quadrado para a lista. */
  icon: string | null;
  source: 'steamgriddb' | 'project' | 'none';
}

export type InstallKind = 'archive' | 'portable' | 'installer';

/** Resultado do "Atualizar tudo" (por id do port). */
export interface UpdateAllResult {
  updated: string[];
  /** installer = usa o instalador do projeto (atualize pela página do port); running = aberto agora. */
  skipped: { portId: string; reason: 'installer' | 'running' | 'cancelled' }[];
  failed: { portId: string; message: string }[];
}

/** Tipo de instalação: o do catálogo, ou deduzido pelo nome do arquivo de Windows. */
export function installKind(port: Pick<StorePort, 'install'>, assetName: string): InstallKind {
  if (port.install) return port.install;
  const name = assetName.toLowerCase();
  if (name.endsWith('.msi') || name.endsWith('.msi.zip')) return 'installer';
  if (name.endsWith('.exe')) return /setup|install/.test(name) ? 'installer' : 'portable';
  return 'archive';
}

/** Uma versão instalada no disco (a ativa ou a anterior, guardada para voltar). */
export interface InstalledVersion {
  /** installer = instalado pelo instalador do projeto, fora da pasta do RetroVault (sem "voltar"). */
  kind: InstallKind;
  tag: string;
  assetName: string;
  /** SHA-256 do arquivo baixado (para reconhecer uma compilação nova com a mesma tag). */
  sha256: string;
  /** true = conferido com o SHA-256 publicado; false = só pelo tamanho (o projeto não publicou hash). */
  verified: boolean;
  installDir: string;
  exePath: string;
  sizeBytes: number;
  installedAt: string;
}

/** Port instalado pela Loja. */
export interface StoreInstall extends InstalledVersion {
  portId: string;
  /** Jogo na biblioteca (null se foi removido de lá). */
  gameId: number | null;
  /** Versão anterior mantida para voltar sem baixar (null = não há). */
  previous: InstalledVersion | null;
}

/**
 * Atualização disponível para a versão instalada: uma versão mais nova na lista (o GitHub lista da
 * mais nova para a mais antiga), ou a mesma tag republicada com outro arquivo (ex.: "ci-dev-build").
 */
export function availableUpdate(releases: readonly StoreRelease[], installed: Pick<InstalledVersion, 'tag' | 'sha256'>): StoreRelease | null {
  const target = chooseRelease(releases);
  if (!target?.windowsAsset) return null;
  if (target.tag === installed.tag) {
    const published = target.windowsAsset.sha256;
    return published && published !== installed.sha256 ? target : null;
  }
  const targetIndex = releases.indexOf(target);
  const installedIndex = releases.findIndex((r) => r.tag === installed.tag);
  // Versão instalada fora da lista (mais antiga que as 10 últimas) também conta como desatualizada.
  return installedIndex === -1 || targetIndex < installedIndex ? target : null;
}

export type InstallPhase = 'preparing' | 'downloading' | 'verifying' | 'extracting' | 'installer' | 'finishing';

export interface InstallProgress {
  portId: string;
  phase: InstallPhase;
  /** Bytes baixados ou arquivos extraídos, conforme a fase. */
  done: number;
  total: number;
}

/** Formato de token do GitHub: clássico (ghp_…) ou fine-grained (github_pat_…). Validado na tela e no main. */
export const GITHUB_TOKEN_PATTERN = /^(gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255})$/;
export const GITHUB_TOKEN_HINT = 'Isso não parece um token do GitHub: ele começa com github_pat_ (ou ghp_, nos tokens clássicos).';

/** Conta do GitHub vinculada e o limite de consultas atual (a consulta do limite não gasta consulta). */
export interface GitHubStatus {
  login: string | null;
  /** null quando não deu para consultar (sem internet). */
  rate: { limit: number; remaining: number; resetAt: string } | null;
}

export interface StoreRelease {
  tag: string;
  name: string;
  publishedAt: string | null;
  prerelease: boolean;
  /** Notas da versão em texto (Markdown cru, cortado num tamanho seguro). */
  notes: string;
  htmlUrl: string;
  /** Arquivo de Windows escolhido pela regex do catálogo; null se a versão não tem um. */
  windowsAsset: StoreAsset | null;
}
