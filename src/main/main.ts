import { app, BrowserWindow, dialog, session, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import squirrelStartup from 'electron-squirrel-startup';
import { openDatabase, type Db } from '../db/connection';
import { AppService } from '../services/appService';
import { CompanyService } from '../services/companyService';
import { PropertyService } from '../services/propertyService';
import { CategoryService } from '../services/categoryService';
import { ExpenseService } from '../services/expenseService';
import { FinancialService } from '../services/financialService';
import { ReceiptFiles } from '../services/receiptFiles';
import { ReceiptService } from '../services/receiptService';
import { ReportService } from '../services/reportService';
import { ThreadPoolExecutor } from '../services/ocr/executors';
import { missingOcrResources, resolveOcrResources } from '../services/ocr/resources';
import { RECEIPT_EVENT_CHANNEL } from '../shared/ipc';
import os from 'node:os';
import { createLogger } from './log';
import { chooseUserDataDir, resolveDataPaths } from '../platform/paths';
import { isTrustedSender, registerIpc } from './ipc';

// Vite plugin globals (see forge-vite-env.d.ts)
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

if (process.platform === 'win32' && squirrelStartup) app.quit();

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
let ocr: ThreadPoolExecutor | null = null;

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
    db = openDatabase(paths.database);
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
    ocr = new ThreadPoolExecutor(workerFile, resources, Math.max(1, Math.min(2, os.cpus().length - 1)), [], (e) => logger.log(`ocr job=${e.id} ${e.type} ${e.phase}${e.detail ? ` ${e.detail}` : ''}${e.ms !== undefined ? ` ${e.ms}ms` : ''}${e.code ? ` ${e.code}` : ''}`));
    const properties = new PropertyService(db, companies);
    const receipts = new ReceiptService(db, companies, expenses, files, ocr, { concurrency: 2 });
    receipts.onEvent((e) => {
      for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(RECEIPT_EVENT_CHANNEL, e);
    });
    receipts.recoverInterrupted();

    registerIpc(
      {
        app: new AppService({ db, name: app.getName(), version: app.getVersion(), platform: process.platform }),
        companies,
        properties,
        categories: new CategoryService(db, companies),
        expenses,
        financials: new FinancialService(db),
        receipts,
        reports: new ReportService(db, companies, properties),
      },
      {
        openFile: (p) => shell.openPath(p),
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
    void ocr?.shutdown();
    db?.close();
    db = null;
    // A reading thread stuck in native code cannot be stopped politely and would keep Gable running
    // in the background after its window closes. Give it a moment, then exit for real.
    setTimeout(() => app.exit(0), 3000).unref();
  });
}
