import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { migrations, type Migration } from './migrations';

export type Db = Database.Database;

export interface OpenOptions {
  migrations?: Migration[];
  /**
   * Called before an upgrade changes an existing database, so a copy can be kept. If it throws, the
   * database is left untouched and opening fails rather than risking the person's data.
   */
  beforeUpgrade?: (db: Db, fromVersion: number, toVersion: number) => void;
  busyTimeoutMs?: number;
}

export function openDatabase(file: string, opts: OpenOptions | Migration[] = {}): Db {
  const o: OpenOptions = Array.isArray(opts) ? { migrations: opts } : opts;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma(`busy_timeout = ${o.busyTimeoutMs ?? 5000}`);
  try {
    migrate(db, o.migrations ?? migrations, o.beforeUpgrade);
  } catch (e) {
    db.close();
    throw e;
  }
  return db;
}

/** All pending migrations run in ONE transaction: an upgrade either completes or leaves the database exactly as it was. */
export function migrate(db: Db, migrationList: Migration[], beforeUpgrade?: OpenOptions['beforeUpgrade']): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migration (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT;`);
  const current = schemaVersion(db);
  const latest = migrationList.reduce((m, x) => Math.max(m, x.version), 0);
  if (current > latest) {
    throw new Error(
      `Database schema version ${current} is newer than this app supports (${latest}). Update Gable.`,
    );
  }
  const pending = migrationList.filter((x) => x.version > current).sort((a, b) => a.version - b.version);
  if (pending.length === 0) return;
  if (current > 0) beforeUpgrade?.(db, current, latest);
  db.transaction(() => {
    for (const m of pending) {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migration (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, new Date().toISOString());
    }
  })();
}

export function schemaVersion(db: Db): number {
  const row = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migration').get() as { v: number };
  return row.v;
}
