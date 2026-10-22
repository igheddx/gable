import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrations } from '../../db/migrations';
import { openDatabase, type Db } from '../../db/connection';
import { AppError } from '../../shared/errors';
import { ArchiveError, ZipFileWriter, extractZip, isSafeEntryName, type ExtractedEntry } from './archive';
import type { ReceiptFiles } from '../receiptFiles';

/**
 * Backups are a single .zip: a consistent copy of the database, every receipt and logo the database refers
 * to, and a manifest with checksums. They are NOT encrypted; anyone who can open the file can read it.
 */

export const BACKUP_FORMAT = 1;
export const LATEST_SCHEMA = Math.max(...migrations.map((m) => m.version));
/** Automatic backups kept per destination. Manual and pre-restore backups are never deleted automatically. */
export const AUTO_BACKUP_RETENTION = 14;
const PRE_UPGRADE_KEEP = 3;

export type BackupKind = 'manual' | 'auto' | 'pre-restore';

export interface Manifest {
  format: number;
  app: 'Gable';
  appVersion: string;
  schemaVersion: number;
  createdAt: string;
  kind: BackupKind;
  counts: { companies: number; properties: number; expenses: number; receipts: number; drafts: number };
  database: { name: string; sha256: string; size: number };
  files: { name: string; sha256: string; size: number }[];
  /** Receipts the database refers to that were already missing from storage when this backup was made. */
  missing: string[];
}

export interface BackupResult { file: string; bytes: number; createdAt: string; kind: BackupKind; warnings: string[] }

export interface BackupConfig {
  autoEnabled: boolean;
  /** null means the default folder inside Gable's data folder. */
  destination: string | null;
  lastSuccess: { at: string; kind: BackupKind; file: string; warnings: string[] } | null;
  lastFailure: { at: string; message: string } | null;
  /** Result of the last restore, shown after Gable restarts. */
  lastRestore: { at: string; ok: boolean; message: string } | null;
}

export interface RestoreSummary {
  token: string;
  createdAt: string;
  appVersion: string;
  schemaVersion: number;
  upgradeNeeded: boolean;
  counts: Manifest['counts'];
  warnings: string[];
}

export interface Paths { root: string; database: string; receipts: string; logos: string; staging: string; backups: string }

export interface BackupDeps {
  paths: Paths;
  getDb: () => Db;
  files: ReceiptFiles;
  appVersion: string;
  now?: () => Date;
  /** Free bytes on the volume holding `dir`. Replaceable for tests. */
  freeBytes?: (dir: string) => number | null;
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', '-');

export function defaultFreeBytes(dir: string): number | null {
  try {
    const s = fs.statfsSync(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

/** Reads and writes backup settings atomically. Stored beside, not inside, the database so a restore never changes them. */
export class BackupConfigStore {
  private readonly file: string;
  constructor(root: string) { this.file = path.join(root, 'backup-config.json'); }

  read(): BackupConfig {
    const base: BackupConfig = { autoEnabled: true, destination: null, lastSuccess: null, lastFailure: null, lastRestore: null };
    try {
      return { ...base, ...(JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<BackupConfig>) };
    } catch {
      return base;
    }
  }

  write(patch: Partial<BackupConfig>): BackupConfig {
    const next = { ...this.read(), ...patch };
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, this.file);
    return next;
  }
}

/** True when an automatic backup is due: enabled, and no backup has succeeded yet today (local date). */
export function autoBackupDue(config: BackupConfig, now: Date): boolean {
  if (!config.autoEnabled) return false;
  return !config.lastSuccess || localDay(new Date(config.lastSuccess.at)) !== localDay(now);
}
const localDay = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/** Makes a copy of an existing database before an upgrade changes it. Keeps the newest few. */
export function preUpgradeSnapshotter(dir: string) {
  return (db: Db, from: number, to: number): void => {
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `Gable-before-upgrade-v${from}-to-v${to}-${stamp(new Date())}.db`);
    try {
      db.prepare('VACUUM INTO ?').run(target);
    } catch {
      fs.rmSync(target, { force: true });
      throw new AppError('CONFLICT', 'Gable could not save a safety copy of your data before updating it, so it did not update. Your data is unchanged. Free some disk space and start Gable again.');
    }
    const old = fs.readdirSync(dir).filter((f) => f.startsWith('Gable-before-upgrade-')).sort();
    for (const f of old.slice(0, Math.max(0, old.length - PRE_UPGRADE_KEEP))) fs.rmSync(path.join(dir, f), { force: true });
  };
}

/** Cleanup must never hide the real error, so removing a path is always best effort. */
const rmQuiet = (p: string, recursive = false): void => {
  try { fs.rmSync(p, { force: true, recursive }); } catch { /* nothing more can be done */ }
};

const ERR_BUSY = 'Gable is busy right now. Wait a moment and try again.';

function friendlyFsError(e: unknown, where: string): AppError {
  const code = (e as NodeJS.ErrnoException).code;
  switch (code) {
    case 'ENOSPC': return new AppError('CONFLICT', `There is not enough free space on ${where}. Free some space or choose another location.`);
    case 'EACCES': case 'EPERM': return new AppError('CONFLICT', `Gable is not allowed to write to ${where}. Choose a folder you can save to, such as Documents.`);
    case 'ENOENT': return new AppError('CONFLICT', `${where[0]!.toUpperCase()}${where.slice(1)} could not be found. If it is an external drive, plug it in and try again.`);
    case 'EBUSY': return new AppError('CONFLICT', `${where[0]!.toUpperCase()}${where.slice(1)} is in use by another program. Close it and try again.`);
    default: return new AppError('CONFLICT', `Could not write to ${where}.`);
  }
}

export class BackupService {
  private readonly now: () => Date;
  private readonly freeBytes: (dir: string) => number | null;
  private running = false;

  constructor(private readonly d: BackupDeps) {
    this.now = d.now ?? (() => new Date());
    this.freeBytes = d.freeBytes ?? defaultFreeBytes;
  }

  get isRunning(): boolean { return this.running; }

  // ------------------------------------------------------------------ creating a backup

  async create(kind: BackupKind, destDir: string): Promise<BackupResult> {
    if (this.running) throw new AppError('CONFLICT', 'A backup is already running.');
    this.running = true;
    const release = this.d.files.hold(); // receipts are not deleted from disk while the archive is being written
    const created = this.now();
    const workDir = path.join(this.d.paths.staging, `backup-${process.pid}-${created.getTime()}`);
    const finalName = `Gable-backup-${stamp(created)}-${kind}.zip`;
    const partial = path.join(destDir, `${finalName}.partial`);
    try {
      try {
        fs.mkdirSync(destDir, { recursive: true });
        fs.accessSync(destDir, fs.constants.W_OK);
      } catch (e) {
        throw friendlyFsError(e, 'the backup folder');
      }
      fs.mkdirSync(workDir, { recursive: true });

      // 1. A transactionally consistent copy of the database, taken in one step so nothing changes under it.
      const snapshot = path.join(workDir, 'gable.db');
      try {
        this.d.getDb().prepare('VACUUM INTO ?').run(snapshot);
      } catch (e) {
        if (/busy|locked/i.test((e as Error).message)) throw new AppError('CONFLICT', ERR_BUSY);
        throw friendlyFsError(e, 'the temporary backup folder');
      }

      // 2. What the snapshot refers to.
      const info = this.describeSnapshot(snapshot);
      const present: { name: string; source: string }[] = [];
      const missing: string[] = [];
      for (const f of info.files) {
        const source = f.startsWith('logos/') ? path.join(this.d.paths.logos, path.basename(f)) : path.join(this.d.paths.receipts, path.basename(f));
        if (fs.existsSync(source)) present.push({ name: f, source }); else missing.push(f);
      }

      // 3. Enough room?
      const needed = fs.statSync(snapshot).size + present.reduce((s, p) => s + fs.statSync(p.source).size, 0);
      const free = this.freeBytes(destDir);
      if (free !== null && free < needed * 1.05 + 1_000_000) {
        throw new AppError('CONFLICT', `There is not enough free space for this backup. It needs about ${Math.ceil(needed / 1_048_576)} MB and the backup folder has ${Math.floor(free / 1_048_576)} MB free. Free some space or choose another folder.`);
      }

      // 4. Write the archive under a temporary name, then rename: a failed backup never looks like a good one.
      let zip: ZipFileWriter;
      try { zip = new ZipFileWriter(partial); } catch (e) { throw friendlyFsError(e, 'the backup folder'); }
      let bytes = 0;
      try {
        const db = await zip.addFile('database/gable.db', snapshot, true);
        const entries = [];
        for (const p of present) entries.push(await zip.addFile(p.name, p.source, false));
        const manifest: Manifest = {
          format: BACKUP_FORMAT, app: 'Gable', appVersion: this.d.appVersion, schemaVersion: info.schemaVersion, createdAt: created.toISOString(), kind,
          counts: info.counts, database: { name: 'database/gable.db', sha256: db.sha256, size: db.size }, files: entries, missing,
        };
        zip.addText('manifest.json', JSON.stringify(manifest, null, 2));
        zip.finish();
        bytes = fs.statSync(partial).size;
        fs.renameSync(partial, path.join(destDir, finalName));
      } catch (e) {
        zip.close();
        throw e instanceof AppError ? e : friendlyFsError(e, 'the backup folder');
      }
      if (kind === 'auto') this.prune(destDir);
      return {
        file: finalName, bytes, createdAt: created.toISOString(), kind,
        warnings: missing.length ? [`${missing.length} receipt ${missing.length === 1 ? 'file was' : 'files were'} already missing from Gable's storage and could not be included.`] : [],
      };
    } catch (e) {
      rmQuiet(partial);
      throw e;
    } finally {
      rmQuiet(workDir, true);
      release();
      this.running = false;
    }
  }

  private describeSnapshot(file: string): { schemaVersion: number; counts: Manifest['counts']; files: string[] } {
    const db = new Database(file, { readonly: true });
    try {
      // Older backups lack newer tables; a missing table simply counts as empty.
      const has = (t: string) => db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t) !== undefined;
      const n = (table: string, sql: string) => (has(table) ? (db.prepare(sql).get() as { n: number }).n : 0);
      const names = (table: string, sql: string, prefix: string) => (has(table) ? (db.prepare(sql).all() as { n: string }[]).map((r) => `${prefix}${r.n}`) : []);
      const files = [
        ...names('expense_attachment', 'SELECT stored_name AS n FROM expense_attachment', 'receipts/'),
        ...names('receipt_draft_file', 'SELECT stored_name AS n FROM receipt_draft_file', 'receipts/'),
        ...names('company', 'SELECT logo_file AS n FROM company WHERE logo_file IS NOT NULL', 'logos/'),
      ];
      return {
        schemaVersion: n('schema_migration', 'SELECT COALESCE(MAX(version), 0) AS n FROM schema_migration'),
        counts: {
          companies: n('company', 'SELECT COUNT(*) AS n FROM company'), properties: n('property', 'SELECT COUNT(*) AS n FROM property'),
          expenses: n('expense', 'SELECT COUNT(*) AS n FROM expense'), receipts: n('expense_attachment', 'SELECT COUNT(*) AS n FROM expense_attachment'),
          drafts: n('receipt_draft', "SELECT COUNT(*) AS n FROM receipt_draft WHERE status <> 'saved'"),
        },
        files: [...new Set(files)],
      };
    } finally {
      db.close();
    }
  }

  list(destDir: string): { file: string; bytes: number; modifiedAt: string; kind: string }[] {
    try {
      return fs.readdirSync(destDir)
        .filter((f) => /^Gable-backup-.*\.zip$/.test(f))
        .map((f) => ({ file: f, bytes: fs.statSync(path.join(destDir, f)).size, modifiedAt: fs.statSync(path.join(destDir, f)).mtime.toISOString(), kind: /-(manual|auto|pre-restore)\.zip$/.exec(f)?.[1] ?? 'manual' }))
        .sort((a, b) => b.file.localeCompare(a.file));
    } catch {
      return [];
    }
  }

  /** Keeps the newest AUTO_BACKUP_RETENTION automatic backups. Never touches manual or pre-restore backups. */
  private prune(destDir: string): void {
    const autos = this.list(destDir).filter((b) => b.kind === 'auto');
    for (const b of autos.slice(AUTO_BACKUP_RETENTION)) rmQuiet(path.join(destDir, b.file));
  }

  /** Receipts the database refers to that are missing on disk, so the person can act on them. */
  checkFiles(): { missing: { kind: 'expense' | 'draft' | 'logo'; id: number; label: string; file: string }[]; unreferenced: number } {
    const db = this.d.getDb();
    const missing: { kind: 'expense' | 'draft' | 'logo'; id: number; label: string; file: string }[] = [];
    const has = (dir: string, name: string) => fs.existsSync(path.join(dir, path.basename(name)));
    for (const r of db.prepare(`SELECT a.expense_id AS id, a.original_name AS label, a.stored_name AS f, v.name AS vendor FROM expense_attachment a JOIN expense e ON e.id = a.expense_id JOIN vendor v ON v.id = e.vendor_id`).all() as { id: number; label: string; f: string; vendor: string }[]) {
      if (!has(this.d.paths.receipts, r.f)) missing.push({ kind: 'expense', id: r.id, label: `${r.label} (expense for ${r.vendor})`, file: r.f });
    }
    for (const r of db.prepare('SELECT draft_id AS id, original_name AS label, stored_name AS f FROM receipt_draft_file').all() as { id: number; label: string; f: string }[]) {
      if (!has(this.d.paths.receipts, r.f)) missing.push({ kind: 'draft', id: r.id, label: `${r.label} (waiting for review)`, file: r.f });
    }
    for (const r of db.prepare('SELECT id, display_name AS label, logo_file AS f FROM company WHERE logo_file IS NOT NULL').all() as { id: number; label: string; f: string }[]) {
      if (!has(this.d.paths.logos, r.f)) missing.push({ kind: 'logo', id: r.id, label: `Logo of ${r.label}`, file: r.f });
    }
    const known = new Set([
      ...(db.prepare('SELECT stored_name AS n FROM expense_attachment').all() as { n: string }[]).map((x) => x.n),
      ...(db.prepare('SELECT stored_name AS n FROM receipt_draft_file').all() as { n: string }[]).map((x) => x.n),
    ]);
    const unreferenced = fs.existsSync(this.d.paths.receipts) ? fs.readdirSync(this.d.paths.receipts).filter((f) => !known.has(f)).length : 0;
    return { missing, unreferenced };
  }

  // ------------------------------------------------------------------ checking a backup before restoring it

  /**
   * Extracts a backup into a private staging folder and verifies everything: safe file names, manifest, schema
   * version, checksums, database integrity and that every receipt it refers to is present. Nothing is replaced yet.
   */
  async inspect(zipPath: string): Promise<RestoreSummary> {
    const token = crypto.randomBytes(12).toString('hex');
    const dir = path.join(this.d.paths.staging, `restore-${token}`);
    try {
      if (!fs.existsSync(zipPath)) throw new AppError('NOT_FOUND', 'That backup file could not be found.');
      let entries: ExtractedEntry[];
      try {
        entries = await extractZip(zipPath, dir);
      } catch (e) {
        if (e instanceof ArchiveError) throw new AppError('VALIDATION', e.message);
        if (typeof (e as NodeJS.ErrnoException).code === 'string') throw friendlyFsError(e, 'the temporary folder');
        throw new AppError('VALIDATION', 'This backup is damaged and could not be read. It was not used.');
      }
      const byName = new Map(entries.map((x) => [x.name, x]));
      const mf = path.join(dir, 'manifest.json');
      if (!fs.existsSync(mf)) throw new AppError('VALIDATION', 'This backup is incomplete: it has no manifest. It was not used.');
      let manifest: Manifest;
      try { manifest = JSON.parse(fs.readFileSync(mf, 'utf8')) as Manifest; } catch { throw new AppError('VALIDATION', 'This backup is damaged: its manifest cannot be read.'); }
      if (manifest.app !== 'Gable' || !Number.isInteger(manifest.format) || !Number.isInteger(manifest.schemaVersion) || !manifest.database || !Array.isArray(manifest.files)) {
        throw new AppError('VALIDATION', 'This file is not a Gable backup.');
      }
      if (manifest.format > BACKUP_FORMAT || manifest.schemaVersion > LATEST_SCHEMA) {
        throw new AppError('VALIDATION', 'This backup was made by a newer version of Gable. Update Gable, then restore it. Nothing was changed.');
      }
      const expected = new Map<string, { sha256: string; size: number }>([[manifest.database.name, manifest.database], ...manifest.files.map((f) => [f.name, f] as const)]);
      for (const name of expected.keys()) {
        if (!isSafeEntryName(name)) throw new AppError('VALIDATION', 'This backup lists an unsafe file name and was not used.');
      }
      for (const [name, want] of expected) {
        const got = byName.get(name);
        if (!got) throw new AppError('VALIDATION', 'This backup is incomplete: a file listed in it is missing. It was not used.');
        if (got.sha256 !== want.sha256 || got.size !== want.size) throw new AppError('VALIDATION', 'This backup is damaged: a file does not match its checksum. It was not used.');
      }
      for (const name of byName.keys()) {
        if (name !== 'manifest.json' && !expected.has(name)) throw new AppError('VALIDATION', 'This backup contains files that are not in its manifest and was not used.');
      }
      const dbFile = path.join(dir, manifest.database.name);
      let db: Database.Database;
      try { db = new Database(dbFile, { readonly: true }); } catch { throw new AppError('VALIDATION', 'The database in this backup cannot be opened. It was not used.'); }
      let info: ReturnType<BackupService['describeSnapshot']>;
      try {
        const check = db.pragma('integrity_check', { simple: true });
        if (check !== 'ok') throw new AppError('VALIDATION', 'The database in this backup failed its integrity check. It was not used.');
      } catch (e) {
        if (e instanceof AppError) throw e;
        throw new AppError('VALIDATION', 'The database in this backup cannot be read. It was not used.');
      } finally {
        db.close();
      }
      try { info = this.describeSnapshot(dbFile); } catch { throw new AppError('VALIDATION', 'The database in this backup is not a Gable database. It was not used.'); }
      if (info.schemaVersion !== manifest.schemaVersion) throw new AppError('VALIDATION', 'This backup is inconsistent (its data version does not match its manifest). It was not used.');
      const warnings: string[] = [];
      const missingNow = info.files.filter((f) => !byName.has(f));
      const declared = new Set(manifest.missing ?? []);
      if (missingNow.some((f) => !declared.has(f))) throw new AppError('VALIDATION', 'This backup is incomplete: receipts that the data refers to are not in it. It was not used.');
      if (missingNow.length) warnings.push(`${missingNow.length} receipt ${missingNow.length === 1 ? 'file was' : 'files were'} already missing when this backup was made, so they cannot be restored.`);
      return { token, createdAt: manifest.createdAt, appVersion: manifest.appVersion, schemaVersion: manifest.schemaVersion, upgradeNeeded: manifest.schemaVersion < LATEST_SCHEMA, counts: info.counts, warnings };
    } catch (e) {
      rmQuiet(dir, true);
      throw e;
    }
  }

  discard(token: string): void {
    if (/^[0-9a-f]{24}$/.test(token)) rmQuiet(path.join(this.d.paths.staging, `restore-${token}`), true);
  }

  // ------------------------------------------------------------------ restoring

  /**
   * Replaces the whole data set (every company) with the staged backup. A pre-restore backup of the current data
   * is made first. If any step fails, the previous data is put back. `closeDb` must release the database files.
   */
  async restore(token: string, opts: { backupDir: string; closeDb: () => void; fault?: (point: string) => void }): Promise<{ upgradedFrom: number | null; preRestoreBackup: string }> {
    if (!/^[0-9a-f]{24}$/.test(token)) throw new AppError('VALIDATION', 'That restore is no longer available. Choose the backup again.');
    const stage = path.join(this.d.paths.staging, `restore-${token}`);
    if (!fs.existsSync(path.join(stage, 'manifest.json'))) throw new AppError('NOT_FOUND', 'That restore is no longer available. Choose the backup again.');
    const fault = opts.fault ?? (() => {});
    const free = this.freeBytes(this.d.paths.root);
    const stagedBytes = dirSize(stage);
    if (free !== null && free < stagedBytes * 1.1 + 5_000_000) {
      throw new AppError('CONFLICT', `There is not enough free space to restore this backup. Free about ${Math.ceil((stagedBytes * 1.1 + 5_000_000 - free) / 1_048_576)} MB and try again. Nothing was changed.`);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(stage, 'manifest.json'), 'utf8')) as Manifest;

    // 1. A safety copy of everything that is about to be replaced.
    let pre: BackupResult;
    try {
      pre = await this.create('pre-restore', opts.backupDir);
    } catch (e) {
      throw new AppError('CONFLICT', `Gable could not make a safety copy of your current data first, so nothing was changed. ${e instanceof AppError ? e.message : ''}`.trim());
    }
    fault('after-pre-restore-backup');

    // 2. Swap, keeping the old data aside so it can be put back.
    opts.closeDb();
    const rb = path.join(this.d.paths.root, `rollback-${Date.now()}`);
    const moved: [string, string][] = []; // old data moved aside: [original place, aside place]
    const installed: string[] = []; // new data put in place, to be removed if we must roll back
    const move = (from: string, to: string) => {
      if (!fs.existsSync(from)) return;
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(from, to);
      moved.push([from, to]);
    };
    const p = this.d.paths;
    try {
      fs.mkdirSync(rb, { recursive: true });
      move(p.database, path.join(rb, 'gable.db'));
      move(`${p.database}-wal`, path.join(rb, 'gable.db-wal'));
      move(`${p.database}-shm`, path.join(rb, 'gable.db-shm'));
      fault('after-move-db');
      move(p.receipts, path.join(rb, 'receipts'));
      fault('after-move-receipts');
      move(p.logos, path.join(rb, 'logos'));
      fault('after-move-logos');
      fs.renameSync(path.join(stage, manifest.database.name), p.database);
      installed.push(p.database);
      fault('after-install-db');
      fs.mkdirSync(p.receipts, { recursive: true });
      installed.push(p.receipts);
      fs.mkdirSync(p.logos, { recursive: true });
      installed.push(p.logos);
      for (const f of manifest.files) fs.renameSync(path.join(stage, f.name), path.join(f.name.startsWith('logos/') ? p.logos : p.receipts, path.basename(f.name)));
      fault('after-install-files');

      // 3. Prove the restored data opens, upgrades if it is older, and passes its integrity check.
      const upgraded = { from: null as number | null };
      const check = openDatabase(p.database, { beforeUpgrade: (db, from, to) => { upgraded.from = from; preUpgradeSnapshotter(path.join(p.backups, 'pre-upgrade'))(db, from, to); } });
      try {
        if (check.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('integrity');
      } finally {
        check.close();
      }
      fault('after-verify');
      rmQuiet(rb, true);
      rmQuiet(stage, true);
      return { upgradedFrom: upgraded.from, preRestoreBackup: pre.file };
    } catch (e) {
      // Put everything back exactly as it was: remove only what this restore installed, then return the old data.
      for (const f of installed) rmQuiet(f, true);
      rmQuiet(`${p.database}-wal`);
      rmQuiet(`${p.database}-shm`);
      for (const [from, to] of [...moved].reverse()) {
        try { fs.mkdirSync(path.dirname(from), { recursive: true }); fs.renameSync(to, from); } catch { /* best effort; the safety backup still holds everything */ }
      }
      rmQuiet(rb, true);
      rmQuiet(stage, true);
      throw new AppError('CONFLICT', `The restore could not be completed, so your previous data was put back unchanged. A safety copy is also saved as ${pre.file}. ${e instanceof AppError ? e.message : ''}`.trim());
    }
  }
}

function dirSize(dir: string): number {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
}
