import { app, BrowserWindow, dialog, powerSaveBlocker, session, shell, utilityProcess } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { handleSquirrelEvent } from './squirrel';
import { openDatabase, type Db } from '../db/connection';
import { AppService } from '../services/appService';
import { CompanyService } from '../services/companyService';
import { PropertyService } from '../services/propertyService';
import { BusinessTypeService } from '../services/businessTypeService';
import { CategoryService } from '../services/categoryService';
import { IncomeService } from '../services/incomeService';
import { ExpenseService } from '../services/expenseService';
import { FinancialService } from '../services/financialService';
import { ReceiptFiles } from '../services/receiptFiles';
import { ReceiptService } from '../services/receiptService';
import { ReportService } from '../services/reportService';
import { PoolExecutor, type Spawn } from '../services/ocr/executors';
import { missingOcrResources, resolveOcrResources } from '../services/ocr/resources';
import { RECEIPT_EVENT_CHANNEL } from '../shared/ipc';
import os from 'node:os';
import { createLogger } from './log';
import { BackupManager } from './backupManager';
import { BackupConfigStore, BackupService, preUpgradeSnapshotter } from '../services/backup/backupService';
import { chooseUserDataDir, resolveDataPaths } from '../platform/paths';
import { isTrustedSender, registerIpc } from './ipc';

// Vite plugin globals (see forge-vite-env.d.ts)
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

if (handleSquirrelEvent()) app.quit();

// Choose the data root before anything reads app.getPath('userData'),
// including the single-instance lock.
app.setPath(
  'userData',
  chooseUserDataDir({
    isPackaged: app.isPackaged,
    envOverride: process.env.GABLE_DATA_DIR,
    osUserData: app.getPath('userData'),
    cwd: process.cwd(),
  }),
);

const DEV_URL = typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === 'string' ? MAIN_WINDOW_VITE_DEV_SERVER_URL : undefined;
const ALLOWED_ORIGINS = DEV_URL ? [new URL(DEV_URL).origin] : ['file://'];

// Dev needs inline/eval for the Vite HMR client; the built app does not.
const CSP = DEV_URL
  ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://localhost:*; object-src 'none'; base-uri 'none'; form-action 'none'"
  : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

let mainWindow: BrowserWindow | null = null;

/** Base64 of the bundled fonts, read once, so printed reports never depend on installed or network fonts. */
let fontCache: { sans: string | null; serif: string | null } | null = null;
function reportFonts(): { sans: string | null; serif: string | null } {
  if (fontCache) return fontCache;
  const dirs = app.isPackaged
    ? [path.join(__dirname, '..', 'renderer', MAIN_WINDOW_VITE_NAME, 'assets')]
    : [path.join(process.cwd(), 'node_modules', '@fontsource-variable', 'inter', 'files'), path.join(process.cwd(), 'node_modules', '@fontsource-variable', 'source-serif-4', 'files')];
  const find = (prefix: string): string | null => {
    for (const d of dirs) {
      try {
        const f = fs.readdirSync(d).find((n) => n.startsWith(prefix) && n.endsWith('.woff2'));
        if (f) return fs.readFileSync(path.join(d, f)).toString('base64');
      } catch { /* try the next folder */ }
    }
    return null;
  };
  fontCache = { sans: find('inter-latin-wght-normal'), serif: find('source-serif-4-latin-wght-normal') };
  return fontCache;
}

/** Prints HTML to PDF in a hidden, script-free window with its own session, so the app's security policy and data stay out of it. */
async function renderPdf(html: string, opts: { landscape: boolean; footerTemplate: string }): Promise<Uint8Array> {
  const file = path.join(app.getPath('temp'), `gable-report-${process.pid}-${Date.now()}.html`);
  fs.writeFileSync(file, html, 'utf8');
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, session: session.fromPartition('gable-report-print') },
  });
  try {
    await win.loadFile(file);
    return await win.webContents.printToPDF({
      pageSize: 'Letter', landscape: opts.landscape, printBackground: true, displayHeaderFooter: true,
      headerTemplate: '<span></span>', footerTemplate: opts.footerTemplate,
      margins: { top: 0.55, bottom: 0.75, left: 0.5, right: 0.5 },
    });
  } finally {
    win.destroy();
    fs.rmSync(file, { force: true });
  }
}
let db: Db | null = null;
let ocr: PoolExecutor | null = null;
let diag: (message: string) => void = () => {};

/**
 * While Gable is reading receipts (or making a backup) it must not be put to sleep by the operating system.
 * macOS "App Nap" can freeze a window that is behind others, which would stall the work and its timeouts.
 */
let keepAwakeCount = 0;
let keepAwakeId: number | null = null;
function keepAwake(on: boolean): void {
  keepAwakeCount = Math.max(0, keepAwakeCount + (on ? 1 : -1));
  if (keepAwakeCount > 0 && keepAwakeId === null) keepAwakeId = powerSaveBlocker.start('prevent-app-suspension');
  if (keepAwakeCount === 0 && keepAwakeId !== null) { powerSaveBlocker.stop(keepAwakeId); keepAwakeId = null; }
}
let dbClosedForRestore = false;
let backupManager: BackupManager | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    // Small enough for 1366x768 at 150% scaling (about 910x512 usable DIPs).
    minWidth: 800,
    minHeight: 500,
    show: false,
    backgroundColor: '#F7F5F0',
    title: 'Gable',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: false,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // The UI never navigates away or opens windows; external links go to the OS browser.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedSender(url, ALLOWED_ORIGINS, true)) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (DEV_URL) void mainWindow.loadURL(DEV_URL);
  else void mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
}

function hardenSession(): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, _perm, callback) => callback(false));
  ses.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] },
    });
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(() => {
    const paths = resolveDataPaths(app.getPath('userData'));
    for (const dir of [paths.root, paths.receipts, paths.backups, paths.staging, paths.logos]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    db = openDatabase(paths.database, { beforeUpgrade: preUpgradeSnapshotter(path.join(paths.backups, 'pre-upgrade')) });
    const companies = new CompanyService(db, paths.logos);
    const files = new ReceiptFiles(paths.receipts, paths.staging);
    const expenses = new ExpenseService(db, companies, files);

    // Receipt reading runs in worker threads, never on the main thread. Everything it needs ships with the app.
    const resources = resolveOcrResources({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, projectDir: process.cwd() });
    const missing = missingOcrResources(resources);
    if (missing.length) console.error('[ocr] bundled files missing:', missing.join(', '));
    // Worker files must be real files on disk, so a packaged build runs them from the unpacked folder.
    const workerFile = path.join(__dirname, 'ocrWorker.cjs').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
    const logger = createLogger(path.join(paths.root, 'logs'));
    logger.log(`start gable ${app.getVersion()} ${process.platform} ${process.arch}`);
    diag = (m) => logger.log(m);
    process.on('uncaughtException', (e) => logger.log(`uncaught exception: ${e instanceof Error ? e.stack ?? e.message : String(e)}`));
    process.on('unhandledRejection', (e) => logger.log(`unhandled rejection: ${e instanceof Error ? e.stack ?? e.message : String(e)}`));
    // Diagnostics: note it in the log if the main process stops running its timers for a while.
    let lastBeat = Date.now();
    setInterval(() => {
      const now = Date.now();
      if (now - lastBeat > 2500) logger.log(`main process was unresponsive for ${now - lastBeat - 1000} ms`);
      lastBeat = now;
    }, 1000).unref();
    // Each reader is its own operating-system process, so a reader that gets stuck can be killed for real:
    // it can never freeze Gable or stop it from quitting, and a crash there cannot take Gable down.
    const spawn: Spawn = () => {
      logger.log('reader: spawning');
      const child = utilityProcess.fork(workerFile, [JSON.stringify(resources)], { serviceName: 'Gable reader', stdio: 'ignore' });
      child.on('spawn', () => logger.log(`reader: spawned pid ${child.pid}`));
      child.on('exit', (code) => logger.log(`reader: exited code ${code}`));
      return {
        postMessage: (m) => child.postMessage(m),
        onMessage: (cb) => { const f = (m: unknown) => cb(m as never); child.on('message', f); return () => { child.off('message', f); }; },
        onExit: (cb) => { const f = () => cb(); child.on('exit', f); return () => { child.off('exit', f); }; },
        kill: () => {
          const pid = child.pid;
          child.kill();
          // A process stuck in native code may ignore a polite stop.
          if (pid) setTimeout(() => { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }, 1000).unref();
        },
      };
    };
    ocr = new PoolExecutor(spawn, Math.max(1, Math.min(2, os.cpus().length - 1)), (e) => { if (e.phase === 'start') keepAwake(true); else if (e.phase === 'done') keepAwake(false); logger.log(`ocr job=${e.id} ${e.type} ${e.phase}${e.detail ? ` ${e.detail}` : ''}${e.ms !== undefined ? ` ${e.ms}ms` : ''}${e.code ? ` ${e.code}` : ''}`); });
    const properties = new PropertyService(db, companies);
    const receipts = new ReceiptService(db, companies, expenses, files, ocr, { concurrency: 2 });
    receipts.onEvent((e) => {
      for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(RECEIPT_EVENT_CHANNEL, e);
    });
    receipts.recoverInterrupted();

    const backupService = new BackupService({ paths, getDb: () => db!, files, appVersion: app.getVersion() });
    const backups = new BackupManager(
      backupService, new BackupConfigStore(paths.root), { root: paths.root, backups: paths.backups },
      {
        chooseFolder: async () => {
          // Automated tests set this to skip the native dialog.
          if (process.env.GABLE_TEST_BACKUP_DIR) return process.env.GABLE_TEST_BACKUP_DIR;
          const r = await dialog.showOpenDialog(mainWindow ?? undefined!, { title: 'Choose a folder for backups', properties: ['openDirectory', 'createDirectory'] });
          return r.canceled ? null : (r.filePaths[0] ?? null);
        },
        chooseBackupFile: async () => {
          if (process.env.GABLE_TEST_RESTORE_FILE) return process.env.GABLE_TEST_RESTORE_FILE;
          const r = await dialog.showOpenDialog(mainWindow ?? undefined!, { title: 'Choose a Gable backup', properties: ['openFile'], filters: [{ name: 'Gable backup', extensions: ['zip'] }] });
          return r.canceled ? null : (r.filePaths[0] ?? null);
        },
      },
    );
    backupManager = backups;
    backups.startScheduler(Number(process.env.GABLE_TEST_AUTO_BACKUP_DELAY_MS) || 15_000);

    registerIpc(
      {
        app: new AppService({ db, name: app.getName(), version: app.getVersion(), platform: process.platform }),
        companies,
        properties,
        businessTypes: new BusinessTypeService(db),
        income: new IncomeService(db, companies),
        categories: new CategoryService(db, companies),
        expenses,
        financials: new FinancialService(db),
        receipts,
        reports: new ReportService(db, companies, properties),
        backups,
      },
      {
        openFile: (p) => shell.openPath(p),
        closeDatabaseForRestore: () => {
          receipts.stopAll();
          void ocr?.shutdown();
          db?.close();
          db = null;
          dbClosedForRestore = true;
        },
        databaseWasClosed: () => dbClosedForRestore,
        restartApp: () => {
          // Tests set this so the test can reopen the app itself.
          if (process.env.GABLE_TEST_NO_RELAUNCH) { app.exit(0); return; }
          app.relaunch();
          app.exit(0);
        },
        chooseSavePath: async (defaultName, filterName, ext) => {
          // Automated tests set this to skip the native dialog; people never see or need it.
          const testDir = process.env.GABLE_TEST_EXPORT_DIR;
          if (testDir) return path.join(testDir, defaultName);
          const r = await dialog.showSaveDialog(mainWindow ?? undefined!, {
            title: 'Save report',
            defaultPath: path.join(app.getPath('documents'), defaultName),
            filters: [{ name: filterName, extensions: [ext] }],
          });
          return r.canceled || !r.filePath ? null : r.filePath;
        },
        renderPdf: (html, opts) => renderPdf(html, opts),
        fonts: () => reportFonts(),
        chooseReceiptFiles: async () => {
          const r = await dialog.showOpenDialog(mainWindow ?? undefined!, {
            title: 'Choose receipts',
            properties: ['openFile', 'multiSelections'],
            filters: [{ name: 'Receipts (JPG, PNG, PDF)', extensions: ['jpg', 'jpeg', 'png', 'pdf'] }],
          });
          return r.canceled ? [] : r.filePaths;
        },
        chooseImageFile: async () => {
          const r = await dialog.showOpenDialog(mainWindow ?? undefined!, {
            title: 'Choose a company logo',
            properties: ['openFile'],
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
          });
          return r.canceled ? null : (r.filePaths[0] ?? null);
        },
      },
      ALLOWED_ORIGINS,
    );
    hardenSession();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('before-quit', () => {
    diag('quit: starting');
    backupManager?.stopScheduler();
    void ocr?.shutdown();
    diag('quit: readers stopped');
    db?.close();
    db = null;
    diag('quit: database closed');
    // A reading thread stuck in native code cannot be stopped politely and would keep Gable running
    // in the background after its window closes. Give it a moment, then exit for real.
    setTimeout(() => { diag('quit: forcing exit'); app.exit(0); }, 3000).unref();
  });
  app.on('will-quit', () => diag('quit: will-quit'));
  app.on('quit', () => diag('quit: done'));
}
