import { Worker } from 'node:worker_threads';
import { OcrPipeline, handleJob } from './pipeline';
import { JOB_TIMEOUT_MS, OcrFileError, type JobPayloads, type JobResults, type JobType, type OcrErrorCode, type OcrExecutor, type OcrResources, type Progress } from './types';

type RunOpts = { onProgress?: (p: Progress) => void; signal?: AbortSignal };

/** Runs jobs on the calling thread, one at a time. Used by tests and as a fallback. */
export class InlineExecutor implements OcrExecutor {
  private readonly pipeline: OcrPipeline;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(resources: OcrResources) {
    this.pipeline = new OcrPipeline(resources);
  }

  run<T extends JobType>(type: T, payload: JobPayloads[T], opts: RunOpts = {}): Promise<JobResults[T]> {
    const job = this.chain.then(() => {
      if (opts.signal?.aborted) throw new OcrFileError('cancelled', 'Reading was cancelled.');
      return handleJob(this.pipeline, type, payload, opts.onProgress ?? (() => {}));
    });
    this.chain = job.catch(() => {});
    return job;
  }

  shutdown(): Promise<void> {
    return this.pipeline.dispose();
  }
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

  constructor(private readonly workerFile: string, private readonly resources: OcrResources, size: number) {
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
    const worker = slot.worker ?? new Worker(this.workerFile, { workerData: { resources: this.resources } });
    slot.worker = worker;
    let finished = false;
    const finish = (fn: () => void, killWorker: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      job.opts.signal?.removeEventListener('abort', onAbort);
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
      if (killWorker) { slot.worker = null; void worker.terminate(); }
      slot.busy = false;
      fn();
      this.pump();
    };
    const onMessage = (m: { id: number; kind: 'progress' | 'result' | 'error'; progress?: Progress; result?: unknown; code?: OcrErrorCode; message?: string }) => {
      if (m.id !== job.id) return;
      if (m.kind === 'progress') job.opts.onProgress?.(m.progress!);
      else if (m.kind === 'result') finish(() => job.resolve(m.result as never), false);
      else finish(() => job.reject(new OcrFileError(m.code ?? 'failed', m.message ?? 'Reading failed.')), false);
    };
    const onError = (e: Error) => finish(() => job.reject(new OcrFileError('failed', `Reading failed: ${e.message}`)), true);
    const onExit = () => finish(() => job.reject(new OcrFileError('failed', 'The reading process stopped unexpectedly.')), true);
    const onAbort = () => finish(() => job.reject(new OcrFileError('cancelled', 'Reading was cancelled.')), true);
    const timer = setTimeout(() => finish(() => job.reject(new OcrFileError('timeout', 'Reading this file took too long and was stopped.')), true), JOB_TIMEOUT_MS);
    worker.on('message', onMessage);
    worker.on('error', onError);
    worker.on('exit', onExit);
    job.opts.signal?.addEventListener('abort', onAbort);
    worker.postMessage({ id: job.id, type: job.type, payload: job.payload });
  }
}
