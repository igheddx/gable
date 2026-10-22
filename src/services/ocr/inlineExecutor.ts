import { OcrPipeline, handleJob } from './pipeline';
import { OcrFileError, type JobPayloads, type JobResults, type JobType, type OcrExecutor, type OcrResources, type Progress } from './types';

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
