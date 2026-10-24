import { spawn } from 'node:child_process';
import path from 'node:path';
import { app } from 'electron';

const SHORTCUTS = 'Desktop,StartMenu';

/**
 * Handles the Squirrel installer events. On install and update it asks Update.exe for a Desktop and a
 * Start Menu shortcut (named explicitly rather than relying on defaults); on uninstall it removes them.
 * Returns true when the process was started by Squirrel and should exit instead of opening the app.
 */
export function handleSquirrelEvent(): boolean {
  if (process.platform !== 'win32') return false;
  const event = process.argv[1];
  const exeName = path.basename(process.execPath);
  const updateExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');

  const run = (args: string[]): void => {
    const child = spawn(updateExe, args, { detached: true });
    child.on('error', () => app.quit());
    child.on('close', () => app.quit());
  };

  switch (event) {
    case '--squirrel-install':
    case '--squirrel-updated':
      run([`--createShortcut=${exeName}`, `--shortcut-locations=${SHORTCUTS}`]);
      return true;
    case '--squirrel-uninstall':
      run([`--removeShortcut=${exeName}`, `--shortcut-locations=${SHORTCUTS}`]);
      return true;
    case '--squirrel-obsolete':
      app.quit();
      return true;
    default:
      return false;
  }
}
