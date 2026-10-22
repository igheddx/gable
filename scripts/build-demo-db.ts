/**
 * Builds the DEMO database in .dev-data/demo (separate from dev and production data).
 * Run the app against it with `npm run dev:demo`. Never runs automatically.
 */
import path from 'node:path';
import { resolveDataPaths } from '../src/platform/paths';
import { buildDemoData } from './demo-data';

const root = path.resolve(process.cwd(), '.dev-data', 'demo');
buildDemoData(root);
console.log(`Demo data created: ${resolveDataPaths(root).database}`);
