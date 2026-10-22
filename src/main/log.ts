import fs from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 512 * 1024;

/**
 * A small rolling log in the user's data folder, for support. It records what happened and how long
 * it took, never receipt contents, amounts, names or paths of the person's files.
 */
export function createLogger(dir: string) {
  const file = path.join(dir, 'gable.log');
  fs.mkdirSync(dir, { recursive: true });
  return {
    file,
    log(message: string): void {
      try {
        if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, `${file}.1`);
        fs.appendFileSync(file, `${new Date().toISOString()} ${message}\n`);
      } catch {
        // Logging must never break the app.
      }
    },
  };
}
