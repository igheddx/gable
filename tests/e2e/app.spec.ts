import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { launch, packagedExecutable, tempDir } from './helpers';

let dataDir: string;
test.beforeEach(() => {
  dataDir = tempDir('e2e');
});
test.afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
});

test('opens, initializes the database, and reports app info over IPC', async () => {
  const app = await launch(dataDir);
  const page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: 'Welcome to Gable' })).toBeVisible(); // first run: no companies yet
  const info = await page.evaluate(() => (window as any).gable.getAppInfo());
  expect(info).toMatchObject({ ok: true, value: { name: 'Gable', schemaVersion: 5 } });
  expect(fs.existsSync(path.join(dataDir, 'data', 'gable.db'))).toBe(true);
  await app.close();
});

test('renderer is isolated: no Node, no raw filesystem/SQL, only the named API', async () => {
  const app = await launch(dataDir);
  const page = await app.firstWindow();
  const probe = await page.evaluate(() => ({
    require: typeof (globalThis as any).require,
    process: typeof (globalThis as any).process,
    api: Object.keys((window as any).gable).sort(),
  }));
  expect(probe.require).toBe('undefined');
  expect(probe.process).toBe('undefined');
  expect(probe.api).toEqual(
    ['archiveCompany', 'archiveProperty', 'chooseCompanyLogo', 'clearCompanyLogo', 'createCompany', 'createProperty', 'getAppInfo',
      'getCompanyLogo', 'getProperty', 'getSetting', 'listCompanies', 'listProperties', 'restoreCompany', 'restoreProperty',
      'setDefaultCompany', 'setSetting', 'updateCompany', 'updateProperty'].concat(
      ['archiveCategory', 'createCategory', 'createExpense', 'getExpense', 'getPropertyFinancials', 'listCategories', 'listExpenses',
        'openReceipt', 'renameCategory', 'restoreCategory', 'setCategoryGroup', 'stageReceiptFile', 'suggestVendors', 'unvoidExpense',
        'updateExpense', 'voidExpense',
        'cancelReceipt', 'createVendorRule', 'deleteVendorRule', 'getReceipt', 'importReceipts', 'listReceipts', 'listVendorRules',
        'markReceiptReviewed', 'onReceiptEvent', 'pickReceiptFiles', 'postReceipt', 'postReviewedReceipts', 'previewReceipt',
        'removeReceipt', 'retryReceipt', 'skipReceipt', 'unskipReceipt', 'updateReceipt',
        'buildReport', 'exportReportPdf', 'exportReportXlsx', 'getOverview',
        'chooseBackupFolder', 'discardRestore', 'getBackupStatus', 'inspectBackup', 'restoreBackup', 'runBackup', 'setAutoBackup',
        'useDefaultBackupFolder', 'checkReceiptFiles',
        'archiveBusinessType', 'createBusinessType', 'listBusinessTypes', 'renameBusinessType', 'restoreBusinessType',
        'createIncome', 'getPropertyCashFlow', 'listIncome', 'unvoidIncome', 'updateIncome', 'voidIncome']).sort(),
  );
  // Task-specific methods only: nothing that takes a SQL string, a file path, or a channel name.
  expect(probe.api.some((k: string) => /sql|query|exec|invoke|send|path|(?<!stageReceipt)file(?!s)/i.test(k))).toBe(false);
  await app.close();
});

test('rejects malformed IPC payloads sent from the renderer', async () => {
  const app = await launch(dataDir);
  const page = await app.firstWindow();
  const results = await page.evaluate(async () => {
    const g = (window as any).gable;
    return [
      await g.getSetting('app.demoData'),
      await g.setSetting('ui.lastVisitedNote', 12345),
      await g.getSetting({ key: 'ui.lastVisitedNote' }),
    ];
  });
  for (const r of results) expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  await app.close();
});

test('data survives an app restart', async () => {
  let app = await launch(dataDir);
  let page = await app.firstWindow();
  const set = await page.evaluate(() => (window as any).gable.setSetting('ui.lastVisitedNote', 'persisted'));
  expect(set).toEqual({ ok: true, value: null });
  await app.close();

  app = await launch(dataDir);
  page = await app.firstWindow();
  const got = await page.evaluate(() => (window as any).gable.getSetting('ui.lastVisitedNote'));
  expect(got).toEqual({ ok: true, value: 'persisted' });
  await app.close();
});

test('a second instance on the same data folder quits and does not open another window', async () => {
  const first = await launch(dataDir);
  await first.firstWindow();
  const child = spawn(packagedExecutable(), [], { env: { ...process.env, GABLE_DATA_DIR: dataDir }, stdio: 'ignore' });
  const exitCode = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve(-999); // did not quit by itself
    }, 20_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  expect(exitCode).toBe(0);
  expect(first.windows().length).toBe(1);
  await first.close();
});

test('content security policy blocks inline scripts and network requests', async () => {
  const app = await launch(dataDir);
  const page = await app.firstWindow();
  const probe = await page.evaluate(async () => {
    const s = document.createElement('script');
    s.textContent = 'window.__inlineRan = true';
    document.head.appendChild(s);
    const fetched = await fetch('https://example.com/').then(
      () => 'allowed',
      () => 'blocked',
    );
    return { inline: (window as any).__inlineRan === true, fetched };
  });
  expect(probe).toEqual({ inline: false, fetched: 'blocked' });
  await app.close();
});
