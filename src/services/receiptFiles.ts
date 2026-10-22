import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../shared/errors';
import type { StagedFile } from '../shared/types';

export const MAX_RECEIPT_BYTES = 25 * 1024 * 1024;

type Kind = { ext: 'jpg' | 'png' | 'pdf'; mime: string };
const startsWith = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);

/** Content, not file name, decides the type. Returns null for anything unsupported. */
export function sniff(bytes: Uint8Array): Kind | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ext: 'png', mime: 'image/png' };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { ext: 'jpg', mime: 'image/jpeg' };
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { ext: 'pdf', mime: 'application/pdf' };
  return null;
}

interface Meta { name: string; ext: string; mime: string; sha256: string; size: number }
export interface StoredFile { storedName: string; originalName: string; sha256: string; sizeBytes: number; mime: string }

/**
 * Receipt files live under opaque names in managed storage. Imports are copied, so moving or
 * deleting the original never breaks the app. Nothing here ever executes file content.
 */
export class ReceiptFiles {
  constructor(private readonly receiptsDir: string, private readonly stagingDir: string) {}

  stage(rawName: string, bytes: Uint8Array): StagedFile {
    const name = path.basename(rawName.replace(/\\/g, '/')).slice(0, 200) || 'receipt';
    if (/\.heic$/i.test(name) || /\.heif$/i.test(name)) {
      throw new AppError('VALIDATION', `${name}: HEIC photos are not supported yet. Save or export the photo as JPG, then add it again.`);
    }
    if (bytes.byteLength === 0) throw new AppError('VALIDATION', `${name}: this file is empty.`);
    if (bytes.byteLength > MAX_RECEIPT_BYTES) throw new AppError('VALIDATION', `${name}: this file is larger than 25 MB.`);
    const kind = sniff(bytes);
    if (!kind) throw new AppError('VALIDATION', `${name}: only JPG, PNG and PDF receipts can be added.`);
    const id = crypto.randomBytes(16).toString('hex');
    fs.mkdirSync(this.stagingDir, { recursive: true });
    const meta: Meta = { name, ext: kind.ext, mime: kind.mime, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), size: bytes.byteLength };
    fs.writeFileSync(path.join(this.stagingDir, `${id}.bin`), bytes);
    fs.writeFileSync(path.join(this.stagingDir, `${id}.json`), JSON.stringify(meta));
    return { stagedId: id, name, sizeBytes: meta.size };
  }

  /** Copies a staged file into managed storage. The staged copy stays until `discardStaged`. */
  promote(stagedId: string): StoredFile {
    if (!/^[0-9a-f]{32}$/.test(stagedId)) throw new AppError('VALIDATION', 'A receipt file is no longer available. Add it again.');
    const bin = path.join(this.stagingDir, `${stagedId}.bin`);
    const metaPath = path.join(this.stagingDir, `${stagedId}.json`);
    if (!fs.existsSync(bin) || !fs.existsSync(metaPath)) throw new AppError('VALIDATION', 'A receipt file is no longer available. Add it again.');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Meta;
    fs.mkdirSync(this.receiptsDir, { recursive: true });
    const storedName = `${crypto.randomBytes(16).toString('hex')}.${meta.ext}`;
    fs.copyFileSync(bin, path.join(this.receiptsDir, storedName));
    return { storedName, originalName: meta.name, sha256: meta.sha256, sizeBytes: meta.size, mime: meta.mime };
  }

  /** Details of a staged file, for callers that need its path and type before promoting it. */
  stagedInfo(stagedId: string): { path: string; mime: string; name: string; sha256: string; sizeBytes: number } {
    if (!/^[0-9a-f]{32}$/.test(stagedId)) throw new AppError('VALIDATION', 'A receipt file is no longer available. Add it again.');
    const metaPath = path.join(this.stagingDir, `${stagedId}.json`);
    const bin = path.join(this.stagingDir, `${stagedId}.bin`);
    if (!fs.existsSync(metaPath) || !fs.existsSync(bin)) throw new AppError('VALIDATION', 'A receipt file is no longer available. Add it again.');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Meta;
    return { path: bin, mime: meta.mime, name: meta.name, sha256: meta.sha256, sizeBytes: meta.size };
  }

  discardStaged(stagedId: string): void {
    if (!/^[0-9a-f]{32}$/.test(stagedId)) return;
    fs.rmSync(path.join(this.stagingDir, `${stagedId}.bin`), { force: true });
    fs.rmSync(path.join(this.stagingDir, `${stagedId}.json`), { force: true });
  }

  private holds = 0;
  private deferred: string[] = [];

  /**
   * Postpones deleting stored files (for example while a backup is being written) so every file the
   * database refers to stays on disk. The returned function ends the hold and performs deferred deletes.
   */
  hold(): () => void {
    this.holds += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holds -= 1;
      if (this.holds === 0) for (const n of this.deferred.splice(0)) fs.rmSync(path.join(this.receiptsDir, n), { force: true });
    };
  }

  remove(storedName: string): void {
    const name = path.basename(storedName);
    if (this.holds > 0) { this.deferred.push(name); return; }
    fs.rmSync(path.join(this.receiptsDir, name), { force: true });
  }

  pathOf(storedName: string): string {
    return path.join(this.receiptsDir, path.basename(storedName));
  }
}
