import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrate, openDatabase, schemaVersion } from '../../src/db/connection';
import { migrations } from '../../src/db/migrations';
import { SettingsRepository } from '../../src/db/settingsRepository';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gable-test-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('database', () => {
  it('initializes an empty database to the latest schema with WAL and foreign keys on', () => {
    const db = openDatabase(path.join(dir, 'sub', 'gable.db'));
    expect(schemaVersion(db)).toBe(Math.max(...migrations.map((m) => m.version)));
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.close();
  });

  it('reopens without losing data and without re-running migrations', () => {
    const file = path.join(dir, 'gable.db');
    const first = openDatabase(file);
    new SettingsRepository(first).set('ui.lastVisitedNote', 'hello');
    first.close();

    const second = openDatabase(file);
    expect(new SettingsRepository(second).get('ui.lastVisitedNote')).toBe('hello');
    const rows = second.prepare('SELECT COUNT(*) AS n FROM schema_migration').get() as { n: number };
    expect(rows.n).toBe(migrations.length);
    second.close();
  });

  it('rolls back a failing migration and leaves the version unchanged', () => {
    const db = new Database(':memory:');
    migrate(db, migrations);
    const bad = [...migrations, { version: 99, name: 'bad', sql: 'CREATE TABLE ok (id INTEGER); SELECT * FROM missing_table;' }];
    expect(() => migrate(db, bad)).toThrow();
    expect(schemaVersion(db)).toBe(1);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'ok'").get()).toBeUndefined();
    db.close();
  });

  it('refuses a database from a newer app version', () => {
    const db = new Database(':memory:');
    migrate(db, [...migrations, { version: 50, name: 'future', sql: 'SELECT 1' }]);
    expect(() => migrate(db, migrations)).toThrow(/newer than this app supports/);
    db.close();
  });

  it('upserts settings with parameterized SQL (quotes are data, not SQL)', () => {
    const db = openDatabase(path.join(dir, 'gable.db'));
    const repo = new SettingsRepository(db);
    const nasty = "'); DROP TABLE setting; --";
    repo.set('ui.lastVisitedNote', nasty);
    repo.set('ui.lastVisitedNote', nasty + '2');
    expect(repo.get('ui.lastVisitedNote')).toBe(nasty + '2');
    expect(repo.get('missing')).toBeNull();
    db.close();
  });
});
