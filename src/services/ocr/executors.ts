import { Worker } from 'node:worker_threads';
import { JOB_TIMEOUT_MS, OcrFileError, type JobPayloads, type JobResults, type JobType, type OcrErrorCode, type OcrExecutor, type OcrResources, type Progress } from './types';

type RunOpts = { onProgress?: (p: Progress) => void; signal?: AbortSignal };

export type JobLog = (e: { id: number; type: JobType; phase: 'start' | 'done' | 'failed' | 'timeout' | 'trace'; ms?: number; code?: string; detail?: string }) => void;

/** What a job is, for the support log: kind of file and page, never a name or path. */
function describe(job: { type: JobType; payload: unknown }): string {
  const p = job.payload as { mime?: string; page?: number; files?: { mime: string }[] };
  if (p.files) return p.files.map((f) => (f.mime === 'application/pdf' ? 'pdf' : 'img')).join('+');
  return `${p.mime === 'application/pdf' ? 'pdf' : 'img'}${p.page ? ` page ${p.page}` : ''}`;
}

interface Slot { worker: Worker | null; busy: boolean }
interface Pending { id: number; type: JobType; payload: unknown; opts: RunOpts; resolve: (v: never) => void; reject: (e: Error) => void }

/**
 * A bounded pool of worker threads. Each thread owns one OCR engine, so recognition never runs
 * on the main thread. Cancelling a job stops its thread; the slot starts a fresh one on demand.
 */
export class ThreadPoolExecutor implements OcrExecutor {
  private readonly slots: Slot[];
  private readonly queue: Pending[] = [];
  private nextId = 1;
  private closed = false;

  constructor(private readonly workerFile: string, private readonly resources: OcrResources, size: number, private readonly execArgv: string[] = [], private readonly onLog: JobLog = () => {}) {
    this.slots = Array.from({ length: Math.max(1, size) }, () => ({ worker: null, busy: false }));
  }

  run<T extends JobType>(type: T, payload: JobPayloads[T], opts: RunOpts = {}): Promise<JobResults[T]> {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new OcrFileError('failed', 'Reading is not available.'));
      if (opts.signal?.aborted) return reject(new OcrFileError('cancelled', 'Reading was cancelled.'));
      this.queue.push({ id: this.nextId++, type, payload, opts, resolve: resolve as (v: never) => void, reject });
      this.pump();
    });
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    for (const p of this.queue.splice(0)) p.reject(new OcrFileError('cancelled', 'Reading was cancelled.'));
    await Promise.all(this.slots.map((s) => s.worker?.terminate()));
  }

  private pump(): void {
    for (const slot of this.slots) {
      if (slot.busy) continue;
      // Skip jobs cancelled while waiting.
      let job = this.queue.shift();
      while (job?.opts.signal?.aborted) {
        job.reject(new OcrFileError('cancelled', 'Reading was cancelled.'));
        job = this.queue.shift();
      }
      if (!job) return;
      this.start(slot, job);
    }
  }

  private start(slot: Slot, job: Pending): void {
    slot.busy = true;
    const startedAt = Date.now();
    this.onLog({ id: job.id, type: job.type, phase: 'start', detail: describe(job) });
    const worker = slot.worker ?? new Worker(this.workerFile, { workerData: { resources: this.resources }, execArgv: this.execArgv });
    slot.worker = worker;
    let finished = false;
    const finish = (fn: () => void, killWorker: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      job.opts.signal?.removeEventListener('abort', onAbort);
      worker.off('message', onMessage);
      worker.off('message', onTrace);
      worker.off('error', onError);
      worker.off('exit', onExit);
      if (killWorker) { slot.worker = null; void worker.terminate(); }
      this.onLog({ id: job.id, type: job.type, phase: 'done', ms: Date.now() - startedAt });
      slot.busy = false;
      fn();
      this.pump();
    };
    const onMessage = (m: { id: number; kind: 'progress' | 'result' | 'error'; progress?: Progress; result?: unknown; code?: OcrErrorCode; message?: string }) => {
      if (m.id !== job.id) return;
      if (m.kind === 'progress') job.opts.onProgress?.(m.progress!);
      else if (m.kind === 'result') finish(() => job.resolve(m.result as never), false);
      else { this.onLog({ id: job.id, type: job.type, phase: 'failed', code: m.code }); finish(() => job.reject(new OcrFileError(m.code ?? 'failed', m.message ?? 'Reading failed.')), false); }
    };
    const onError = (e: Error) => finish(() => job.reject(new OcrFileError('failed', `Reading failed: ${e.message}`)), true);
    const onExit = () => finish(() => job.reject(new OcrFileError('failed', 'The reading process stopped unexpectedly.')), true);
    const onAbort = () => finish(() => job.reject(new OcrFileError('cancelled', 'Reading was cancelled.')), true);
    const timer = setTimeout(() => {
      this.onLog({ id: job.id, type: job.type, phase: 'timeout', ms: Date.now() - startedAt });
      finish(() => job.reject(new OcrFileError('timeout', 'Reading this file took too long and was stopped.')), true);
    }, JOB_TIMEOUT_MS[job.type]);
    const onTrace = (m: { kind: string; message?: string }) => { if (m.kind === 'trace') this.onLog({ id: job.id, type: job.type, phase: 'trace', detail: m.message }); };
    worker.on('message', onTrace);
    worker.on('message', onMessage);
    worker.on('error', onError);
    worker.on('exit', onExit);
    job.opts.signal?.addEventListener('abort', onAbort);
    worker.postMessage({ id: job.id, type: job.type, payload: job.payload });
  }
}
