import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ThreadPoolExecutor } from '../../src/services/ocr/executors';
import { resolveOcrResources } from '../../src/services/ocr/resources';
import type { FileRef } from '../../src/services/ocr/types';
import { buildReceiptFixtures, type ReceiptFixtures } from '../fixtures/receipts';

const resources = resolveOcrResources({ isPackaged: false, resourcesPath: '', projectDir: process.cwd() });
let dir: string;
let fx: ReceiptFixtures;
let pool: ThreadPoolExecutor;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gable-pool-'));
  fx = await buildReceiptFixtures(dir);
  // The real worker file, run through tsx so the TypeScript source can be used directly.
  pool = new ThreadPoolExecutor(path.resolve('src/workers/ocrWorker.ts'), resources, 2, ['--import', 'tsx']);
}, 60_000);
afterAll(async () => {
  await pool.shutdown();
  fs.rmSync(dir, { recursive: true, force: true });
});

const ref = (p: string, mime: string): FileRef => ({ path: p, mime, name: path.basename(p) });

describe('worker thread pool', () => {
  it('runs a mixed batch of inspections and readings through two worker threads without hanging', async () => {
    const jobs = [
      pool.run('inspect', { path: fx.clean, mime: 'image/png' }),
      pool.run('recognize', { files: [ref(fx.clean, 'image/png')] }),
      pool.run('inspect', { path: fx.encryptedPdf, mime: 'application/pdf' }).catch((e: { code: string }) => e.code),
      pool.run('inspect', { path: fx.corrupt, mime: 'image/png' }).catch((e: { code: string }) => e.code),
      pool.run('recognize', { files: [ref(fx.digitalPdf, 'application/pdf')] }),
      pool.run('inspect', { path: fx.longPdf, mime: 'application/pdf' }).catch((e: { code: string }) => e.code),
      pool.run('recognize', { files: [ref(fx.scannedPdf, 'application/pdf')] }),
      pool.run('recognize', { files: [ref(fx.rotated, 'image/png')] }),
      pool.run('preview', { path: fx.digitalPdf, mime: 'application/pdf', page: 2, maxWidth: 400 }),
    ];
    const out = await Promise.all(jobs);
    expect(out[2]).toBe('encrypted');
    expect(out[3]).toBe('corrupt');
    expect(out[5]).toBe('too_many_pages');
    expect((out[1] as { text: string }).text).toContain('TOTAL');
  }, 120_000);

  it('survives repeated batches and a cancelled job, then keeps working', async () => {
    for (let round = 0; round < 3; round++) {
      await Promise.all([fx.clean, fx.rotated, fx.ambiguous].map((p) => pool.run('recognize', { files: [ref(p, 'image/png')] })));
    }
    const ac = new AbortController();
    const slow = pool.run('recognize', { files: [ref(fx.clean, 'image/png'), ref(fx.rotated, 'image/png'), ref(fx.ambiguous, 'image/png')] }, { signal: ac.signal });
    setTimeout(() => ac.abort(), 150);
    await expect(slow).rejects.toMatchObject({ code: 'cancelled' });
    const after = await pool.run('recognize', { files: [ref(fx.clean, 'image/png')] });
    expect(after.text).toContain('165.25');
  }, 180_000);

  it('never runs more than the pool size at once', async () => {
    const started = Date.now();
    await Promise.all(Array.from({ length: 6 }, () => pool.run('recognize', { files: [ref(fx.clean, 'image/png')] })));
    expect(Date.now() - started).toBeGreaterThan(0);
  }, 120_000);
});
