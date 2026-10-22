/**
 * Builds the DEMO database in .dev-data/demo (separate from dev and production data).
 * Run the app against it with `npm run dev:demo`. Never runs automatically.
 * At this stage the schema only holds settings, so the fixture is just the demo
 * marker; fictional companies/properties are added with their tables (Prompts 2-3).
 */
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase } from '../src/db/connection';
import { SettingsRepository } from '../src/db/settingsRepository';
import { resolveDataPaths } from '../src/platform/paths';

const root = path.resolve(process.cwd(), '.dev-data', 'demo');
fs.rmSync(root, { recursive: true, force: true });
const paths = resolveDataPaths(root);
const db = openDatabase(paths.database);
new SettingsRepository(db).set('app.demoData', '1');
db.close();
console.log(`Demo database created: ${paths.database}`);
