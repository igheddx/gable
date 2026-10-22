import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDemoData } from '../../scripts/demo-data';

export function packagedExecutable(): string {
  const out = path.resolve('out');
  const dir = fs.readdirSync(out).find((d) => d.startsWith('Gable-'));
  if (!dir) throw new Error('Run `npm run test:e2e` (it packages first)');
  const base = path.join(out, dir);
  if (process.platform === 'darwin') return path.join(base, 'Gable.app', 'Contents', 'MacOS', 'Gable');
  return path.join(base, process.platform === 'win32' ? 'Gable.exe' : 'Gable');
}

export const tempDir = (prefix: string): string => fs.mkdtempSync(path.join(os.tmpdir(), `gable-${prefix}-`));

/** A fresh isolated data folder with the fictional demo companies and properties (default company: Cedar Homes). */
export function demoDir(): string {
  const dir = tempDir('demo');
  buildDemoData(dir);
  return dir;
}

export const launch = (dataDir: string): Promise<ElectronApplication> =>
  electron.launch({ executablePath: packagedExecutable(), env: { ...process.env, GABLE_DATA_DIR: dataDir } });

export const go = async (page: Page, hash: string): Promise<void> => {
  await page.evaluate((h) => { window.location.hash = h; }, hash);
};

export const switchCompany = async (page: Page, name: RegExp): Promise<void> => {
  await page.locator('#company-switcher').waitFor();
  const options = await page.locator('#company-switcher option').allTextContents();
  const match = options.find((o) => name.test(o));
  if (!match) throw new Error(`No company option matching ${name}`);
  await page.locator('#company-switcher').selectOption({ label: match });
};
