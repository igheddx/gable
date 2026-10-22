import { fork } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { JOB_TIMEOUT_MS, OcrFileError, type JobPayloads, type JobResults, type JobType, type OcrErrorCode, type OcrExecutor, type OcrResources, type Progress } from './types';

type RunOpts = { onProgress?: (p: Progress) => void; signal?: AbortSignal };

export type JobLog = (e: { id: number; type: JobType; phase: 'start' | 'done' | 'failed' | 'timeout' | 'trace' | 'crash'; ms?: number; code?: string; detail?: string }) => void;

/** What a job is, for the support log: kind of file and page, never a name or path. */
function describe(job: { type: JobType; payload: unknown }): string {
  const p = job.payload as { mime?: string; page?: number; files?: { mime: string }[] };
  if (p.files) return p.files.map((f) => (f.mime === 'application/pdf' ? 'pdf' : 'img')).join('+');
  return `${p.mime === 'application/pdf' ? 'pdf' : 'img'}${p.page ? ` page ${p.page}` : ''}`;
}

/** A running reader: a separate process (in the app) or a worker thread (in tests). */
export interface WorkerHandle {
  postMessage(message: unknown): void;
  onMessage(cb: (message: never) => void): () => void;
  onExit(cb: () => void): () => void;
  /** Stops it for good, even if it is stuck in native code. */
  kill(): void;
}
export type Spawn = () => WorkerHandle;

/** Worker threads: used by tests. A stuck native call cannot be stopped this way, which is why the app uses processes. */
export function threadSpawner(workerFile: string, resources: OcrResources, execArgv: string[] = []): Spawn {
  return () => {
    const w = new Worker(workerFile, { workerData: { resources }, execArgv });
    return {
      postMessage: (m) => w.postMessage(m),
      onMessage: (cb) => { w.on('message', cb as never); return () => w.off('message', cb as never); },
      onExit: (cb) => { const f = () => cb(); w.on('exit', f); w.on('error', f); return () => { w.off('exit', f); w.off('error', f); }; },
      kill: () => { void w.terminate(); },
    };
  };
}

/** Plain child processes (Node): used by tests of the process mode. */
export function forkSpawner(workerFile: string, resources: OcrResources, execArgv: string[] = []): Spawn {
  return () => {
    const c = fork(workerFile, [JSON.stringify(resources)], { execArgv, serialization: 'advanced', stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    return {
      postMessage: (m) => { try { c.send(m as never); } catch { /* it already exited */ } },
      onMessage: (cb) => { c.on('message', cb as never); return () => c.off('message', cb as never); },
      onExit: (cb) => { const f = () => cb(); c.on('exit', f); c.on('error', f); return () => { c.off('exit', f); c.off('error', f); }; },
      kill: () => { c.kill('SIGKILL'); },
    };
  };
}

interface Slot { handle: WorkerHandle | null; busy: boolean }
interface Pending { id: number; type: JobType; payload: unknown; opts: RunOpts; resolve: (v: never) => void; reject: (e: Error) => void }

/**
 * A bounded pool of readers. Each owns one OCR engine, so recognition never runs in the app's own process.
 * A reader that stops answering is killed and replaced on demand; it can never freeze the app or block quitting.
 */
export class PoolExecutor implements OcrExecutor {
  private readonly slots: Slot[];
  private readonly queue: Pending[] = [];
  private nextId = 1;
  private closed = false;

  constructor(private readonly spawn: Spawn, size: number, private readonly onLog: JobLog = () => {}) {
    this.slots = Array.from({ length: Math.max(1, size) }, () => ({ handle: null, busy: false }));
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
    for (const s of this.slots) { s.handle?.kill(); s.handle = null; }
  }

  private pump(): void {
    for (const slot of this.slots) {
      if (slot.busy) continue;
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
    let handle: WorkerHandle;
    try {
      handle = slot.handle ?? this.spawn();
    } catch {
      slot.busy = false;
      job.reject(new OcrFileError('failed', 'The reading process could not be started.'));
      this.pump();
      return;
    }
    slot.handle = handle;
    let finished = false;
    const stops: (() => void)[] = [];
    const finish = (fn: () => void, killWorker: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      job.opts.signal?.removeEventListener('abort', onAbort);
      for (const s of stops) s();
      if (killWorker) { slot.handle = null; handle.kill(); }
      this.onLog({ id: job.id, type: job.type, phase: 'done', ms: Date.now() - startedAt });
      slot.busy = false;
      fn();
      this.pump();
    };
    const onMessage = (m: { id: number; kind: 'progress' | 'result' | 'error' | 'trace'; progress?: Progress; result?: unknown; code?: OcrErrorCode; message?: string }) => {
      if (m.kind === 'trace') { this.onLog({ id: job.id, type: job.type, phase: 'trace', detail: m.message }); return; }
      if (m.id !== job.id) return;
      if (m.kind === 'progress') job.opts.onProgress?.(m.progress!);
      else if (m.kind === 'result') finish(() => job.resolve(m.result as never), false);
      else { this.onLog({ id: job.id, type: job.type, phase: 'failed', code: m.code }); finish(() => job.reject(new OcrFileError(m.code ?? 'failed', m.message ?? 'Reading failed.')), false); }
    };
    const onExit = () => {
      this.onLog({ id: job.id, type: job.type, phase: 'crash' });
      finish(() => job.reject(new OcrFileError('failed', 'The reading process stopped unexpectedly.')), true);
    };
    const onAbort = () => finish(() => job.reject(new OcrFileError('cancelled', 'Reading was cancelled.')), true);
    const timer = setTimeout(() => {
      this.onLog({ id: job.id, type: job.type, phase: 'timeout', ms: Date.now() - startedAt });
      finish(() => job.reject(new OcrFileError('timeout', 'Reading this file took too long and was stopped.')), true);
    }, JOB_TIMEOUT_MS[job.type]);
    stops.push(handle.onMessage(onMessage as never), handle.onExit(onExit));
    job.opts.signal?.addEventListener('abort', onAbort);
    handle.postMessage({ id: job.id, type: job.type, payload: job.payload });
  }
}
