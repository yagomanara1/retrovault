import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, net, Notification, protocol, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import { createContainer } from './container';
import { openDatabase } from './db/database';
import { registerIpc } from './ipc';
import { ARTWORK_SCHEME } from './services/artworkService';
import { applyPendingRestore, snapshotTo } from './services/backupService';
import { runInstaller } from './services/store/runInstaller';

let mainWindow: BrowserWindow | null = null;

// Precisa ser registrado antes do app ficar pronto.
protocol.registerSchemesAsPrivileged([
  // corsEnabled: o editor de enquadramento desenha as artes num canvas e exporta; sem CORS o canvas
  // ficaria "contaminado" e não exportaria. O conteúdo é só o cofre de artes local.
  { scheme: ARTWORK_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

function isSafeExternalUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

function isAppUrl(url: string): boolean {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  return url.startsWith('file://') || (!!devUrl && url.startsWith(devUrl));
}

/** Acrylic (vidro fosco) existe a partir do Windows 11 22H2 (build 22621). */
function supportsAcrylic(): boolean {
  if (process.platform !== 'win32') return false;
  return Number(os.release().split('.')[2] ?? 0) >= 22621;
}

const RELEASES_URL = 'https://github.com/yagomanara1/retrovault/releases';

/**
 * Só o app instalado pelo instalador se atualiza: no modo dev e na pasta win-unpacked (cópia de trabalho),
 * a atualização instalaria por cima em outro lugar. O instalador deixa o desinstalador ao lado do .exe.
 */
function updateDisabledReason(): string | null {
  if (!app.isPackaged) return 'Modo de desenvolvimento: as atualizações só valem para o RetroVault instalado.';
  const uninstaller = path.join(path.dirname(process.execPath), `Uninstall ${app.getName()}.exe`);
  if (!existsSync(uninstaller)) return 'Esta cópia não veio do instalador (ex.: a pasta win-unpacked). Para receber atualizações, use o RetroVault instalado.';
  return null;
}

function createUpdater(): typeof autoUpdater {
  autoUpdater.logger = { info: console.info, warn: console.warn, error: console.error, debug: () => {} };
  // Teste da atualização sem publicar: um servidor no próprio PC (nunca um endereço de fora).
  const testFeed = process.env.RETROVAULT_UPDATE_FEED;
  if (testFeed && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(testFeed)) autoUpdater.setFeedURL({ provider: 'generic', url: testFeed });
  return autoUpdater;
}

/** Altura da barra de título integrada (igual a --toolbar-height no CSS). */
const TITLEBAR_HEIGHT = 52;

function createMainWindow(): BrowserWindow {
  const acrylic = supportsAcrylic();
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 980,
    minHeight: 620,
    show: false,
    title: 'RetroVault',
    // Barra de título integrada ao conteúdo (como no macOS), com os botões nativos do Windows por cima.
    titleBarStyle: 'hidden',
    // Fundo transparente: aparece a barra de título da página por baixo, então ela escurece junto
    // quando uma janela (modal) abre. 1px a menos para a linha divisória continuar visível.
    titleBarOverlay: { color: '#00000000', symbolColor: '#e6e6e6', height: TITLEBAR_HEIGHT - 1 },
    // Vidro fosco do sistema atrás da barra lateral (equivalente à "vibrancy" do macOS).
    ...(acrylic ? { backgroundMaterial: 'acrylic' as const, backgroundColor: '#00000000' } : { backgroundColor: '#1e1e1e' }),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // Links externos abrem no navegador; qualquer outra navegação é bloqueada.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });

  const query = acrylic ? { material: 'acrylic' } : undefined;
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL);
    if (query) url.searchParams.set('material', query.material);
    void win.loadURL(url.toString());
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'), { query });
  }

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  return win;
}

async function bootstrap(): Promise<void> {
  if (process.platform === 'win32') app.setAppUserModelId('com.retrovault.app');

  const userDataDir = app.getPath('userData');
  const dbFile = path.join(userDataDir, 'retrovault.db');
  const backupDir = path.join(userDataDir, 'backups');
  // Restauração agendada pela tela de Configurações: troca o arquivo antes de qualquer conexão.
  applyPendingRestore(dbFile, backupDir);
  const db = openDatabase(dbFile, {
    // Atualização do app com mudança de esquema: guarda o estado anterior antes de migrar.
    beforeMigrate: (current) => snapshotTo(current, backupDir, 'pre-migration'),
  });

  const container = createContainer({
    db,
    dbFile,
    backupDir,
    userDataDir,
    appDataDir: app.getPath('appData'),
    documentsDir: app.getPath('documents'),
    homeDir: app.getPath('home'),
    localAppDataDir: process.env.LOCALAPPDATA ?? path.join(app.getPath('home'), 'AppData', 'Local'),
    programDirs: [
      process.env.ProgramFiles ?? 'C:\\Program Files',
      process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
      path.join(process.env.LOCALAPPDATA ?? path.join(app.getPath('home'), 'AppData', 'Local'), 'Programs'),
    ],
    programDataDir: process.env.ProgramData ?? 'C:\\ProgramData',
    tempDir: app.getPath('temp'),
    launcherExe: app.isPackaged ? process.execPath : null,
    // Só para testar os atalhos numa cópia da pasta da Steam (nunca usado na instalação normal).
    steamDirOverride: process.env.RETROVAULT_STEAM_DIR?.trim() || null,
    openExternal: (url) => shell.openExternal(url),
    emit: (event, payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(event, payload);
    },
    notify: (title, body, iconPath) => {
      if (Notification.isSupported()) new Notification({ title, body, icon: iconPath ?? undefined }).show();
    },
    trash: (target) => shell.trashItem(target),
    runInstaller,
    pickExecutable: async (title) => {
      const options: Electron.OpenDialogOptions = { title, properties: ['openFile'], filters: [{ name: 'Executáveis', extensions: ['exe'] }] };
      const result = mainWindow && !mainWindow.isDestroyed() ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    appUpdate: { currentVersion: app.getVersion(), releasesUrl: RELEASES_URL, disabledReason: updateDisabledReason(), createUpdater },
  });

  await container.artwork.init();
  protocol.handle(ARTWORK_SCHEME, async (request) => {
    const file = container.artwork.resolve(request.url);
    if (!file) return new Response(null, { status: 404 });
    const response = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    return new Response(response.body, { status: response.status, headers });
  });

  registerIpc(container);
  container.cache.purgeExpired();

  try {
    const upgraded = await container.games.upgradeLegacyIcons();
    if (upgraded) console.info(`[artwork] ${upgraded} ícone(s) atualizados para alta resolução`);
    // Inclui ícones de troféu e a arte dos backups: restaurar um backup não pode trazer imagens quebradas.
    await container.artwork.collectGarbage([
      ...container.games.referencedArtwork(),
      ...container.trophies.referencedArtwork(),
      ...(await container.backups.referencedArtwork()),
      ...container.storeArt.referencedArtwork(),
    ]);
  } catch (err) {
    console.warn('[artwork] manutenção inicial falhou', err);
  }
  container.trophyWatcher.start();
  void container.maintenance.startup();
  setInterval(() => container.cache.purgeExpired(), 60 * 60 * 1000).unref();
  // Backup diário: na inicialização e a cada 6 h (o app pode ficar aberto por dias).
  const dailyBackup = () => {
    void container.backups.ensureDaily().catch((err) => console.warn('[backup] falhou', err));
    container.exportProgressNextToVault();
  };
  dailyBackup();
  setInterval(dailyBackup, 6 * 60 * 60 * 1000).unref();
  setInterval(() => void container.maintenance.periodicSaveBackup(), 15 * 60 * 1000).unref();
  // Atualizações dos ports: 1 min depois de abrir (sem pesar na inicialização) e a cada 6 h.
  const checkPortUpdates = () => void container.checkPortUpdates().catch((err) => console.warn('[store] verificação de atualizações falhou', err));
  setTimeout(checkPortUpdates, 60 * 1000).unref();
  setInterval(checkPortUpdates, 6 * 60 * 60 * 1000).unref();
  // Versão nova do próprio RetroVault: 30 s depois de abrir e a cada 6 h (baixa em segundo plano).
  const checkAppUpdate = () => void container.appUpdate.check();
  setTimeout(checkAppUpdate, 30 * 1000).unref();
  setInterval(checkAppUpdate, 6 * 60 * 60 * 1000).unref();

  mainWindow = createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
  });

  app.on('before-quit', () => {
    container.watcher.stopAll();
    container.trophyWatcher.stop();
    container.launcher.closeAllSessions();
    container.snapshots.stop();
    container.discord.stop();
    db.close();
  });
}

// Pasta de dados alternativa (testes e cópias portáteis). Por variável de ambiente, e não por argumento,
// para valer também quando o instalador de uma atualização reabre o app.
if (process.env.RETROVAULT_USER_DATA_DIR) app.setPath('userData', process.env.RETROVAULT_USER_DATA_DIR);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app
    .whenReady()
    .then(bootstrap)
    .catch((err: unknown) => {
      console.error(err);
      dialog.showErrorBox('RetroVault', `Falha ao iniciar: ${err instanceof Error ? err.message : String(err)}`);
      app.quit();
    });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
