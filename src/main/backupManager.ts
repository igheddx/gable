import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../shared/errors';
import type { BackupRunResult, BackupStatus, FileCheck, RestorePreview } from '../shared/types';
import { AUTO_BACKUP_RETENTION, BackupConfigStore, BackupService, autoBackupDue } from '../services/backup/backupService';

export interface BackupPlatform {
  chooseFolder(): Promise<string | null>;
  chooseBackupFile(): Promise<string | null>;
}

/**
 * Ties the backup service to settings, the scheduler and the dialogs. Backups made on a schedule run only
 * while Gable is open: once at start-up (if today's is missing) and then hourly. Nothing runs when Gable is closed.
 */
export class BackupManager {
  private timer: NodeJS.Timeout | null = null;
  private pendingRestoreToken: string | null = null;

  constructor(
    private readonly service: BackupService,
    private readonly store: BackupConfigStore,
    private readonly paths: { root: string; backups: string },
    private readonly platform: BackupPlatform,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private destination(): string {
    return this.store.read().destination ?? this.paths.backups;
  }

  status(): BackupStatus {
    const c = this.store.read();
    const dest = this.destination();
    let available = true;
    let sameDisk = false;
    try {
      fs.mkdirSync(dest, { recursive: true });
      sameDisk = fs.statSync(dest).dev === fs.statSync(this.paths.root).dev;
    } catch {
      available = false;
    }
    return {
      autoEnabled: c.autoEnabled,
      destinationLabel: c.destination ? path.basename(c.destination) || c.destination : "Inside Gable's data folder",
      isDefaultDestination: c.destination === null,
      sameDisk,
      destinationAvailable: available,
      lastSuccess: c.lastSuccess, lastFailure: c.lastFailure, lastRestore: c.lastRestore,
      retention: AUTO_BACKUP_RETENTION,
      backups: this.service.list(dest),
      running: this.service.isRunning,
    };
  }

  setAuto(enabled: boolean): BackupStatus {
    this.store.write({ autoEnabled: enabled });
    return this.status();
  }

  async chooseDestination(): Promise<BackupStatus | null> {
    const dir = await this.platform.chooseFolder();
    if (!dir) return null;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
    } catch {
      throw new AppError('CONFLICT', 'Gable cannot save to that folder. Choose a folder you can write to.');
    }
    this.store.write({ destination: dir });
    return this.status();
  }

  useDefaultDestination(): BackupStatus {
    this.store.write({ destination: null });
    return this.status();
  }

  /** A backup the person asked for. A failure is recorded and returned; it is never counted as a success. */
  async runManual(): Promise<BackupRunResult> {
    return this.run('manual');
  }

  private async run(kind: 'manual' | 'auto'): Promise<BackupRunResult> {
    try {
      const r = await this.service.create(kind, this.destination());
      this.store.write({ lastSuccess: { at: r.createdAt, kind: r.kind, file: r.file, warnings: r.warnings }, lastFailure: null });
      return r;
    } catch (e) {
      const message = e instanceof AppError ? e.message : 'The backup could not be completed.';
      this.store.write({ lastFailure: { at: this.now().toISOString(), message } });
      throw e;
    }
  }

  /** Starts the daily check. Safe to call once at start-up. */
  startScheduler(firstCheckMs = 15_000): void {
    const tick = () => {
      if (autoBackupDue(this.store.read(), this.now()) && !this.service.isRunning) void this.run('auto').catch(() => { /* recorded as lastFailure */ });
    };
    setTimeout(tick, firstCheckMs).unref();
    this.timer = setInterval(tick, 60 * 60 * 1000);
    this.timer.unref();
  }

  stopScheduler(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async inspect(listedFile: string | null): Promise<RestorePreview | null> {
    let file: string | null;
    if (listedFile) {
      const dest = this.destination();
      file = path.join(dest, path.basename(listedFile));
    } else {
      file = await this.platform.chooseBackupFile();
    }
    if (!file) return null;
    if (this.pendingRestoreToken) this.service.discard(this.pendingRestoreToken);
    const s = await this.service.inspect(file);
    this.pendingRestoreToken = s.token;
    return { token: s.token, createdAt: s.createdAt, appVersion: s.appVersion, upgradeNeeded: s.upgradeNeeded, counts: s.counts, warnings: s.warnings };
  }

  discard(token: string): void {
    this.service.discard(token);
    if (this.pendingRestoreToken === token) this.pendingRestoreToken = null;
  }

  /**
   * Replaces everything with the inspected backup. The caller closes the database through `closeDb` and then
   * restarts the app; the outcome is saved so it can be shown after the restart.
   */
  async restore(token: string, closeDb: () => void): Promise<void> {
    this.stopScheduler();
    try {
      const r = await this.service.restore(token, { backupDir: this.destination(), closeDb });
      this.store.write({
        lastRestore: {
          at: this.now().toISOString(), ok: true,
          message: `Restore complete.${r.upgradedFrom !== null ? ' The data was updated to this version of Gable.' : ''} Your previous data was saved first as ${r.preRestoreBackup}.`,
        },
      });
    } catch (e) {
      this.store.write({ lastRestore: { at: this.now().toISOString(), ok: false, message: e instanceof AppError ? e.message : 'The restore could not be completed. Your previous data was kept.' } });
      throw e;
    } finally {
      this.pendingRestoreToken = null;
    }
  }

  checkFiles(): FileCheck {
    const c = this.service.checkFiles();
    return { missing: c.missing.map((m) => ({ kind: m.kind, id: m.id, label: m.label })), unreferenced: c.unreferenced };
  }
}
