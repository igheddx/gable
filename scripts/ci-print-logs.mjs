// CI helper: after a failed end-to-end run, prints the tail of every Gable log left in the temp folder as a
// GitHub annotation, so the reason for a failure can be read without downloading anything.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const escape = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const root = os.tmpdir();
let printed = 0;
for (const name of fs.readdirSync(root)) {
  if (!name.startsWith('gable-')) continue;
  const log = path.join(root, name, 'data', 'logs', 'gable.log');
  if (!fs.existsSync(log)) continue;
  const lines = fs.readFileSync(log, 'utf8').trim().split('\n');
  console.log(`::error title=gable.log in ${name}::${escape(lines.slice(-70).join('\n'))}`);
  if (++printed >= 6) break;
}
if (!printed) console.log('::notice title=gable.log::no Gable logs were left behind');
