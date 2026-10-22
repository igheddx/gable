import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Unzip, UnzipInflate, UnzipPassThrough, Zip, ZipDeflate, ZipPassThrough } from 'fflate';

/**
 * Streaming zip reading and writing, so large receipt folders never have to fit in memory.
 * Entry names are validated before anything is written: no absolute paths, no "..", no drive letters.
 */

const CHUNK = 1024 * 1024;
const tick = () => new Promise<void>((r) => setImmediate(r));

/** True only for plain relative paths made of ordinary segments. */
export function isSafeEntryName(name: string): boolean {
  if (name === '' || name.length > 400) return false;
  if (name.startsWith('/') || name.startsWith('\\') || /^[A-Za-z]:/.test(name) || name.includes('\0')) return false;
  const parts = name.split(/[\\/]/);
  return parts.every((p) => p !== '' && p !== '.' && p !== '..' && !/[<>:"|?*]/.test(p));
}

export interface WrittenEntry { name: string; sha256: string; size: number }

export class ZipFileWriter {
  private readonly fd: number;
  private readonly zip: Zip;
  private failure: Error | null = null;
  private closed = false;

  constructor(readonly target: string) {
    this.fd = fs.openSync(target, 'w');
    this.zip = new Zip((err, chunk) => {
      if (err) { this.failure = err; return; }
      try { fs.writeSync(this.fd, chunk); } catch (e) { this.failure = e as Error; }
    });
  }

  /** Adds a file from disk. Already-compressed receipts are stored; everything else is deflated. */
  async addFile(name: string, source: string, compress: boolean): Promise<WrittenEntry> {
    if (!isSafeEntryName(name)) throw new Error(`Unsafe name in archive: ${name}`);
    const entry = compress ? new ZipDeflate(name, { level: 6 }) : new ZipPassThrough(name);
    this.zip.add(entry);
    const hash = crypto.createHash('sha256');
    const input = fs.openSync(source, 'r');
    let size = 0;
    try {
      const buf = Buffer.alloc(CHUNK);
      for (;;) {
        const n = fs.readSync(input, buf, 0, CHUNK, null);
        if (n === 0) break;
        const piece = new Uint8Array(buf.subarray(0, n));
        hash.update(piece);
        size += n;
        entry.push(piece, false);
        if (this.failure) throw this.failure;
        await tick();
      }
      entry.push(new Uint8Array(0), true);
    } finally {
      fs.closeSync(input);
    }
    if (this.failure) throw this.failure;
    return { name, sha256: hash.digest('hex'), size };
  }

  addText(name: string, text: string): void {
    const entry = new ZipDeflate(name, { level: 6 });
    this.zip.add(entry);
    entry.push(new TextEncoder().encode(text), true);
    if (this.failure) throw this.failure;
  }

  /** Finishes the archive and makes sure it reached the disk. */
  finish(): void {
    this.zip.end();
    if (this.failure) throw this.failure;
    fs.fsyncSync(this.fd);
    this.close();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    fs.closeSync(this.fd);
  }
}

export interface ExtractedEntry { name: string; sha256: string; size: number }

export class ArchiveError extends Error {
  constructor(readonly code: 'not_a_zip' | 'unsafe_path' | 'truncated' | 'io', message: string) {
    super(message);
  }
}

/**
 * Extracts a zip into `destDir`, refusing unsafe names, and returns each file's checksum.
 * Nothing outside `destDir` is ever written.
 */
export async function extractZip(zipPath: string, destDir: string): Promise<ExtractedEntry[]> {
  const root = path.resolve(destDir);
  fs.mkdirSync(root, { recursive: true });
  const results: ExtractedEntry[] = [];
  let failure: ArchiveError | null = null;
  let pending = 0;
  let sawEntry = false;

  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough);
  unzip.onfile = (file) => {
    sawEntry = true;
    if (failure) return;
    if (file.name.endsWith('/')) return; // directory entry
    if (!isSafeEntryName(file.name)) {
      failure = new ArchiveError('unsafe_path', `The backup contains an unsafe file name and was not used: ${file.name.slice(0, 80)}`);
      return;
    }
    const out = path.resolve(root, file.name);
    if (!out.startsWith(root + path.sep)) {
      failure = new ArchiveError('unsafe_path', 'The backup contains a file outside its folder and was not used.');
      return;
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const fd = fs.openSync(out, 'w');
    const hash = crypto.createHash('sha256');
    let size = 0;
    pending += 1;
    file.ondata = (err, data, final) => {
      if (err) { failure ??= new ArchiveError('io', 'The backup could not be read.'); fs.closeSync(fd); pending -= 1; return; }
      if (data.length) { fs.writeSync(fd, data); hash.update(data); size += data.length; }
      if (final) { fs.closeSync(fd); pending -= 1; results.push({ name: file.name, sha256: hash.digest('hex'), size }); }
    };
    file.start();
  };

  const input = fs.openSync(zipPath, 'r');
  try {
    const head = Buffer.alloc(4);
    if (fs.readSync(input, head, 0, 4, 0) < 4 || head.readUInt32LE(0) !== 0x04034b50) {
      throw new ArchiveError('not_a_zip', 'This file is not a Gable backup.');
    }
    const buf = Buffer.alloc(CHUNK);
    for (;;) {
      const n = fs.readSync(input, buf, 0, CHUNK, null);
      if (n === 0) { unzip.push(new Uint8Array(0), true); break; }
      try {
        unzip.push(new Uint8Array(buf.subarray(0, n)), false);
      } catch {
        throw new ArchiveError('not_a_zip', 'This backup is damaged and could not be read.');
      }
      if (failure) throw failure;
      await tick();
    }
  } finally {
    fs.closeSync(input);
  }
  if (failure) throw failure;
  if (!sawEntry) throw new ArchiveError('not_a_zip', 'This file is not a Gable backup.');
  if (pending !== 0) throw new ArchiveError('truncated', 'This backup is incomplete (it ends early).');
  return results;
}
