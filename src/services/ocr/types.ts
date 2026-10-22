export const MAX_PDF_PAGES = 30;
/** Scanned PDFs are read page by page; this bounds time and memory. Text-layer PDFs are read in full. */
export const OCR_PAGE_LIMIT = 10;
export const JOB_TIMEOUT_MS = 180_000;

export interface OcrResources {
  /** Absolute paths to bundled files. Nothing is ever downloaded. */
  workerPath: string;
  corePath: string;
  langPath: string;
  pdfjsPath: string;
  standardFontsDir: string;
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
