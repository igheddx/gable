import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../shared/errors';
import type { ReportDoc, ReportRequest } from '../shared/reportTypes';
import type { CompanyService } from '../services/companyService';
import type { ReportService } from '../services/reportService';
import { buildWorkbook } from '../services/reports/xlsx';
import { buildReportHtml, pdfFooterTemplate, wantsLandscape } from '../services/reports/html';

export interface ExportPlatform {
  /** Native save dialog. Resolves to a chosen path, or null if the person cancelled. */
  chooseSavePath(defaultName: string, filterName: string, ext: string): Promise<string | null>;
  /** Prints a self-contained HTML document to PDF bytes using the built-in print engine. */
  renderPdf(html: string, opts: { landscape: boolean; footerTemplate: string }): Promise<Uint8Array>;
  fonts(): { sans: string | null; serif: string | null };
}

export interface ExportResult { saved: boolean; fileName: string | null }

/** A file name that is valid on Windows and macOS. */
const safe = (s: string) => Array.from(s).filter((ch) => ch.charCodeAt(0) >= 32 && !'<>:"/\\|?*'.includes(ch)).join('').replace(/\s+/g, ' ').trim().slice(0, 80);

export function defaultFileName(doc: ReportDoc, ext: string): string {
  return `${safe(`${doc.company} ${doc.title}`)} ${doc.asOf}.${ext}`.replace(/ +/g, ' ');
}

/** What went wrong writing a file, in words a person can act on. */
export function writeFailureMessage(e: unknown): string {
  const code = (e as NodeJS.ErrnoException).code;
  switch (code) {
    case 'EBUSY': case 'EPERM': return 'That file is open in another program, such as Excel. Close it, or choose a different name, and try again.';
    case 'EACCES': return 'Gable is not allowed to save in that folder. Choose another folder, such as Documents.';
    case 'ENOSPC': return 'There is not enough free space on that drive. Free some space or choose another location.';
    case 'ENOENT': return 'That folder no longer exists. Choose another location.';
    case 'EISDIR': return 'That name is a folder. Choose a file name.';
    default: return 'The file could not be saved. Choose another location and try again.';
  }
}

/** Writes the whole file or nothing: bytes go to a temporary name first, then replace the target. */
export function writeFileSafely(target: string, bytes: Uint8Array): void {
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, target);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw new AppError('CONFLICT', writeFailureMessage(e));
  }
}

export async function exportReport(
  kind: 'xlsx' | 'pdf',
  req: ReportRequest,
  deps: { reports: ReportService; companies: CompanyService; platform: ExportPlatform },
): Promise<ExportResult> {
  const doc = deps.reports.build(req);
  const ext = kind;
  const target = await deps.platform.chooseSavePath(defaultFileName(doc, ext), kind === 'xlsx' ? 'Excel workbook' : 'PDF document', ext);
  if (!target) return { saved: false, fileName: null };
  let bytes: Uint8Array;
  if (kind === 'xlsx') {
    bytes = buildWorkbook(doc);
  } else {
    const logo = doc.companyId !== null ? deps.companies.getLogoDataUrl(doc.companyId) : null;
    try {
      bytes = await deps.platform.renderPdf(buildReportHtml(doc, { logoDataUrl: logo, fonts: deps.platform.fonts() }), { landscape: wantsLandscape(doc), footerTemplate: pdfFooterTemplate(doc) });
    } catch {
      throw new AppError('CONFLICT', 'The PDF could not be created. Please try again.');
    }
  }
  writeFileSafely(target, bytes);
  return { saved: true, fileName: path.basename(target) };
}
