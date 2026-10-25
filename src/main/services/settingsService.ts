import { safeStorage } from 'electron';
import type { Settings, SettingsUpdate } from '@shared/types';
import type { SettingsRepository } from '../db/repositories/settingsRepository';

const KEYS = {
  retroarchPath: 'retroarch.path',
  raUsername: 'ra.username',
  raApiKey: 'ra.apiKey',
  hardcoreMode: 'ra.hardcoreMode',
  notifyAchievements: 'ra.notifyAchievements',
  trophyKey: 'ps4.trophyKey',
  savesRoot: 'saves.root',
  autoBackupSaves: 'saves.autoBackup',
  githubLogin: 'github.login',
  githubToken: 'github.token',
  sgdbKey: 'sgdb.key',
  storeCatalogUrl: 'store.catalogUrl',
  notifyPortUpdates: 'store.notifyUpdates',
  discordPresence: 'discord.presence',
} as const;

export interface RaCredentials {
  username: string;
  apiKey: string;
}

type ChangeListener = (next: Settings, previous: Settings) => void;

export class SettingsService {
  private readonly listeners = new Set<ChangeListener>();
  private credentialsCache: RaCredentials | null | undefined;
  private githubTokenCache: string | null | undefined;

  constructor(
    private readonly repo: SettingsRepository,
    /** Documentos\RetroVault\Saves: fora das pastas dos jogos, sobrevive a apagar um jogo. */
    private readonly defaultSavesRoot: string,
  ) {}

  /** Pasta local padrão do cofre (para onde ele volta ao desconectar a nuvem). */
  get localSavesRoot(): string {
    return this.defaultSavesRoot;
  }

  /** Troca a pasta do cofre (a movimentação dos arquivos é feita pelo chamador). */
  setSavesRoot(root: string): Settings {
    const previous = this.get();
    this.repo.set(KEYS.savesRoot, root);
    const next = this.get();
    this.listeners.forEach((listener) => listener(next, previous));
    return next;
  }

  get(): Settings {
    return {
      retroarchPath: this.repo.get<string | null>(KEYS.retroarchPath, null),
      raUsername: this.repo.get<string | null>(KEYS.raUsername, null),
      hasApiKey: this.repo.get<string | null>(KEYS.raApiKey, null) !== null,
      hardcoreMode: this.repo.get(KEYS.hardcoreMode, false),
      notifyAchievements: this.repo.get(KEYS.notifyAchievements, true),
      hasTrophyKey: this.repo.get<string | null>(KEYS.trophyKey, null) !== null,
      savesRoot: this.repo.get<string | null>(KEYS.savesRoot, null) ?? this.defaultSavesRoot,
      autoBackupSaves: this.repo.get(KEYS.autoBackupSaves, true),
      githubLogin: this.repo.get<string | null>(KEYS.githubToken, null) ? this.repo.get<string | null>(KEYS.githubLogin, null) : null,
      hasSgdbKey: this.repo.get<string | null>(KEYS.sgdbKey, null) !== null,
      storeCatalogUrl: this.repo.get<string | null>(KEYS.storeCatalogUrl, null),
      notifyPortUpdates: this.repo.get(KEYS.notifyPortUpdates, true),
      discordPresence: this.repo.get(KEYS.discordPresence, true),
    };
  }

  /** Chave da API do SteamGridDB (validada pelo chamador); null remove. Cifrada como os outros segredos. */
  setSgdbKey(key: string | null): Settings {
    return this.change(() => this.repo.set(KEYS.sgdbKey, key ? this.encrypt(key) : null));
  }

  getSgdbKey(): string | null {
    const stored = this.repo.get<string | null>(KEYS.sgdbKey, null);
    if (!stored) return null;
    try {
      return this.decrypt(stored);
    } catch (err) {
      console.error('[settings] não foi possível decifrar a chave do SteamGridDB', err);
      return null;
    }
  }

  /** URL do catálogo online da Loja (já testada pelo chamador); null volta ao catálogo embutido. */
  setStoreCatalogUrl(url: string | null): Settings {
    return this.change(() => this.repo.set(KEYS.storeCatalogUrl, url));
  }

  private change(apply: () => void): Settings {
    const previous = this.get();
    apply();
    const next = this.get();
    this.listeners.forEach((listener) => listener(next, previous));
    return next;
  }

  /**
   * Conta do GitHub (só depois de validada pelo chamador). null desconecta.
   * O token é cifrado como a API key do RA e nunca sai do processo principal.
   */
  setGitHubAccount(account: { login: string; token: string } | null): Settings {
    return this.change(() => {
      this.repo.transaction(() => {
        this.repo.set(KEYS.githubLogin, account?.login ?? null);
        this.repo.set(KEYS.githubToken, account ? this.encrypt(account.token) : null);
      });
      this.githubTokenCache = undefined;
    });
  }

  getGitHubToken(): string | null {
    if (this.githubTokenCache !== undefined) return this.githubTokenCache;
    const stored = this.repo.get<string | null>(KEYS.githubToken, null);
    let token: string | null = null;
    if (stored) {
      try {
        token = this.decrypt(stored);
      } catch (err) {
        console.error('[settings] não foi possível decifrar o token do GitHub', err);
      }
    }
    this.githubTokenCache = token;
    return token;
  }

  /** Trophy key do PS4 (16 bytes), decifrada só quando necessária. */
  getTrophyKey(): Buffer | null {
    const stored = this.repo.get<string | null>(KEYS.trophyKey, null);
    if (!stored) return null;
    try {
      return Buffer.from(this.decrypt(stored), 'hex');
    } catch (err) {
      console.error('[settings] não foi possível decifrar a trophy key', err);
      return null;
    }
  }

  update(patch: SettingsUpdate): Settings {
    const previous = this.get();
    this.repo.transaction(() => {
      if (patch.retroarchPath !== undefined) this.repo.set(KEYS.retroarchPath, patch.retroarchPath?.trim() || null);
      if (patch.raUsername !== undefined) this.repo.set(KEYS.raUsername, patch.raUsername?.trim() || null);
      if (patch.raApiKey !== undefined) {
        const key = patch.raApiKey.trim();
        this.repo.set(KEYS.raApiKey, key ? this.encrypt(key) : null);
      }
      if (patch.hardcoreMode !== undefined) this.repo.set(KEYS.hardcoreMode, patch.hardcoreMode);
      if (patch.notifyAchievements !== undefined) this.repo.set(KEYS.notifyAchievements, patch.notifyAchievements);
      if (patch.autoBackupSaves !== undefined) this.repo.set(KEYS.autoBackupSaves, patch.autoBackupSaves);
      if (patch.notifyPortUpdates !== undefined) this.repo.set(KEYS.notifyPortUpdates, patch.notifyPortUpdates);
      if (patch.discordPresence !== undefined) this.repo.set(KEYS.discordPresence, patch.discordPresence);
      if (patch.trophyKey !== undefined) {
        const key = patch.trophyKey.trim().toLowerCase();
        this.repo.set(KEYS.trophyKey, key ? this.encrypt(key) : null);
      }
    });
    this.credentialsCache = undefined;
    const next = this.get();
    this.listeners.forEach((listener) => listener(next, previous));
    return next;
  }

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getRaCredentials(): RaCredentials | null {
    if (this.credentialsCache !== undefined) return this.credentialsCache;
    const username = this.repo.get<string | null>(KEYS.raUsername, null);
    const stored = this.repo.get<string | null>(KEYS.raApiKey, null);
    let credentials: RaCredentials | null = null;
    if (username && stored) {
      try {
        credentials = { username, apiKey: this.decrypt(stored) };
      } catch (err) {
        // Ex.: perfil do Windows mudou e o DPAPI não consegue mais decifrar.
        console.error('[settings] não foi possível decifrar a API key', err);
      }
    }
    this.credentialsCache = credentials;
    return credentials;
  }

  // A API key é cifrada com DPAPI (Windows) / Keychain (macOS) via safeStorage.
  private encrypt(value: string): string {
    if (safeStorage.isEncryptionAvailable()) {
      return `enc:${safeStorage.encryptString(value).toString('base64')}`;
    }
    return `raw:${value}`;
  }

  private decrypt(value: string): string {
    if (value.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'));
    if (value.startsWith('raw:')) return value.slice(4);
    return value;
  }
}
