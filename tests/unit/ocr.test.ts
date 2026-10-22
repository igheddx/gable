import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { InlineExecutor } from '../../src/services/ocr/inlineExecutor';
import { missingOcrResources, resolveOcrResources } from '../../src/services/ocr/resources';
import { OcrFileError, type FileRef } from '../../src/services/ocr/types';
import { parseReceiptText } from '../../src/shared/receiptParser';
import { buildReceiptFixtures, type ReceiptFixtures } from '../fixtures/receipts';

const resources = resolveOcrResources({ isPackaged: false, resourcesPath: '', projectDir: process.cwd() });
let dir: string;
let fx: ReceiptFixtures;
let exec: InlineExecutor;
const timings: Record<string, number> = {};

const ref = (p: string, mime: string): FileRef => ({ path: p, mime, name: path.basename(p) });
const png = (p: string) => ref(p, 'image/png');
const pdf = (p: string) => ref(p, 'application/pdf');
const timed = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  const t = Date.now();
  try { return await fn(); } finally { timings[label] = Date.now() - t; }
};

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gable-ocr-'));
  fx = await buildReceiptFixtures(dir);
  exec = new InlineExecutor(resources);
}, 60_000);
afterAll(async () => {
  await exec.shutdown();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('OCR timings (ms):', JSON.stringify(timings));
});

describe('bundled OCR files', () => {
  it('are all present locally (no download is ever needed)', () => {
    expect(missingOcrResources(resources)).toEqual([]);
  });
});

describe('images', () => {
  it('reads a clean receipt and the parser finds vendor, date and the labeled total (not cash tendered)', async () => {
    const r = await timed('clean png', () => exec.run('recognize', { files: [png(fx.clean)] }));
    expect(r.source).toBe('ocr');
    const parsed = parseReceiptText(r.text, { today: '2026-10-22' });
    expect(parsed.vendor?.value).toBe('Harbor Lumber & Supply');
    expect(parsed.date?.iso).toBe('2026-09-18');
    expect(parsed.total).toMatchObject({ cents: 16_525, labeled: true });
  }, 60_000);

  it('reads a receipt that was photographed sideways', async () => {
    const r = await timed('rotated png', () => exec.run('recognize', { files: [png(fx.rotated)] }));
    expect(parseReceiptText(r.text, { today: '2026-10-22' }).total?.cents).toBe(16_525);
  }, 60_000);

  it('a poor-quality photo does not crash; whatever is read stays a suggestion', async () => {
    const r = await timed('poor jpg', () => exec.run('recognize', { files: [ref(fx.poor, 'image/jpeg')] }));
    expect(typeof r.text).toBe('string');
    expect(r.confidence === null || (r.confidence >= 0 && r.confidence <= 100)).toBe(true);
  }, 60_000);

  it('flags a receipt with two different totals as ambiguous', async () => {
    const r = await timed('ambiguous png', () => exec.run('recognize', { files: [png(fx.ambiguous)] }));
    const t = parseReceiptText(r.text, { today: '2026-10-22' }).total!;
    expect(t.ambiguous).toBe(true);
    expect(t.candidates).toEqual(expect.arrayContaining([12_000, 13_500]));
  }, 60_000);

  it('treats several images as the pages of one receipt', async () => {
    const r = await timed('two-page images', () => exec.run('recognize', { files: [png(fx.page1), png(fx.page2)] }));
    expect(r.pageCount).toBe(2);
    expect(r.text).toMatch(/--- page 1 ---[\s\S]*--- page 2 ---/);
    expect(parseReceiptText(r.text, { today: '2026-10-22' }).total?.cents).toBe(420_000);
  }, 90_000);

  it('rejects a damaged image with a clear message', async () => {
    await expect(exec.run('inspect', { path: fx.corrupt, mime: 'image/png' })).rejects.toMatchObject({ code: 'corrupt' });
  });
});

describe('PDFs', () => {
  it('uses the text layer of a digital PDF without running OCR, one document across both pages', async () => {
    const r = await timed('digital pdf', () => exec.run('recognize', { files: [pdf(fx.digitalPdf)] }));
    expect(r).toMatchObject({ source: 'text-layer', pageCount: 2, pagesRead: 2, confidence: null });
    const parsed = parseReceiptText(r.text, { today: '2026-10-22' });
    expect(parsed.vendor?.value).toBe('Brightline Electric');
    expect(parsed.date?.iso).toBe('2026-09-12');
    expect(parsed.total?.cents).toBe(420_000);
  }, 60_000);

  it('renders and reads a scanned (image-only) PDF locally', async () => {
    const r = await timed('scanned pdf', () => exec.run('recognize', { files: [pdf(fx.scannedPdf)] }));
    expect(r.source).toBe('ocr');
    expect(parseReceiptText(r.text, { today: '2026-10-22' }).total?.cents).toBe(16_525);
  }, 60_000);

  it('inspects page counts and text layers', async () => {
    expect(await exec.run('inspect', { path: fx.digitalPdf, mime: 'application/pdf' })).toEqual({ pages: 2, hasTextLayer: true });
    expect(await exec.run('inspect', { path: fx.scannedPdf, mime: 'application/pdf' })).toMatchObject({ pages: 1, hasTextLayer: false });
  });

  it('refuses password-protected, over-long and damaged PDFs individually', async () => {
    await expect(exec.run('inspect', { path: fx.encryptedPdf, mime: 'application/pdf' })).rejects.toMatchObject({ code: 'encrypted' });
    await expect(exec.run('inspect', { path: fx.longPdf, mime: 'application/pdf' })).rejects.toMatchObject({ code: 'too_many_pages' });
    const bad = path.join(dir, 'broken.pdf');
    fs.writeFileSync(bad, '%PDF-1.4\nnot a real pdf');
    await expect(exec.run('inspect', { path: bad, mime: 'application/pdf' })).rejects.toBeInstanceOf(OcrFileError);
  });
});

describe('previews', () => {
  it('renders a PNG of an image and of a PDF page, bounded in width', async () => {
    const sig = [0x89, 0x50, 0x4e, 0x47];
    const a = await exec.run('preview', { path: fx.clean, mime: 'image/png', page: 1, maxWidth: 300 });
    expect([...a.png.slice(0, 4)]).toEqual(sig);
    expect(a.pageCount).toBe(1);
    const b = await exec.run('preview', { path: fx.digitalPdf, mime: 'application/pdf', page: 2, maxWidth: 400 });
    expect([...b.png.slice(0, 4)]).toEqual(sig);
    expect(b.pageCount).toBe(2);
  }, 60_000);
});

describe('cancellation', () => {
  it('a job cancelled before it starts never runs', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(exec.run('recognize', { files: [png(fx.clean)] }, { signal: ac.signal })).rejects.toMatchObject({ code: 'cancelled' });
  });
});
