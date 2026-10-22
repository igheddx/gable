import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { OcrPipeline, handleJob } from '../services/ocr/pipeline';
import { OcrFileError, type JobPayloads, type JobType, type OcrResources } from '../services/ocr/types';

/**
 * Reader entry point. It runs as a separate process in the app (Electron utility process), as a plain child
 * process, or as a worker thread in tests; the messages are the same in every case.
 */
type Msg = { id: number; type: JobType; payload: JobPayloads[JobType] };
interface Port { post(message: unknown): void; onMessage(cb: (m: Msg) => void): void }

const electronPort = (process as unknown as { parentPort?: { postMessage(m: unknown): void; on(ev: 'message', cb: (e: { data: Msg }) => void): void } }).parentPort;

let resources: OcrResources;
let port: Port;
if (!isMainThread && parentPort) {
  resources = (workerData as { resources: OcrResources }).resources;
  port = { post: (m) => parentPort!.postMessage(m), onMessage: (cb) => parentPort!.on('message', cb) };
} else if (electronPort) {
  resources = JSON.parse(process.argv[process.argv.length - 1]!) as OcrResources;
  port = { post: (m) => electronPort.postMessage(m), onMessage: (cb) => electronPort.on('message', (e) => cb(e.data)) };
} else {
  resources = JSON.parse(process.argv[2]!) as OcrResources;
  port = { post: (m) => process.send?.(m), onMessage: (cb) => process.on('message', cb as never) };
}

const t0 = Date.now();
const pipeline = new OcrPipeline(resources, (message) => port.post({ id: 0, kind: 'trace', message }));
port.post({ id: 0, kind: 'trace', message: `reader: loaded in ${Date.now() - t0}ms (pid ${process.pid})` });

port.onMessage(async (msg) => {
  port.post({ id: 0, kind: 'trace', message: `reader: received ${msg.type}` });
  try {
    const result = await handleJob(pipeline, msg.type, msg.payload as never, (progress) => port.post({ id: msg.id, kind: 'progress', progress }));
    port.post({ id: msg.id, kind: 'result', result });
  } catch (e) {
    port.post({ id: 0, kind: 'trace', message: `reader: error ${(e as Error).name}: ${(e as Error).message}`.slice(0, 300) });
    const code = e instanceof OcrFileError ? e.code : 'failed';
    const message = e instanceof OcrFileError ? e.message : 'This file could not be read.';
    port.post({ id: msg.id, kind: 'error', code, message });
  }
});
