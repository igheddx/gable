import fs from 'node:fs';
import path from 'node:path';
import type { OcrResources } from './types';

/**
 * Locates the bundled OCR files. In a packaged app they sit next to the asar archive (unpacked);
 * in development they are in node_modules. Nothing is fetched from the network.
 */
export function resolveOcrResources(opts: { isPackaged: boolean; resourcesPath: string; projectDir: string }): OcrResources {
  const nm = opts.isPackaged
    ? path.join(opts.resourcesPath, 'app.asar.unpacked', 'node_modules')
    : path.join(opts.projectDir, 'node_modules');
  const res: OcrResources = {
    workerPath: path.join(nm, 'tesseract.js', 'src', 'worker-script', 'node', 'index.js'),
    corePath: path.join(nm, 'tesseract.js-core'),
    langPath: path.join(nm, '@tesseract.js-data', 'eng', '4.0.0_best_int'),
    pdfjsPath: path.join(nm, 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs'),
    standardFontsDir: path.join(nm, 'pdfjs-dist', 'standard_fonts'),
    pdfjsWasmDir: path.join(nm, 'pdfjs-dist', 'wasm'),
  };
  return res;
}

/** Names of bundled files that are missing, for a clear startup diagnosis. */
export function missingOcrResources(res: OcrResources): string[] {
  return Object.entries(res).filter(([, p]) => !fs.existsSync(p)).map(([k]) => k);
}
