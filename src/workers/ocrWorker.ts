import { parentPort, workerData } from 'node:worker_threads';
import { OcrPipeline, handleJob } from '../services/ocr/pipeline';
import { OcrFileError, type JobPayloads, type JobType, type OcrResources } from '../services/ocr/types';

/** Worker thread entry: owns one OCR engine and handles one job at a time. */
const port = parentPort!;
const pipeline = new OcrPipeline((workerData as { resources: OcrResources }).resources, (message) => port.postMessage({ id: 0, kind: 'trace', message }));

port.on('message', async (msg: { id: number; type: JobType; payload: JobPayloads[JobType] }) => {
  try {
    const result = await handleJob(pipeline, msg.type, msg.payload as never, (progress) => port.postMessage({ id: msg.id, kind: 'progress', progress }));
    port.postMessage({ id: msg.id, kind: 'result', result });
  } catch (e) {
    const code = e instanceof OcrFileError ? e.code : 'failed';
    const message = e instanceof OcrFileError ? e.message : 'This file could not be read.';
    port.postMessage({ id: msg.id, kind: 'error', code, message });
  }
});
