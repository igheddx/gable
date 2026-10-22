import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { chooseUserDataDir, resolveDataPaths } from '../../src/platform/paths';

describe('data paths', () => {
  it('keeps every data path under the user data directory', () => {
    const p = resolveDataPaths('/u/Gable');
    for (const v of Object.values(p)) expect(v.startsWith(path.join('/u/Gable', 'data'))).toBe(true);
  });

  it('dev runs never use the OS user data folder', () => {
    const dir = chooseUserDataDir({ isPackaged: false, envOverride: undefined, osUserData: '/os/Gable', cwd: '/repo' });
    expect(dir).toBe(path.join('/repo', '.dev-data', 'default'));
  });

  it('packaged runs use the OS folder unless explicitly overridden', () => {
    expect(chooseUserDataDir({ isPackaged: true, envOverride: undefined, osUserData: '/os/Gable', cwd: '/repo' })).toBe('/os/Gable');
    expect(chooseUserDataDir({ isPackaged: true, envOverride: 'x/y', osUserData: '/os/Gable', cwd: '/repo' })).toBe(path.join('/repo', 'x', 'y'));
  });
});
