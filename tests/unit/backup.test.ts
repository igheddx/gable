import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { unzipSync, zipSync } from 'fflate';
import { openDatabase } from '../../src/db/connection';
import { migrations } from '../../src/db/migrations';
import { isSafeEntryName } from '../../src/services/backup/archive';
import { AUTO_BACKUP_RETENTION, BackupConfigStore, LATEST_SCHEMA, autoBackupDue, preUpgradeSnapshotter, type BackupService } from '../../src/services/backup/backupService';
import { CategoryService } from '../../src/services/categoryService';
import { CompanyService } from '../../src/services/companyService';
import { ExpenseService } from '../../src/services/expenseService';
import { FinancialService } from '../../src/services/financialService';
import { PropertyService } from '../../src/services/propertyService';
import { ReceiptFiles } from '../../src/services/receiptFiles';
import { ReceiptService } from '../../src/services/receiptService';
import { AppError } from '../../src/shared/errors';
import { PNG, TODAY, backupFor, company, exp, makeStack, prop, type Stack } from './helpers';
import { FakeOcr, fakeReceipt } from './fakeOcr';

let a: Stack; // the profile being backed up
let b: Stack; // a fresh profile to restore into
let dest: string;
let svcA: BackupService;
beforeEach(() => {
  a = makeStack();
  b = makeStack();
  dest = fs.mkdtempSync(path.join(os.tmpdir(), 'gable-dest-'));
  svcA = backupFor(a);
});
afterEach(() => {
  a.cleanup();
  b.cleanup();
  fs.rmSync(dest, { recursive: true, force: true });
});

const PNG_LOGO = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 3)]);

/** Three companies, properties, posted and split expenses with receipts, a reviewed-but-unsaved draft, a rule and a logo. */
async function populate(s: Stack) {
  const oak = s.companies.create(company('Oak House LLC')).id;
  const cedar = s.companies.create(company('Cedar Homes LLC')).id;
  s.companies.create(company('North Property LLC'));
  s.companies.setDefault(cedar);
  const logo = path.join(s.dir, 'logo-src.png');
  fs.writeFileSync(logo, PNG_LOGO);
  s.companies.setLogoFromFile(cedar, logo);
  const p1 = s.properties.create(oak, prop({ address1: '125 Oak Drive', status: 'Sold', saleDate: '2026-03-15', salePriceCents: 31_000_000 })).id;
  const p2 = s.properties.create(cedar, prop({ address1: '17 Oak Hollow Road', purchaseDate: '2025-09-10', purchasePriceCents: 26_900_000 })).id;
  const staged = [s.expenses.stageFile('page1.png', PNG).stagedId, s.expenses.stageFile('page2.png', Buffer.concat([PNG, Buffer.from('2')])).stagedId];
  s.expenses.create(exp(s, oak, p1, '2025-01-15', 'Summit Title', { 'Purchase Closing Costs': 500_000 }, { stagedFileIds: staged }));
  s.expenses.create(exp(s, oak, p1, '2025-03-10', 'Harbor Lumber', { Materials: 1_200_000, Labor: 800_000 }));
  s.expenses.create(exp(s, oak, p1, '2026-03-15', 'Closing Agent', { 'Realtor Commissions': 1_500_000, 'Seller Closing Costs': 300_000 }));
  s.expenses.create(exp(s, cedar, null, '2026-02-01', 'Northfield Insurance', { Insurance: 100_000 }));
  s.expenses.create(exp(s, cedar, p2, '2026-08-20', 'Keystone Plumbing', { Plumbing: 312_575 }));
  s.receipts.createRule(cedar, 'Harbor Lumber & Supply', s.cat(cedar, 'Materials'));
  const imp = await s.receipts.importGroups(cedar, p2, [[s.expenses.stageFile('draft.png', fakeReceipt('HARBOR LUMBER & SUPPLY\\nDate 09/18/2026\\nTOTAL 165.25')).stagedId]]);
  await s.receipts.whenIdle();
  s.receipts.update(imp.created[0]!.id, { vendor: 'Harbor (my correction)' });
  return { oak, cedar, p1, p2, draftId: imp.created[0]!.id };
}

/** Everything a person would notice, as plain data, to compare before and after. */
function snapshot(db: ReturnType<typeof openDatabase>, receiptsDir: string, logosDir: string) {
  const companies = new CompanyService(db, logosDir);
  const files = new ReceiptFiles(receiptsDir, path.join(path.dirname(receiptsDir), 'staging'));
  const expenses = new ExpenseService(db, companies, files);
  const receipts = new ReceiptService(db, companies, expenses, files, new FakeOcr(), { today: () => TODAY });
  const fin = new FinancialService(db, () => TODAY);
  const props = new PropertyService(db, companies).list({ scope: 'all', includeArchived: true, pageSize: 100 }).rows;
  const exps = expenses.list({ scope: 'all', includeVoided: true, pageSize: 100 }).rows;
  return {
    companies: companies.list(true).map((c) => [c.displayName, c.isDefault, c.hasLogo]),
    defaultId: companies.getDefaultId(),
    properties: props.map((p) => [p.address1, p.status, p.purchasePriceCents, p.salePriceCents]),
    expenses: exps.map((e) => [e.vendorName, e.expenseDate, e.totalCents, e.allocations.map((x) => `${x.categoryName}:${x.amountCents}`).join('|'), e.attachments.length]),
    bridge: props.map((p) => fin.propertyFinancials(p.id).bridge),
    attachmentHashes: exps.flatMap((e) => e.attachments).length,
    drafts: receipts.list({ scope: 'all' }).map((d) => [d.vendor, d.totalCents, d.status, d.files.length]),
    rules: companies.list(true).flatMap((c) => receipts.rules(c.id).map((r) => [c.displayName, r.vendorName, r.categoryName])),
    logos: companies.list(true).map((c) => (c.hasLogo ? companies.getLogoDataUrl(c.id) : null)),
    files: fs.existsSync(receiptsDir) ? fs.readdirSync(receiptsDir).sort().map((f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(receiptsDir, f))).digest('hex')) : [],
  };
}

const opts = (s: Stack, extra: Record<string, unknown> = {}) => ({ backupDir: path.join(s.dir, 'backups'), closeDb: () => s.db.close(), ...extra });
const reopen = (s: Stack) => { s.db = openDatabase(path.join(s.dir, 'gable.db')); return s.db; };
const snap = (s: Stack) => snapshot(s.db, s.receiptsDir, path.join(s.dir, 'logos'));
const errOf = async (fn: () => Promise<unknown>): Promise<AppError> => { try { await fn(); } catch (e) { if (e instanceof AppError) return e; throw e; } throw new Error('expected AppError'); };

describe('backup and restore round trip', () => {
  it('restores every company, total, receipt, draft, rule, logo and the default into a fresh profile, replacing (not merging) what was there', async () => {
    await populate(a);
    const before = snap(a);
    const made = await svcA.create('manual', dest);
    expect(made.file).toMatch(/^Gable-backup-\d{8}-\d{6}-manual\.zip$/);
    expect(made.warnings).toEqual([]);
    expect(fs.readdirSync(dest)).toEqual([made.file]); // no partial file left

    b.companies.create(company('Existing Company I Will Lose'));
    const svcB = backupFor(b);
    const summary = await svcB.inspect(path.join(dest, made.file));
    expect(summary.counts).toMatchObject({ companies: 3, properties: 2, expenses: 5, receipts: 2, drafts: 1 });
    expect(summary.upgradeNeeded).toBe(false);
    const result = await svcB.restore(summary.token, opts(b));
    expect(result.upgradedFrom).toBeNull();
    reopen(b);

    expect(snap(b)).toEqual(before);
    expect(new CompanyService(b.db, path.join(b.dir, 'logos')).list(true).map((c) => c.displayName)).not.toContain('Existing Company I Will Lose');
    expect(fs.readdirSync(path.join(b.dir, 'staging'))).toEqual([]);
    expect(fs.readdirSync(b.dir).filter((f) => f.startsWith('rollback-'))).toEqual([]);
    // The pre-restore backup holds the data that was replaced, and is itself restorable.
    const pre = fs.readdirSync(path.join(b.dir, 'backups')).find((f) => f.endsWith('-pre-restore.zip'))!;
    const again = await backupFor(b).inspect(path.join(b.dir, 'backups', pre));
    expect(again.counts.companies).toBe(1);
  });

  it('restores into a profile with a different history and keeps working afterwards (new expense, new backup)', async () => {
    const ids = await populate(a);
    const made = await svcA.create('manual', dest);
    const svcB = backupFor(b);
    await svcB.restore((await svcB.inspect(path.join(dest, made.file))).token, opts(b));
    reopen(b);
    const companies = new CompanyService(b.db, path.join(b.dir, 'logos'));
    const expenses = new ExpenseService(b.db, companies, b.files);
    const created = expenses.create(exp({ ...b, cat: (c, n) => new CategoryService(b.db, companies).list(c, true).find((x) => x.name === n)!.id } as Stack, ids.oak, ids.p1, '2026-04-01', 'After Restore', { Materials: 100 }));
    expect(created.id).toBeGreaterThan(5);
    const second = await backupFor(b).create('manual', dest);
    expect((await backupFor(b).inspect(path.join(dest, second.file))).counts.expenses).toBe(6);
  });

  it('keeps every receipt on disk until the archive is written, even if one is removed mid-backup, and includes it', async () => {
    const ids = await populate(a);
    const exp1 = a.expenses.list({ scope: ids.oak, pageSize: 100 }).rows.find((e) => e.attachments.length === 2)!;
    const backup = svcA.create('manual', dest); // the snapshot is taken now; files stream out over the next ticks
    a.expenses.update(exp1.id, { propertyId: exp1.propertyId, vendorName: exp1.vendorName, expenseDate: exp1.expenseDate, totalCents: exp1.totalCents, allocations: exp1.allocations.map((x) => ({ categoryId: x.categoryId, amountCents: x.amountCents })), notes: '', stagedFileIds: [], removeAttachmentIds: exp1.attachments.map((x) => x.id) });
    const made = await backup;
    expect(made.warnings).toEqual([]); // nothing went missing
    expect(fs.readdirSync(a.receiptsDir).length).toBeLessThan(3); // and the removed receipts were deleted once the backup finished
    const summary = await backupFor(b).inspect(path.join(dest, made.file));
    expect(summary.counts.receipts).toBe(2); // the snapshot still had them
  });
});

describe('a backup that cannot be trusted is refused, and nothing is changed', () => {
  const entries = (zip: string) => unzipSync(new Uint8Array(fs.readFileSync(zip)));
  const write = (name: string, files: Record<string, Uint8Array>) => { const f = path.join(dest, name); fs.writeFileSync(f, zipSync(files, { level: 0 })); return f; };
  const sha = (u: Uint8Array) => crypto.createHash('sha256').update(u).digest('hex');
  let good: string;
  beforeEach(async () => {
    await populate(a);
    good = path.join(dest, (await svcA.create('manual', dest)).file);
    b.companies.create(company('Keep Me'));
  });
  const refuses = async (zip: string, message: RegExp) => {
    const before = snap(b);
    const e = await errOf(() => backupFor(b).inspect(zip));
    expect(e.message).toMatch(message);
    expect(fs.readdirSync(path.join(b.dir, 'staging'))).toEqual([]); // nothing left behind
    expect(snap(b)).toEqual(before);
  };

  it('a file that is not a backup', async () => {
    const f = path.join(dest, 'notes.zip');
    fs.writeFileSync(f, 'just some text');
    await refuses(f, /not a Gable backup/);
    const empty = path.join(dest, 'empty.zip');
    fs.writeFileSync(empty, '');
    await refuses(empty, /not a Gable backup/);
  });

  it('a truncated archive', async () => {
    const cut = path.join(dest, 'cut.zip');
    fs.writeFileSync(cut, fs.readFileSync(good).subarray(0, Math.floor(fs.statSync(good).size / 2)));
    await refuses(cut, /damaged|incomplete|not a Gable backup|manifest/);
  });

  it('a missing manifest', async () => {
    const e = entries(good);
    delete e['manifest.json'];
    await refuses(write('nomanifest.zip', e), /no manifest/);
  });

  it('a database that does not match its checksum', async () => {
    const e = entries(good);
    const db = e['database/gable.db']!.slice();
    db[db.length - 100] = (db[db.length - 100]! + 1) & 0xff;
    e['database/gable.db'] = db;
    await refuses(write('badsum.zip', e), /checksum/);
  });

  it('a receipt that does not match its checksum, or is missing', async () => {
    const e = entries(good);
    const name = Object.keys(e).find((n) => n.startsWith('receipts/'))!;
    const tampered = { ...e, [name]: new Uint8Array([1, 2, 3]) };
    await refuses(write('badreceipt.zip', tampered), /checksum/);
    const dropped = { ...e };
    delete dropped[name];
    await refuses(write('dropped.zip', dropped), /incomplete/);
  });

  it('file names that try to escape the folder', async () => {
    const e = entries(good);
    await refuses(write('traversal.zip', { ...e, '../evil.txt': new Uint8Array([1]) }), /unsafe/);
    await refuses(write('traversal2.zip', { ...e, 'receipts/../../evil.txt': new Uint8Array([1]) }), /unsafe/);
    await refuses(write('absolute.zip', { ...e, '/etc/evil.txt': new Uint8Array([1]) }), /unsafe/);
    await refuses(write('drive.zip', { ...e, 'C:\\evil.txt': new Uint8Array([1]) }), /unsafe/);
    expect(fs.existsSync(path.join(path.dirname(b.dir), 'evil.txt'))).toBe(false);
    expect(fs.existsSync(path.join(b.dir, 'evil.txt'))).toBe(false);
  });

  it('a file that is not in the manifest', async () => {
    await refuses(write('extra.zip', { ...entries(good), 'receipts/sneaky.png': new Uint8Array([9, 9]) }), /not in its manifest/);
  });

  it('a backup from a newer version of Gable, whether declared in the manifest or the database', async () => {
    const e = entries(good);
    const m = JSON.parse(new TextDecoder().decode(e['manifest.json'])) as { schemaVersion: number; format: number };
    await refuses(write('future1.zip', { ...e, 'manifest.json': new TextEncoder().encode(JSON.stringify({ ...m, schemaVersion: 999 })) }), /newer version/);
    await refuses(write('future2.zip', { ...e, 'manifest.json': new TextEncoder().encode(JSON.stringify({ ...m, format: 99 })) }), /newer version/);
    // Database says a newer schema than the manifest admits.
    const tmp = path.join(dest, 'future.db');
    fs.writeFileSync(tmp, e['database/gable.db']!);
    const d = new Database(tmp);
    d.pragma('journal_mode = DELETE');
    d.prepare("INSERT INTO schema_migration (version, name, applied_at) VALUES (999, 'future', 'now')").run();
    d.close();
    const dbBytes = new Uint8Array(fs.readFileSync(tmp));
    const mf = { ...(JSON.parse(new TextDecoder().decode(e['manifest.json'])) as { database: object }), database: { name: 'database/gable.db', sha256: sha(dbBytes), size: dbBytes.length } };
    await refuses(write('future3.zip', { ...e, 'database/gable.db': dbBytes, 'manifest.json': new TextEncoder().encode(JSON.stringify(mf)) }), /inconsistent|newer/);
  });

  it('a corrupted database whose checksum was also rewritten', async () => {
    const e = entries(good);
    const junk = new TextEncoder().encode('SQLite format 3\0 this is not a database '.repeat(50));
    const m = JSON.parse(new TextDecoder().decode(e['manifest.json'])) as Record<string, unknown>;
    m.database = { name: 'database/gable.db', sha256: sha(junk), size: junk.length };
    await refuses(write('junkdb.zip', { ...e, 'database/gable.db': junk, 'manifest.json': new TextEncoder().encode(JSON.stringify(m)) }), /cannot be (opened|read)|integrity|not a Gable database/);
  });
});

describe('a restore that fails part-way puts everything back', () => {
  const points = ['after-pre-restore-backup', 'after-move-db', 'after-move-receipts', 'after-move-logos', 'after-install-db', 'after-install-files', 'after-verify'];
  for (const point of points) {
    it(`failing at ${point} leaves the original data intact and usable`, async () => {
      await populate(b); // the data that must survive
      const survivor = snap(b);
      await populate(a);
      const made = await svcA.create('manual', dest);
      const svcB = backupFor(b);
      const token = (await svcB.inspect(path.join(dest, made.file))).token;
      await expect(svcB.restore(token, opts(b, { fault: (p: string) => { if (p === point) throw new Error('simulated failure'); } }))).rejects.toThrow();
      if (b.db.open === false) reopen(b);
      expect(snap(b)).toEqual(survivor);
      expect(fs.readdirSync(b.dir).filter((f) => f.startsWith('rollback-'))).toEqual([]);
      // Still fully usable: a new backup works and verifies.
      const again = await backupFor(b).create('manual', dest);
      expect((await backupFor(b).inspect(path.join(dest, again.file))).counts.companies).toBe(3);
    }, 60_000);
  }
});

describe('older backups upgrade after restore', () => {
  it('restores a version 2 backup, upgrades it in one step, keeps the data, and keeps a pre-upgrade copy', async () => {
    const old = path.join(dest, 'v2.db');
    const odb = openDatabase(old, { migrations: migrations.filter((m) => m.version <= 2) });
    odb.prepare("INSERT INTO company (display_name, name_key, created_at, updated_at) VALUES ('Legacy LLC', 'legacy llc', 'n', 'n')").run();
    odb.prepare("INSERT INTO property (company_id, address1, city, state, zip, search_text, purchase_date, purchase_price_cents, status, created_at, updated_at) VALUES (1, '1 Legacy Way', 'Town', 'TN', '37201', '1 legacy way', '2020-01-01', 5000000, 'Held', 'n', 'n')").run();
    odb.close();
    const dbBytes = new Uint8Array(fs.readFileSync(old));
    const manifest = {
      format: 1, app: 'Gable', appVersion: '0.0.1', schemaVersion: 2, createdAt: '2026-01-01T00:00:00.000Z', kind: 'manual',
      counts: { companies: 1, properties: 1, expenses: 0, receipts: 0, drafts: 0 }, database: { name: 'database/gable.db', sha256: crypto.createHash('sha256').update(dbBytes).digest('hex'), size: dbBytes.length }, files: [], missing: [],
    };
    // describeSnapshot expects the newest tables, so an old archive is read through a tolerant path: it must still be accepted.
    const zip = path.join(dest, 'old.zip');
    fs.writeFileSync(zip, zipSync({ 'database/gable.db': dbBytes, 'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)) }, { level: 0 }));
    const svcB = backupFor(b);
    const summary = await svcB.inspect(zip);
    expect(summary).toMatchObject({ schemaVersion: 2, upgradeNeeded: true, counts: { companies: 1, properties: 1 } });
    const result = await svcB.restore(summary.token, opts(b));
    expect(result.upgradedFrom).toBe(2);
    reopen(b);
    expect((b.db.prepare('SELECT MAX(version) AS v FROM schema_migration').get() as { v: number }).v).toBe(LATEST_SCHEMA);
    const companies = new CompanyService(b.db, path.join(b.dir, 'logos'));
    expect(companies.list().map((c) => c.displayName)).toEqual(['Legacy LLC']);
    expect(new CategoryService(b.db, companies).list(1)).toHaveLength(22); // seeded by the upgrade (15 original, 7 added with business types)
    expect(new PropertyService(b.db, companies).get(1)).toMatchObject({ address1: '1 Legacy Way', purchasePriceCents: 5_000_000 });
    const keep = fs.readdirSync(path.join(b.dir, 'backups', 'pre-upgrade'));
    expect(keep).toHaveLength(1);
    expect(keep[0]).toMatch(/^Gable-before-upgrade-v2-to-v\d+-/);
  });
});

describe('upgrades are all-or-nothing', () => {
  it('two pending migrations where the second fails leave the database at its original version', () => {
    const f = path.join(dest, 'u.db');
    const base = migrations.filter((m) => m.version <= 2);
    const db = openDatabase(f, { migrations: base });
    db.prepare("INSERT INTO company (display_name, name_key, created_at, updated_at) VALUES ('Safe LLC', 'safe llc', 'n', 'n')").run();
    db.close();
    const bad = [...base, { version: 3, name: 'good', sql: 'CREATE TABLE extra (id INTEGER);' }, { version: 4, name: 'bad', sql: 'CREATE TABLE more (id INTEGER); SELECT * FROM nope;' }];
    expect(() => openDatabase(f, { migrations: bad })).toThrow();
    const check = new Database(f, { readonly: true });
    expect((check.prepare('SELECT MAX(version) AS v FROM schema_migration').get() as { v: number }).v).toBe(2);
    expect(check.prepare("SELECT name FROM sqlite_master WHERE name IN ('extra', 'more')").all()).toEqual([]);
    expect(check.prepare('SELECT COUNT(*) AS n FROM company').get()).toEqual({ n: 1 });
    check.close();
  });

  it('keeps a safety copy before upgrading, and does not upgrade if the copy cannot be made', () => {
    const f = path.join(dest, 'u2.db');
    const base = migrations.filter((m) => m.version <= 2);
    openDatabase(f, { migrations: base }).close();
    const snapDir = path.join(dest, 'safety');
    const db = openDatabase(f, { migrations, beforeUpgrade: preUpgradeSnapshotter(snapDir) });
    db.close();
    const copies = fs.readdirSync(snapDir);
    expect(copies).toHaveLength(1);
    const copy = new Database(path.join(snapDir, copies[0]!), { readonly: true });
    expect((copy.prepare('SELECT MAX(version) AS v FROM schema_migration').get() as { v: number }).v).toBe(2); // the copy is the OLD version
    copy.close();

    const f2 = path.join(dest, 'u3.db');
    openDatabase(f2, { migrations: base }).close();
    expect(() => openDatabase(f2, { migrations, beforeUpgrade: () => { throw new Error('disk full'); } })).toThrow();
    const untouched = new Database(f2, { readonly: true });
    expect((untouched.prepare('SELECT MAX(version) AS v FROM schema_migration').get() as { v: number }).v).toBe(2);
    untouched.close();
  });

  it('keeps only the newest pre-upgrade copies', () => {
    const dir = path.join(dest, 'keep');
    fs.mkdirSync(dir);
    for (let i = 1; i <= 5; i++) fs.writeFileSync(path.join(dir, `Gable-before-upgrade-v${i}-to-v${i + 1}-2026010${i}-000000.db`), 'x');
    const db = openDatabase(path.join(dest, 'k.db'), { migrations: migrations.filter((m) => m.version <= 2) });
    preUpgradeSnapshotter(dir)(db, 2, 4);
    db.close();
    expect(fs.readdirSync(dir)).toHaveLength(3);
  });
});

describe('backup problems are reported plainly and never counted as success', () => {
  it('a busy database gives a retry message, leaves no partial file, and the next backup works', async () => {
    await populate(a);
    const real = a.db;
    const locked = { prepare: (sql: string) => (sql.startsWith('VACUUM') ? { run: () => { throw new Error('database is locked'); } } : real.prepare(sql)) } as unknown as typeof real;
    const busy = backupFor(a, { getDb: () => locked });
    const e = await errOf(() => busy.create('manual', dest));
    expect(e.message).toMatch(/busy/i);
    expect(fs.readdirSync(dest)).toEqual([]);
    expect(busy.isRunning).toBe(false);
    expect((await svcA.create('manual', dest)).file).toMatch(/\.zip$/);
  });

  it('too little free space is explained before anything is written', async () => {
    await populate(a);
    const tight = backupFor(a, { freeBytes: () => 1000 });
    expect((await errOf(() => tight.create('manual', dest))).message).toMatch(/not enough free space/);
    expect(fs.readdirSync(dest)).toEqual([]);
    const b2 = backupFor(b, { freeBytes: () => 1000 });
    const made = await svcA.create('manual', dest);
    const token = (await backupFor(b).inspect(path.join(dest, made.file))).token;
    const before = snap(b);
    expect((await errOf(() => b2.restore(token, opts(b)))).message).toMatch(/not enough free space to restore/);
    expect(snap(b)).toEqual(before);
    expect(b.db.open).toBe(true); // refused before the database was closed
  });

  it('a destination that is not a folder, or not writable, is explained', async () => {
    await populate(a);
    const file = path.join(dest, 'iam-a-file');
    fs.writeFileSync(file, 'x');
    expect((await errOf(() => svcA.create('manual', path.join(file, 'sub')))).message).toMatch(/backup folder/);
    if (process.platform !== 'win32' && process.getuid?.() !== 0) {
      const ro = path.join(dest, 'readonly');
      fs.mkdirSync(ro, { mode: 0o500 });
      expect((await errOf(() => svcA.create('manual', ro))).message).toMatch(/not allowed to write/);
      fs.chmodSync(ro, 0o700);
    }
    expect(fs.readdirSync(dest).filter((f) => f.endsWith('.zip') || f.endsWith('.partial'))).toEqual([]);
  });

  it('receipts already missing from storage are reported, the backup still restores, and the check lists them', async () => {
    await populate(a);
    const victim = fs.readdirSync(a.receiptsDir)[0]!;
    fs.rmSync(path.join(a.receiptsDir, victim));
    const check = svcA.checkFiles();
    expect(check.missing).toHaveLength(1);
    expect(check.missing[0]).toMatchObject({ file: victim });
    expect(check.missing[0]!.label).toMatch(/\(expense for|waiting for review/);
    const made = await svcA.create('manual', dest);
    expect(made.warnings[0]).toMatch(/1 receipt file was already missing/);
    const svcB = backupFor(b);
    const summary = await svcB.inspect(path.join(dest, made.file));
    expect(summary.warnings[0]).toMatch(/already missing/);
    await svcB.restore(summary.token, opts(b));
    reopen(b);
    expect(svcB.checkFiles().missing).toHaveLength(1); // still flagged after the restore, so the person can act on it
  });
});

describe('retention and scheduling', () => {
  it('keeps the newest automatic backups only, never deletes manual or pre-restore ones, and a failure deletes nothing', async () => {
    await populate(a);
    const clock = { t: new Date(2026, 0, 1, 9, 0, 0).getTime() };
    const svc = backupFor(a, { now: () => new Date((clock.t += 86_400_000)) });
    const manual = await svc.create('manual', dest);
    const pre = await svc.create('pre-restore', dest);
    for (let i = 0; i < AUTO_BACKUP_RETENTION + 4; i++) await svc.create('auto', dest);
    const listed = svc.list(dest);
    expect(listed.filter((x) => x.kind === 'auto')).toHaveLength(AUTO_BACKUP_RETENTION);
    expect(listed.map((x) => x.file)).toEqual(expect.arrayContaining([manual.file, pre.file]));
    const newestAuto = listed.find((x) => x.kind === 'auto')!.file;
    const failing = backupFor(a, { now: () => new Date((clock.t += 86_400_000)), freeBytes: () => 1 });
    await expect(failing.create('auto', dest)).rejects.toBeInstanceOf(AppError);
    expect(svc.list(dest).filter((x) => x.kind === 'auto')).toHaveLength(AUTO_BACKUP_RETENTION);
    expect(svc.list(dest)[0]!.file === newestAuto || svc.list(dest).some((x) => x.file === newestAuto)).toBe(true);
  });

  it('decides when the daily automatic backup is due and persists settings atomically', () => {
    const cfg = new BackupConfigStore(dest);
    expect(cfg.read()).toMatchObject({ autoEnabled: true, destination: null, lastSuccess: null });
    const noon = new Date(2026, 5, 10, 12, 0, 0);
    expect(autoBackupDue(cfg.read(), noon)).toBe(true);
    const done = cfg.write({ lastSuccess: { at: new Date(2026, 5, 10, 8, 0, 0).toISOString(), kind: 'auto', file: 'x.zip', warnings: [] } });
    expect(autoBackupDue(done, noon)).toBe(false);
    expect(autoBackupDue(done, new Date(2026, 5, 11, 0, 5, 0))).toBe(true);
    expect(autoBackupDue({ ...done, autoEnabled: false }, new Date(2026, 5, 11, 12))).toBe(false);
    fs.writeFileSync(path.join(dest, 'backup-config.json'), '{ not json');
    expect(cfg.read().autoEnabled).toBe(true); // a damaged settings file falls back to safe defaults
    expect(fs.readdirSync(dest).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});

describe('archive file names', () => {
  it.each([
    ['database/gable.db', true], ['receipts/ab12.png', true], ['manifest.json', true],
    ['../x', false], ['a/../../x', false], ['/abs', false], ['\\abs', false], ['C:\\x', false], ['', false], ['a//b', false], ['./a', false], ['a\0b', false], ['a/b:c', false],
  ])('%j is safe: %s', (name, ok) => {
    expect(isSafeEntryName(name)).toBe(ok);
  });
});
