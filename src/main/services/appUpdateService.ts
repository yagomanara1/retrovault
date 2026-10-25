import type { AppUpdateState } from '@shared/appUpdate';
import { AppError } from '../errors';

/** O pedaço do `autoUpdater` (electron-updater) que o serviço usa; nos testes, um falso. */
export interface Updater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: 'checking-for-update', listener: () => void): unknown;
  on(event: 'update-available', listener: (info: { version: string }) => void): unknown;
  on(event: 'update-not-available', listener: (info: { version: string }) => void): unknown;
  on(event: 'download-progress', listener: (progress: { percent: number }) => void): unknown;
  on(event: 'update-downloaded', listener: (info: { version: string }) => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface AppUpdateDeps {
  currentVersion: string;
  releasesUrl: string;
  /** null quando este app não se atualiza (pasta de desenvolvimento): o motivo. */
  disabledReason: string | null;
  /** Criado só quando habilitado (carregar o electron-updater fora do app instalado não serve para nada). */
  createUpdater: () => Updater;
  emit: (state: AppUpdateState) => void;
  /** Ports sendo instalados: reiniciar agora interromperia o download. */
  busyReason: () => string | null;
  now?: () => number;
}

/**
 * Atualização do RetroVault pelas Releases do GitHub. Baixa sozinho em segundo plano (o electron-updater
 * confere o SHA-512 publicado no latest.yml) e instala quando o usuário pede ou ao fechar o app.
 */
export class AppUpdateService {
  private state: AppUpdateState;
  private updater: Updater | null = null;
  private inFlight: Promise<AppUpdateState> | null = null;

  constructor(private readonly deps: AppUpdateDeps) {
    this.state = deps.disabledReason
      ? { current: deps.currentVersion, phase: 'disabled', message: deps.disabledReason, releasesUrl: deps.releasesUrl }
      : { current: deps.currentVersion, phase: 'idle', releasesUrl: deps.releasesUrl };
  }

  status(): AppUpdateState {
    return this.state;
  }

  /** Procura versão nova (e baixa, se houver). Chamadas simultâneas esperam a mesma busca. */
  async check(): Promise<AppUpdateState> {
    if (this.state.phase === 'disabled') return this.state;
    // Já baixada ou baixando: nada a procurar até instalar.
    if (this.state.phase === 'ready' || this.state.phase === 'downloading') return this.state;
    if (this.inFlight) return this.inFlight;
    const updater = this.ensureUpdater();
    this.inFlight = updater
      .checkForUpdates()
      .then(() => this.state)
      .catch((err: unknown) => {
        this.set({ phase: 'error', message: friendlyError(err), checkedAt: this.now() });
        return this.state;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  /** Fecha o app e roda o instalador da versão baixada (sem perguntas), abrindo o app de novo no fim. */
  install(): void {
    if (this.state.phase !== 'ready' || !this.updater) throw new AppError('VALIDATION', 'Nenhuma atualização pronta para instalar.');
    const busy = this.deps.busyReason();
    if (busy) throw new AppError('ALREADY_RUNNING', busy);
    this.updater.quitAndInstall(true, true);
  }

  private ensureUpdater(): Updater {
    if (this.updater) return this.updater;
    const updater = this.deps.createUpdater();
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.on('checking-for-update', () => this.set({ phase: 'checking', message: undefined }));
    updater.on('update-not-available', () => this.set({ phase: 'up-to-date', version: undefined, percent: undefined, checkedAt: this.now() }));
    updater.on('update-available', (info) => this.set({ phase: 'downloading', version: info.version, percent: 0, checkedAt: this.now() }));
    updater.on('download-progress', (p) => {
      // Só repassa mudanças de 1 ponto (o evento chega muitas vezes por segundo).
      const percent = Math.floor(p.percent);
      if (percent !== this.state.percent) this.set({ phase: 'downloading', percent });
    });
    updater.on('update-downloaded', (info) => this.set({ phase: 'ready', version: info.version, percent: 100 }));
    updater.on('error', (err) => {
      // Erro depois de "pronta" (ex.: falha ao reiniciar) não apaga a versão baixada.
      if (this.state.phase !== 'ready') this.set({ phase: 'error', message: friendlyError(err), checkedAt: this.now() });
    });
    this.updater = updater;
    return updater;
  }

  private set(patch: Partial<AppUpdateState>): void {
    this.state = { ...this.state, ...patch };
    this.deps.emit(this.state);
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }
}

/** Mensagem curta para a tela (o electron-updater devolve textos longos, com a resposta HTTP inteira). */
export function friendlyError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|net::ERR_/i.test(text)) return 'Sem conexão com o GitHub agora. O RetroVault tenta de novo mais tarde.';
  if (/404|latest\.yml|Cannot find/i.test(text)) return 'A versão mais recente no GitHub ainda não tem os arquivos de atualização (latest.yml).';
  if (/sha512|checksum/i.test(text)) return 'O arquivo baixado não bate com o publicado; a atualização foi descartada.';
  return text.split('\n')[0]!.slice(0, 200);
}
