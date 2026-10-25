/** Atualização do próprio RetroVault (versões publicadas nas Releases do repositório do app). */
export type AppUpdatePhase =
  /** Só o app instalado se atualiza (a pasta de desenvolvimento e o modo dev não). */
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  /** Achou versão nova e está baixando. */
  | 'downloading'
  /** Baixada e conferida: instala ao reiniciar (ou ao fechar o app). */
  | 'ready'
  | 'error';

export interface AppUpdateState {
  /** Versão em uso. */
  current: string;
  phase: AppUpdatePhase;
  /** Versão nova (em downloading e ready). */
  version?: string;
  /** 0–100 durante o download. */
  percent?: number;
  /** Quando conferiu pela última vez (ms desde 1970). */
  checkedAt?: number;
  /** Mensagem de erro (phase error) ou o motivo de estar desligado (phase disabled). */
  message?: string;
  /** Página das versões, para quem quiser ver as notas ou baixar à mão. */
  releasesUrl: string;
}
