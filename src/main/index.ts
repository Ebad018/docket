import { join } from 'node:path';
import { app, BrowserWindow, shell } from 'electron';
import { compose, type Application } from './composition';
import { registerIpc } from './ipc/router';
import { Channel } from '@shared/ipc';

let application: Application | null = null;
let mainWindow: BrowserWindow | null = null;

/** Files handed to the .exe by Explorer's "Open with", queued until the
 *  renderer is ready to receive them. */
const queuedPaths: string[] = [];

const collectPathArguments = (argv: readonly string[]): string[] =>
  argv
    .slice(app.isPackaged ? 1 : 2)
    .filter((argument) => !argument.startsWith('-') && /\.[a-z0-9]+$/i.test(argument));

const createWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 620,
    show: false,
    frame: false,
    // The chrome is painted by the renderer, so the native frame is replaced by
    // a custom title bar. This colour is the console ground behind it, which
    // stops a white flash before the first paint.
    backgroundColor: '#171a16',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true
    }
  });

  window.once('ready-to-show', () => {
    window.show();
    if (queuedPaths.length > 0) {
      window.webContents.send('app:open-paths', queuedPaths.splice(0));
    }
  });

  const notifyWindowState = () =>
    window.webContents.send(Channel.windowStateChanged, {
      maximized: window.isMaximized(),
      focused: window.isFocused()
    });

  window.on('maximize', notifyWindowState);
  window.on('unmaximize', notifyWindowState);
  window.on('focus', notifyWindowState);
  window.on('blur', notifyWindowState);

  // Nothing in Docket needs a second window or an in-app browser. Links go to
  // the user's own browser, and in-place navigation is refused outright.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://') && !url.startsWith(process.env.ELECTRON_RENDERER_URL ?? '\0')) {
      event.preventDefault();
      if (/^https?:/i.test(url)) void shell.openExternal(url);
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return window;
};

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const paths = collectPathArguments(argv);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      if (paths.length > 0) mainWindow.webContents.send('app:open-paths', paths);
    } else {
      queuedPaths.push(...paths);
    }
  });

  app.on('open-file', (event, path) => {
    event.preventDefault();
    if (mainWindow) mainWindow.webContents.send('app:open-paths', [path]);
    else queuedPaths.push(path);
  });

  void app.whenReady().then(() => {
    app.setAppUserModelId('io.github.ebad018.docket');
    queuedPaths.push(...collectPathArguments(process.argv));

    application = compose();
    registerIpc(application);

    mainWindow = createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    void application?.dispose();
  });
}
