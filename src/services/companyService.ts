import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db/connection';
import { CompanyRepository, type CompanyRow, type CompanyWrite } from '../db/companyRepository';
import { SettingsRepository } from '../db/settingsRepository';
import { AppError } from '../shared/errors';
import type { CompanyInput } from '../shared/schemas';
import type { Company } from '../shared/types';
import { normalizeSearch } from '../shared/search';

const DEFAULT_KEY = 'company.defaultId';
const MAX_LOGO_BYTES = 1024 * 1024;

export class CompanyService {
  private readonly repo: CompanyRepository;
  private readonly settings: SettingsRepository;

  constructor(
    private readonly db: Db,
    private readonly logosDir: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.repo = new CompanyRepository(db);
    this.settings = new SettingsRepository(db);
  }

  /** The default company id, or null when none is active. Heals a missing/archived default. */
  getDefaultId(): number | null {
    const raw = this.settings.get(DEFAULT_KEY);
    const current = raw ? this.repo.get(Number(raw)) : undefined;
    if (current && current.is_archived === 0) return current.id;
    const first = this.repo.list(false)[0];
    if (!first) return null;
    this.settings.set(DEFAULT_KEY, String(first.id));
    return first.id;
  }

  list(includeArchived = false): Company[] {
    const def = this.getDefaultId();
    return this.repo.list(includeArchived).map((r) => this.toDto(r, def));
  }

  get(id: number): Company {
    return this.toDto(this.mustGet(id), this.getDefaultId());
  }

  create(input: CompanyInput): Company {
    const w = this.validate(input, null);
    const id = this.db.transaction(() => {
      const newId = this.repo.insert(w, this.now());
      // The first company is the default so the app always has one to open to.
      if (this.repo.list(false).length === 1) this.settings.set(DEFAULT_KEY, String(newId));
      return newId;
    })();
    return this.get(id);
  }

  update(id: number, input: CompanyInput): Company {
    const existing = this.mustGet(id);
    this.assertActive(existing);
    this.repo.update(id, this.validate(input, id), this.now());
    return this.get(id);
  }

  setDefault(id: number): Company {
    this.assertActive(this.mustGet(id));
    this.settings.set(DEFAULT_KEY, String(id));
    return this.get(id);
  }

  /**
   * Archiving keeps all history. The default company can only be archived together
   * with choosing a different active company as its replacement.
   */
  archive(id: number, replacementDefaultId?: number): Company {
    const company = this.mustGet(id);
    if (company.is_archived === 1) return this.get(id);
    this.db.transaction(() => {
      if (this.getDefaultId() === id) {
        if (replacementDefaultId === undefined) {
          throw new AppError('CONFLICT', 'This is your default company. Choose another company to be the default first.', { replacementDefaultId: 'Choose a replacement.' });
        }
        if (replacementDefaultId === id) throw new AppError('VALIDATION', 'Choose a different company as the new default.');
        this.assertActive(this.mustGet(replacementDefaultId));
        this.settings.set(DEFAULT_KEY, String(replacementDefaultId));
      }
      this.repo.setArchived(id, true, this.now());
    })();
    return this.get(id);
  }

  restore(id: number): Company {
    this.mustGet(id);
    this.repo.setArchived(id, false, this.now());
    this.getDefaultId();
    return this.get(id);
  }

  /** Copies a PNG/JPEG into managed storage under an opaque name. The original is never referenced again. */
  setLogoFromFile(id: number, sourcePath: string): Company {
    this.assertActive(this.mustGet(id));
    const stat = fs.statSync(sourcePath);
    if (!stat.isFile() || stat.size > MAX_LOGO_BYTES) throw new AppError('VALIDATION', 'Choose a PNG or JPG image under 1 MB.');
    const bytes = fs.readFileSync(sourcePath);
    const ext = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      ? 'png'
      : bytes[0] === 0xff && bytes[1] === 0xd8 ? 'jpg' : null;
    if (!ext) throw new AppError('VALIDATION', 'That file is not a PNG or JPG image.');
    fs.mkdirSync(this.logosDir, { recursive: true });
    const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(this.logosDir, name), bytes);
    const old = this.mustGet(id).logo_file;
    this.repo.setLogo(id, name, this.now());
    if (old) fs.rmSync(path.join(this.logosDir, path.basename(old)), { force: true });
    return this.get(id);
  }

  clearLogo(id: number): Company {
    const old = this.mustGet(id).logo_file;
    this.repo.setLogo(id, null, this.now());
    if (old) fs.rmSync(path.join(this.logosDir, path.basename(old)), { force: true });
    return this.get(id);
  }

  /** Logo as a data URL so the sandboxed UI never sees a file path. */
  getLogoDataUrl(id: number): string | null {
    const file = this.mustGet(id).logo_file;
    if (!file) return null;
    const full = path.join(this.logosDir, path.basename(file));
    if (!fs.existsSync(full)) return null;
    const mime = file.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return `data:${mime};base64,${fs.readFileSync(full).toString('base64')}`;
  }

  /** Throws if the company does not exist or is archived. Used by other services before writing under a company. */
  requireActive(id: number): CompanyRow {
    const c = this.mustGet(id);
    this.assertActive(c);
    return c;
  }

  private mustGet(id: number): CompanyRow {
    const c = this.repo.get(id);
    if (!c) throw new AppError('NOT_FOUND', 'That company no longer exists.');
    return c;
  }

  private assertActive(c: CompanyRow): void {
    if (c.is_archived === 1) throw new AppError('ARCHIVED', `${c.display_name} is archived. Restore it before making changes.`);
  }

  private validate(input: CompanyInput, selfId: number | null): CompanyWrite {
    const fields: Record<string, string> = {};
    const displayName = input.displayName.trim();
    if (displayName === '') fields.displayName = 'Enter a company name.';
    if (input.email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) fields.email = 'Enter a valid email address, or leave it blank.';
    const nameKey = normalizeSearch(displayName);
    const clash = nameKey ? this.repo.findByNameKey(nameKey) : undefined;
    if (clash && clash.id !== selfId) fields.displayName = `A company named "${clash.display_name}" already exists.`;
    if (Object.keys(fields).length) throw new AppError('VALIDATION', 'Please fix the highlighted fields.', fields);
    const blank = (s: string) => (s.trim() === '' ? null : s.trim());
    return { displayName, nameKey, legalName: blank(input.legalName), address: blank(input.address), phone: blank(input.phone), email: blank(input.email) };
  }

  private toDto(r: CompanyRow, defaultId: number | null): Company {
    return {
      id: r.id,
      displayName: r.display_name,
      legalName: r.legal_name ?? '',
      address: r.address ?? '',
      phone: r.phone ?? '',
      email: r.email ?? '',
      hasLogo: r.logo_file !== null,
      isArchived: r.is_archived === 1,
      isDefault: r.id === defaultId,
    };
  }
}
