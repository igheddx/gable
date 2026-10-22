import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { migrations, type Migration } from './migrations';

export type Db = Database.Database;

export function openDatabase(file: string, migrationList: Migration[] = migrations): Db {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db, migrationList);
  return db;
}

export function migrate(db: Db, migrationList: Migration[]): void {
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
  for (const m of migrationList.filter((x) => x.version > current).sort((a, b) => a.version - b.version)) {
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migration (version, name, applied_at) VALUES (?, ?, ?)').run(
        m.version,
        m.name,
        new Date().toISOString(),
      );
    })();
  }
}

export function schemaVersion(db: Db): number {
  const row = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migration').get() as { v: number };
  return row.v;
}
