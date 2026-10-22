import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PoolExecutor, forkSpawner, threadSpawner, type Spawn } from '../../src/services/ocr/executors';
import { resolveOcrResources } from '../../src/services/ocr/resources';
import type { FileRef } from '../../src/services/ocr/types';
import { buildReceiptFixtures, type ReceiptFixtures } from '../fixtures/receipts';

const resources = resolveOcrResources({ isPackaged: false, resourcesPath: '', projectDir: process.cwd() });
let dir: string;
let fx: ReceiptFixtures;
let pool: PoolExecutor;
let spawnFor: (kind: 'thread' | 'process') => Spawn;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gable-pool-'));
  fx = await buildReceiptFixtures(dir);
  // The real reader entry point, run through tsx so the TypeScript source can be used directly.
  const file = path.resolve('src/workers/ocrWorker.ts');
  spawnFor = (kind) => (kind === 'thread' ? threadSpawner(file, resources, ['--import', 'tsx']) : forkSpawner(file, resources, ['--import', 'tsx']));
}, 60_000);
afterAll(async () => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const ref = (p: string, mime: string): FileRef => ({ path: p, mime, name: path.basename(p) });

for (const kind of ['thread', 'process'] as const) describe(`reader pool (${kind})`, () => {
  beforeAll(() => { pool = new PoolExecutor(spawnFor(kind), 2); });
  afterAll(async () => { await pool.shutdown(); });

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

describe('a reader that stops responding', () => {
  it('is killed (even while spinning), the job is cancelled, and the pool starts a fresh reader for the next job', async () => {
    let spawned = 0;
    const hanging = forkSpawner(path.resolve('tests/unit/hangingReader.cjs'), resources);
    const healthy = spawnFor('process');
    const p = new PoolExecutor(() => (++spawned === 1 ? hanging() : healthy()), 1);
    try {
      const ac = new AbortController();
      const stuck = p.run('inspect', { path: fx.clean, mime: 'image/png' }, { signal: ac.signal });
      setTimeout(() => ac.abort(), 200);
      const t = Date.now();
      await expect(stuck).rejects.toMatchObject({ code: 'cancelled' });
      expect(Date.now() - t).toBeLessThan(3000);
      expect(await p.run('inspect', { path: fx.clean, mime: 'image/png' })).toEqual({ pages: 1, hasTextLayer: false });
      expect(spawned).toBe(2);
    } finally {
      await p.shutdown();
    }
  }, 60_000);

  it('a reader that exits on its own is reported as a failure of that job only', async () => {
    const dying = forkSpawner(path.resolve('tests/unit/dyingReader.cjs'), resources);
    const p = new PoolExecutor(dying, 1);
    try {
      await expect(p.run('inspect', { path: fx.clean, mime: 'image/png' })).rejects.toMatchObject({ code: 'failed' });
    } finally {
      await p.shutdown();
    }
  }, 30_000);
});
