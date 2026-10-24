import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, DOMMatrix, ImageData, loadImage, Path2D } from '@napi-rs/canvas';
// pdf.js is bundled into the reader (not loaded as a separate module at run time), together with its page
// engine, which it looks for on globalThis. Fewer moving parts in the reader process.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import { createWorker, type Worker as TessWorker } from 'tesseract.js';
import {
  MAX_PDF_PAGES, OCR_PAGE_LIMIT, OcrFileError,
  type FileRef, type InspectResult, type JobPayloads, type JobResults, type JobType, type OcrResources, type Progress, type RecognizeResult,
} from './types';

// pdf.js is an ES module with no bundled types here; the small surface used is described locally.
interface PdfPage {
  getTextContent(): Promise<{ items: { str?: string; hasEOL?: boolean }[] }>;
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: { canvasContext: unknown; viewport: unknown; canvas: unknown }): { promise: Promise<void> };
  cleanup(): void;
}
interface PdfDoc { numPages: number; getPage(n: number): Promise<PdfPage>; destroy(): Promise<void> }
interface PdfJs { getDocument(o: Record<string, unknown>): { promise: Promise<PdfDoc>; destroy(): Promise<void> } }

/**
 * pdf.js decides whether it is "in Node" from process details that Electron's utility processes do not match,
 * and would then try to use a web page's document and fetch. These factories make it use the file system and
 * our canvas library regardless of where the reader runs.
 */
class ReaderCanvasFactory {
  create(width: number, height: number) {
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext('2d') };
  }
  reset(c: { canvas: { width: number; height: number } | null }, width: number, height: number) {
    if (!c.canvas) throw new Error('Canvas is not specified');
    c.canvas.width = width;
    c.canvas.height = height;
  }
  destroy(c: { canvas: { width: number; height: number } | null; context: unknown }) {
    if (!c.canvas) throw new Error('Canvas is not specified');
    c.canvas.width = c.canvas.height = 0;
    c.canvas = null;
    c.context = null;
  }
}

class ReaderFilterFactory {
  addFilter() { return 'none'; }
  addHCMFilter() { return 'none'; }
  addAlphaFilter() { return 'none'; }
  addLuminosityFilter() { return 'none'; }
  addKnockoutFilter() { return 'none'; }
  addHighlightHCMFilter() { return 'none'; }
  addSelectionHCMFilter() { return 'none'; }
  addSelectionFilter() { return 'none'; }
  createSelectionStyle() { return null; }
  destroy() {}
}

class ReaderBinaryDataFactory {
  private readonly bases: Record<string, string | null>;
  constructor(o: { cMapUrl?: string | null; standardFontDataUrl?: string | null; wasmUrl?: string | null }) {
    this.bases = { cMapUrl: o.cMapUrl ?? null, standardFontDataUrl: o.standardFontDataUrl ?? null, wasmUrl: o.wasmUrl ?? null };
  }
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const base = this.bases[kind];
    if (!base) throw new Error(`Ensure that the ${kind} API parameter is provided.`);
    // Only plain file names from pdf.js itself are expected; never let one leave its folder.
    if (filename.includes('..') || /[\\/]/.test(filename)) throw new Error('Unexpected data file name');
    return new Uint8Array(fs.readFileSync(path.join(base, filename)));
  }
}

const isPdf = (mime: string) => mime === 'application/pdf';

/**
 * Reads text from receipt images and PDFs entirely offline. One instance owns one OCR engine,
 * so it handles one job at a time; run several instances for parallelism.
 */
export class OcrPipeline {
  private tess: Promise<TessWorker> | null = null;

  constructor(private readonly res: OcrResources, private readonly trace: (message: string) => void = () => {}) {}

  async dispose(): Promise<void> {
    const t = this.tess;
    this.tess = null;
    if (t) await (await t).terminate().catch(() => {});
  }

  private engine(): Promise<TessWorker> {
    if (!this.tess) {
      this.trace('engine: creating');
      this.tess = createWorker('eng', 1, {
        workerPath: this.res.workerPath,
        corePath: this.res.corePath,
        langPath: this.res.langPath,
        gzip: true,
        cacheMethod: 'none', // never write language data anywhere else
      });
      this.tess.then(() => this.trace('engine: ready'), () => { this.tess = null; this.trace('engine: failed to start'); });
    }
    return this.tess;
  }

  private lib(): PdfJs {
    // pdf.js draws with Path2D and DOMMatrix. It only installs them itself when it decides it is running in plain
    // Node, which it does not in Electron's reader process, so they are provided here. Without them a page that uses
    // clipping fails to draw ("Path2D is not defined"), which showed up as a missing preview on Windows.
    const g = globalThis as unknown as Record<string, unknown>;
    g.Path2D ??= Path2D;
    g.DOMMatrix ??= DOMMatrix;
    g.ImageData ??= ImageData;
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;
    return pdfjsLib as unknown as PdfJs;
  }

  private async openPdf(path: string): Promise<{ doc: PdfDoc; close: () => Promise<void> }> {
    const lib = this.lib();
    const data = new Uint8Array(fs.readFileSync(path));
    const task = lib.getDocument({
      data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0, useWorkerFetch: false,
      CanvasFactory: ReaderCanvasFactory, FilterFactory: ReaderFilterFactory, BinaryDataFactory: ReaderBinaryDataFactory,
      standardFontDataUrl: this.res.standardFontsDir.replace(/[\\/]*$/, '/'),
      wasmUrl: this.res.pdfjsWasmDir.replace(/[\\/]*$/, '/'),
    });
    try {
      const doc = await task.promise;
      return { doc, close: () => task.destroy() };
    } catch (e) {
      const name = (e as { name?: string }).name ?? '';
      if (name === 'PasswordException') throw new OcrFileError('encrypted', 'This PDF is password protected. Remove the password and add it again.');
      throw new OcrFileError('corrupt', 'This PDF could not be opened. It may be damaged.');
    }
  }

  async inspect(file: { path: string; mime: string }): Promise<InspectResult> {
    if (!isPdf(file.mime)) {
      try {
        await loadImage(fs.readFileSync(file.path));
      } catch {
        throw new OcrFileError('corrupt', 'This image could not be read. It may be damaged.');
      }
      return { pages: 1, hasTextLayer: false };
    }
    const { doc, close } = await this.openPdf(file.path);
    try {
      if (doc.numPages > MAX_PDF_PAGES) throw new OcrFileError('too_many_pages', `This PDF has ${doc.numPages} pages. Gable reads PDFs of up to ${MAX_PDF_PAGES} pages.`);
      const text = await pageText(await doc.getPage(1));
      return { pages: doc.numPages, hasTextLayer: text.trim().length >= 20 };
    } finally {
      await close();
    }
  }

  async recognize(files: FileRef[], onProgress: (p: Progress) => void = () => {}): Promise<RecognizeResult> {
    const parts: string[] = [];
    const notes: string[] = [];
    let confidenceSum = 0;
    let ocrPages = 0;
    let textPages = 0;
    let pagesRead = 0;
    let pageCount = 0;
    let n = 0;
    onProgress({ stage: 'starting', files: files.length });
    for (const [fi, f] of files.entries()) {
      if (!isPdf(f.mime)) {
        pageCount += 1;
        n += 1;
        onProgress({ stage: 'reading', page: n, pages: files.length, file: fi + 1, files: files.length });
        const r = await this.ocrImage(fs.readFileSync(f.path));
        parts.push(`--- page ${n} ---\n${r.text}`);
        confidenceSum += r.confidence;
        ocrPages += 1;
        pagesRead += 1;
        continue;
      }
      const { doc, close } = await this.openPdf(f.path);
      try {
        if (doc.numPages > MAX_PDF_PAGES) throw new OcrFileError('too_many_pages', `This PDF has ${doc.numPages} pages. Gable reads PDFs of up to ${MAX_PDF_PAGES} pages.`);
        pageCount += doc.numPages;
        let scanned = 0;
        for (let p = 1; p <= doc.numPages; p++) {
          n += 1;
          onProgress({ stage: 'reading', page: p, pages: doc.numPages, file: fi + 1, files: files.length });
          const page = await doc.getPage(p);
          const layer = await pageText(page);
          if (layer.trim().length >= 40) {
            parts.push(`--- page ${n} ---\n${layer}`);
            textPages += 1;
            pagesRead += 1;
          } else if (scanned < OCR_PAGE_LIMIT) {
            scanned += 1;
            const r = await this.ocrImage(await renderPage(page, 2));
            parts.push(`--- page ${n} ---\n${r.text}`);
            confidenceSum += r.confidence;
            ocrPages += 1;
            pagesRead += 1;
          } else {
            notes.push(`Only the first ${OCR_PAGE_LIMIT} scanned pages of ${f.name} were read. Check the remaining pages by eye.`);
            break;
          }
          page.cleanup();
        }
      } finally {
        await close();
      }
    }
    return {
      text: parts.join('\n'),
      pageCount,
      pagesRead,
      source: ocrPages === 0 ? 'text-layer' : textPages === 0 ? 'ocr' : 'mixed',
      confidence: ocrPages ? Math.round(confidenceSum / ocrPages) : null,
      notes: [...new Set(notes)],
    };
  }

  /** A PNG of one page, at most `maxWidth` wide, for the review screen. */
  async preview(file: { path: string; mime: string }, page: number, maxWidth: number): Promise<{ png: Uint8Array; pageCount: number }> {
    if (!isPdf(file.mime)) {
      const img = await loadImage(fs.readFileSync(file.path));
      const scale = Math.min(1, maxWidth / img.width);
      const c = createCanvas(Math.max(1, Math.round(img.width * scale)), Math.max(1, Math.round(img.height * scale)));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return { png: new Uint8Array(c.toBuffer('image/png')), pageCount: 1 };
    }
    const { doc, close } = await this.openPdf(file.path);
    try {
      const p = Math.min(Math.max(1, page), doc.numPages);
      const pg = await doc.getPage(p);
      const base = pg.getViewport({ scale: 1 });
      return { png: new Uint8Array(await renderPage(pg, Math.min(2, maxWidth / base.width))), pageCount: doc.numPages };
    } finally {
      await close();
    }
  }

  /** Light cleanup, then recognition. If the first read looks poor, try turning the page. */
  private async ocrImage(bytes: Buffer): Promise<{ text: string; confidence: number }> {
    const eng = await this.engine();
    this.trace('ocr: image loading');
    const img = await loadImage(bytes).catch(() => { throw new OcrFileError('corrupt', 'This image could not be read. It may be damaged.'); });
    this.trace('ocr: reading');
    let best = await recognizeCanvas(eng, prepare(img, 0));
    this.trace(`ocr: first pass done confidence=${Math.round(best.confidence)}`);
    if (best.confidence < 60 || best.words < 4) {
      for (const deg of [90, 270, 180]) {
        const r = await recognizeCanvas(eng, prepare(img, deg));
        if (r.score > best.score) best = r;
      }
    }
    return { text: best.text, confidence: best.confidence };
  }
}

async function pageText(page: PdfPage): Promise<string> {
  const tc = await page.getTextContent();
  return tc.items.map((i) => (i.str ?? '') + (i.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' ');
}

async function renderPage(page: PdfPage, scale: number): Promise<Buffer> {
  const vp = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, canvas }).promise;
  return canvas.toBuffer('image/png');
}

type Img = Awaited<ReturnType<typeof loadImage>>;

/** Grayscale, stretch contrast, and bring the size into the range the engine reads best. */
function prepare(img: Img, rotate: number): Buffer {
  const swap = rotate === 90 || rotate === 270;
  const w0 = swap ? img.height : img.width;
  const h0 = swap ? img.width : img.height;
  const scale = w0 < 1400 ? 1400 / w0 : w0 > 3000 ? 3000 / w0 : 1;
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const c = createCanvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  g.translate(w / 2, h / 2);
  g.rotate((rotate * Math.PI) / 180);
  const dw = swap ? h : w;
  const dh = swap ? w : h;
  g.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  const data = g.getImageData(0, 0, w, h);
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < data.data.length; i += 4) {
    const y = Math.round(0.299 * data.data[i]! + 0.587 * data.data[i + 1]! + 0.114 * data.data[i + 2]!);
    data.data[i] = data.data[i + 1] = data.data[i + 2] = y;
    hist[y]! += 1;
  }
  const total = w * h;
  let lo = 0;
  let hi = 255;
  for (let acc = 0; lo < 255 && (acc += hist[lo]!) < total * 0.02; lo++);
  for (let acc = 0; hi > 0 && (acc += hist[hi]!) < total * 0.02; hi--);
  if (hi - lo > 30) {
    const span = hi - lo;
    for (let i = 0; i < data.data.length; i += 4) {
      const v = Math.max(0, Math.min(255, Math.round(((data.data[i]! - lo) * 255) / span)));
      data.data[i] = data.data[i + 1] = data.data[i + 2] = v;
    }
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.putImageData(data, 0, 0);
  return c.toBuffer('image/png');
}

async function recognizeCanvas(eng: TessWorker, png: Buffer): Promise<{ text: string; confidence: number; words: number; score: number }> {
  const { data } = await eng.recognize(png);
  const words = (data.text.match(/[A-Za-z0-9]{2,}/g) ?? []).length;
  const confidence = Math.round(data.confidence);
  return { text: data.text, confidence, words, score: confidence * Math.log(words + 2) };
}

/** Runs one job on a pipeline. Shared by the worker thread and the in-process executor. */
export async function handleJob<T extends JobType>(
  pipeline: OcrPipeline, type: T, payload: JobPayloads[T], onProgress: (p: Progress) => void,
): Promise<JobResults[T]> {
  switch (type) {
    case 'inspect': return (await pipeline.inspect(payload as JobPayloads['inspect'])) as JobResults[T];
    case 'recognize': return (await pipeline.recognize((payload as JobPayloads['recognize']).files, onProgress)) as JobResults[T];
    case 'preview': {
      const p = payload as JobPayloads['preview'];
      return (await pipeline.preview(p, p.page, p.maxWidth)) as JobResults[T];
    }
    default: throw new OcrFileError('failed', 'Unknown job');
  }
}
