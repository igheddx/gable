import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../../src/shared/errors';
import { company, makeStack, prop, type Stack } from './helpers';

let s: Stack;
beforeEach(() => { s = makeStack(); });
afterEach(() => s.cleanup());

const fails = (fn: () => unknown, code: string, message?: RegExp) => {
  try { fn(); } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe(code);
    if (message) expect((e as AppError).message).toMatch(message);
    return;
  }
  throw new Error('expected an error');
};

describe('companies', () => {
  it('makes the first company the default and keeps default separate from the view', () => {
    const oak = s.companies.create(company('Oak House LLC'));
    const cedar = s.companies.create(company('Cedar Homes LLC'));
    expect(oak.isDefault).toBe(true);
    expect(cedar.isDefault).toBe(false);
    s.companies.setDefault(cedar.id);
    expect(s.companies.list().map((c) => [c.displayName, c.isDefault])).toEqual([['Cedar Homes LLC', true], ['Oak House LLC', false]]);
  });

  it('keeps the default across a restart (reopen the same database)', async () => {
    const { openDatabase } = await import('../../src/db/connection');
    const { CompanyService } = await import('../../src/services/companyService');
    s.companies.create(company('Oak House LLC'));
    const cedar = s.companies.create(company('Cedar Homes LLC'));
    s.companies.setDefault(cedar.id);
    s.db.close();
    const db2 = openDatabase(path.join(s.dir, 'gable.db'));
    const again = new CompanyService(db2, path.join(s.dir, 'logos'));
    expect(again.getDefaultId()).toBe(cedar.id);
    db2.close();
    s.db = openDatabase(path.join(s.dir, 'gable.db')); // so cleanup can close it
  });

  it('rejects empty and duplicate names (ignoring case and punctuation) and bad email', () => {
    s.companies.create(company('Oak House LLC'));
    fails(() => s.companies.create(company('  ')), 'VALIDATION');
    fails(() => s.companies.create(company('oak house, llc')), 'VALIDATION', /Please fix/);
    fails(() => s.companies.create({ ...company('Pine LLC'), email: 'nope' }), 'VALIDATION');
  });

  it('refuses to archive the default until a replacement is chosen, then moves the default', () => {
    const oak = s.companies.create(company('Oak House LLC'));
    const cedar = s.companies.create(company('Cedar Homes LLC'));
    fails(() => s.companies.archive(oak.id), 'CONFLICT', /default company/);
    expect(s.companies.get(oak.id).isArchived).toBe(false);
    fails(() => s.companies.archive(oak.id, oak.id), 'VALIDATION');
    s.companies.archive(oak.id, cedar.id);
    expect(s.companies.get(oak.id)).toMatchObject({ isArchived: true, isDefault: false });
    expect(s.companies.getDefaultId()).toBe(cedar.id);
  });

  it('will not archive into an archived or missing replacement, and cannot make an archived company default', () => {
    const oak = s.companies.create(company('Oak House LLC'));
    const cedar = s.companies.create(company('Cedar Homes LLC'));
    const north = s.companies.create(company('North Property LLC'));
    s.companies.archive(north.id);
    fails(() => s.companies.archive(oak.id, north.id), 'ARCHIVED');
    fails(() => s.companies.archive(oak.id, 9999), 'NOT_FOUND');
    fails(() => s.companies.setDefault(north.id), 'ARCHIVED');
    expect(s.companies.getDefaultId()).toBe(oak.id);
    void cedar;
  });

  it('archives without deleting history and allows restore', () => {
    const oak = s.companies.create(company('Oak House LLC'));
    const cedar = s.companies.create(company('Cedar Homes LLC'));
    const p = s.properties.create(cedar.id, prop());
    s.companies.archive(cedar.id);
    expect(s.properties.get(p.id)).toMatchObject({ companyName: 'Cedar Homes LLC', companyArchived: true });
    expect(s.companies.list().map((c) => c.id)).toEqual([oak.id]);
    expect(s.companies.list(true)).toHaveLength(2);
    s.companies.restore(cedar.id);
    expect(s.companies.get(cedar.id).isArchived).toBe(false);
  });

  it('heals the default if it points at an archived company', () => {
    const oak = s.companies.create(company('Oak House LLC'));
    const cedar = s.companies.create(company('Cedar Homes LLC'));
    s.db.prepare('UPDATE company SET is_archived = 1 WHERE id = ?').run(oak.id);
    expect(s.companies.getDefaultId()).toBe(cedar.id);
  });

  it('stores logos under opaque names and validates the file type', () => {
    const oak = s.companies.create(company('Oak House LLC'));
    const png = path.join(s.dir, 'logo.png');
    fs.writeFileSync(png, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]));
    const withLogo = s.companies.setLogoFromFile(oak.id, png);
    expect(withLogo.hasLogo).toBe(true);
    expect(s.companies.getLogoDataUrl(oak.id)).toMatch(/^data:image\/png;base64,/);
    const stored = fs.readdirSync(path.join(s.dir, 'logos'));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatch(/^[0-9a-f]{32}\.png$/);
    fs.rmSync(png); // original is gone; the managed copy still works
    expect(s.companies.getLogoDataUrl(oak.id)).not.toBeNull();
    const bad = path.join(s.dir, 'notes.png');
    fs.writeFileSync(bad, 'not an image');
    fails(() => s.companies.setLogoFromFile(oak.id, bad), 'VALIDATION', /not a PNG or JPG/);
    s.companies.clearLogo(oak.id);
    expect(fs.readdirSync(path.join(s.dir, 'logos'))).toHaveLength(0);
  });
});
