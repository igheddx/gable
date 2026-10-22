export const MAX_PDF_PAGES = 30;
/** Scanned PDFs are read page by page; this bounds time and memory. Text-layer PDFs are read in full. */
export const OCR_PAGE_LIMIT = 10;
/** A stuck job must never hold a worker for long. Reading a receipt can take a while; looking at one should not. */
export const JOB_TIMEOUT_MS: Record<'inspect' | 'recognize' | 'preview', number> = { inspect: 30_000, recognize: 180_000, preview: 30_000 };

export interface OcrResources {
  /** Absolute paths to bundled files. Nothing is ever downloaded. */
  workerPath: string;
  corePath: string;
  langPath: string;
  /** Kept for diagnostics; the pdf.js code itself is bundled into the reader. */
  pdfjsPath: string;
  standardFontsDir: string;
  /** pdf.js decoders for JPEG 2000 and similar image formats inside PDFs. */
  pdfjsWasmDir: string;
}

export type OcrErrorCode = 'encrypted' | 'corrupt' | 'too_many_pages' | 'unsupported' | 'failed' | 'cancelled' | 'timeout';

export class OcrFileError extends Error {
  constructor(readonly code: OcrErrorCode, message: string) {
    super(message);
    this.name = 'OcrFileError';
  }
}

export interface InspectResult { pages: number; hasTextLayer: boolean }

export interface FileRef { path: string; mime: string; name: string }

export interface RecognizeResult {
  /** All pages joined with "--- page N ---" markers. */
  text: string;
  pageCount: number;
  /** Pages actually read (scanned PDFs may be capped). */
  pagesRead: number;
  source: 'ocr' | 'text-layer' | 'mixed';
  /** Mean engine confidence 0-100 for OCR'd pages. Informational only; never proof a field is right. */
  confidence: number | null;
  notes: string[];
}

export interface Progress { stage: 'starting' | 'reading'; page?: number; pages?: number; file?: number; files?: number }

export type JobType = 'inspect' | 'recognize' | 'preview';
export interface JobPayloads {
  inspect: { path: string; mime: string };
  recognize: { files: FileRef[] };
  preview: { path: string; mime: string; page: number; maxWidth: number };
}
export interface JobResults {
  inspect: InspectResult;
  recognize: RecognizeResult;
  preview: { png: Uint8Array; pageCount: number };
}

export interface OcrExecutor {
  run<T extends JobType>(type: T, payload: JobPayloads[T], opts?: { onProgress?: (p: Progress) => void; signal?: AbortSignal }): Promise<JobResults[T]>;
  shutdown(): Promise<void>;
}
