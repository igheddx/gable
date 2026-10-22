import path from 'node:path';

export interface DataPaths {
  root: string;
  database: string;
  receipts: string;
  backups: string;
  staging: string;
}

/** All user data lives under `<userData>/data`, never in the install directory. */
export function resolveDataPaths(userDataDir: string): DataPaths {
  const root = path.join(userDataDir, 'data');
  return {
    root,
    database: path.join(root, 'gable.db'),
    receipts: path.join(root, 'receipts'),
    backups: path.join(root, 'backups'),
    staging: path.join(root, 'staging'),
  };
}

/**
 * Packaged builds use the OS per-user data folder. Development runs use a
 * repo-local folder so `npm run dev` can never touch real data. GABLE_DATA_DIR
 * overrides both (tests, demo profile).
 */
export function chooseUserDataDir(opts: {
  isPackaged: boolean;
  envOverride: string | undefined;
  osUserData: string;
  cwd: string;
}): string {
  if (opts.envOverride) return path.resolve(opts.cwd, opts.envOverride);
  if (!opts.isPackaged) return path.join(opts.cwd, '.dev-data', 'default');
  return opts.osUserData;
}
