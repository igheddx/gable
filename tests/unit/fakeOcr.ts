import fs from 'node:fs';
import { OcrFileError, type JobPayloads, type JobResults, type JobType, type OcrExecutor, type Progress } from '../../src/services/ocr/types';

/**
 * A stand-in for the OCR engine, so service tests are fast and deterministic. A test "receipt" is a real
 * PNG header followed by `GABLETEXT:` and the text the engine should "read". Other markers simulate failures:
 *   GABLEFAIL:<code>   inspect fails with that file error
 *   GABLEREADFAIL      inspect passes, recognition fails
 *   GABLEWAIT          recognition waits until cancelled
 *   GABLEINFRA         the reader itself is unavailable
 */
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const fakeReceipt = (text: string, extra = ''): Buffer => Buffer.concat([PNG_HEAD, Buffer.from(`GABLETEXT:${text}\n${extra}`), Buffer.alloc(8, 9)]);
export const failingReceipt = (marker: string): Buffer => Buffer.concat([PNG_HEAD, Buffer.from(marker)]);

export class FakeOcr implements OcrExecutor {
  active = 0;
  maxActive = 0;
  recognized: string[] = [];
  delayMs = 5;

  async run<T extends JobType>(type: T, payload: JobPayloads[T], opts: { onProgress?: (p: Progress) => void; signal?: AbortSignal } = {}): Promise<JobResults[T]> {
    if (type === 'inspect') {
      const { path } = payload as JobPayloads['inspect'];
      const s = fs.readFileSync(path).toString('latin1');
      if (s.includes('GABLEINFRA')) throw new OcrFileError('failed', 'engine missing');
      const m = /GABLEFAIL:(\w+)/.exec(s);
      if (m) throw new OcrFileError(m[1] as 'encrypted' | 'corrupt' | 'too_many_pages', `fake ${m[1]}`);
      return { pages: 1, hasTextLayer: false } as unknown as JobResults[T];
    }
    if (type === 'preview') return { png: PNG_HEAD, pageCount: 1 } as unknown as JobResults[T];
    const { files } = payload as JobPayloads['recognize'];
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      opts.onProgress?.({ stage: 'reading', page: 1, pages: files.length });
      const texts: string[] = [];
      for (const f of files) {
        const s = fs.readFileSync(f.path).toString('latin1');
        this.recognized.push(f.name);
        if (s.includes('GABLEWAIT')) {
          await new Promise<void>((_, reject) => {
            const abort = () => reject(new OcrFileError('cancelled', 'Reading was cancelled.'));
            if (opts.signal?.aborted) abort();
            opts.signal?.addEventListener('abort', abort);
          });
        }
        if (s.includes('GABLEREADFAIL')) throw new OcrFileError('failed', 'could not read');
        await new Promise((r) => setTimeout(r, this.delayMs));
        const m = /GABLETEXT:([\s\S]*?)\n/.exec(s);
        texts.push(m ? m[1]!.replace(/\\n/g, '\n') : '');
      }
      return {
        text: texts.map((t, i) => `--- page ${i + 1} ---\n${t}`).join('\n'), pageCount: files.length, pagesRead: files.length,
        source: 'ocr', confidence: 90, notes: [],
      } as unknown as JobResults[T];
    } finally {
      this.active -= 1;
    }
  }

  async shutdown(): Promise<void> {}
}
