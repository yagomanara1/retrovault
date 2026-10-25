// Mods dos ports (GameBanana). O app só baixa os arquivos publicados no GameBanana para a pasta de mods
// do port instalado; nada de jogo é distribuído.

/** Onde o port procura mods e quais arquivos ele lê (do catálogo). */
export interface PortMods {
  /** Id do jogo no GameBanana (gamebanana.com/games/<id>). */
  gamebanana: number;
  /** Pasta dos mods, relativa à pasta do port instalado (ex.: "mods"). */
  folder: string;
  /** Extensões que o port carrega (ex.: [".otr", ".o2r"]). O resto do pacote do mod é ignorado. */
  extensions: string[];
}

export type ModSort = 'popular' | 'newest' | 'downloads';

/** Um mod na lista (resumo). `thumb` já é local (rv-media://) ou null. */
export interface ModSummary {
  id: number;
  name: string;
  category: string | null;
  author: string | null;
  likes: number;
  version: string | null;
  updatedAt: number | null;
  thumb: string | null;
  url: string;
}

export interface ModListResult {
  mods: ModSummary[];
  total: number;
  page: number;
  hasMore: boolean;
}

export interface ModFile {
  id: number;
  name: string;
  size: number;
  /** Resultado da análise de vírus do GameBanana ("ok" = limpo). */
  scanOk: boolean;
  description: string | null;
}

export interface ModDetails extends ModSummary {
  /** Texto do mod sem HTML (para ler; os links ficam no "ver no GameBanana"). */
  text: string;
  images: string[];
  downloads: number;
  files: ModFile[];
}

/** Mod instalado num port (os arquivos são relativos à pasta do port). */
export interface InstalledMod {
  modId: number;
  fileId: number;
  name: string;
  version: string | null;
  files: string[];
  installedAt: string;
}

export interface ModProgress {
  portId: string;
  modId: number;
  received: number;
  total: number;
}
