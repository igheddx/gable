import { zipSync, strToU8 } from 'fflate';
import type { Cell, CellType, Column, ReportDoc, Table } from '../../shared/reportTypes';
import { formatBasisPoints, formatCents } from '../../shared/money';
import { formatUsDate } from '../../shared/dates';
import { daysBetween } from '../../shared/duration';

/**
 * Writes a real .xlsx workbook (Office Open XML) with typed cells: money and dates are numbers with
 * number formats, never text. User text is always stored as a string cell and marked as quoted, so a
 * value such as "=SUM(A1)" can never run as a formula. No file paths or internal ids are written.
 */

/** XML does not allow most control characters; drop them rather than write a broken file. */
const stripControl = (s: string) => Array.from(s).filter((ch) => { const c = ch.charCodeAt(0); return c === 9 || c === 10 || c === 13 || c >= 32; }).join('');
const esc = (s: string) => stripControl(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Column letters: 0 -> A, 26 -> AA. */
export function colName(i: number): string {
  let n = i;
  let s = '';
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

/** Excel's day number for a calendar date (1900 system, with its leap-year quirk handled by the 1899-12-30 epoch). */
export function excelDate(iso: string): number {
  return daysBetween('1899-12-30', iso);
}

/** Style slots in styles.xml, in order. */
const S = { text: 0, title: 1, header: 2, label: 3, money: 4, date: 5, int: 6, percent: 7, textQuoted: 8, bold: 9, moneyBold: 10, note: 11, intBold: 12, percentBold: 13, year: 14 } as const;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00;\\-&quot;$&quot;#,##0.00"/><numFmt numFmtId="165" formatCode="mm/dd/yyyy"/><numFmt numFmtId="166" formatCode="0.00%"/></numFmts>
<fonts count="5">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="16"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><i/><sz val="10"/><color rgb="FF55625F"/><name val="Calibri"/></font>
</fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF182724"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top style="thin"><color rgb="FF182724"/></top><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="15">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" quotePrefix="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="164" fontId="3" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="3" fontId="3" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="166" fontId="3" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const NEEDS_QUOTE = /^[=+\-@\t\r]/;

function strCell(ref: string, value: string, bold = false, style?: number): string {
  const s = style ?? (bold ? S.bold : NEEDS_QUOTE.test(value) ? S.textQuoted : S.text);
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

function numCell(ref: string, n: number, style: number): string {
  return `<c r="${ref}" s="${style}"><v>${Number.isFinite(n) ? n : 0}</v></c>`;
}

/** One typed cell. Money cents become dollars; basis points become a fraction for the percent format. */
function cell(ref: string, v: Cell, type: CellType, bold = false): string {
  if (v === null || v === '') return '';
  if (typeof v === 'string' && type !== 'date') return strCell(ref, v, bold);
  switch (type) {
    case 'money': return numCell(ref, (v as number) / 100, bold ? S.moneyBold : S.money);
    case 'percent': return numCell(ref, (v as number) / 10_000, bold ? S.percentBold : S.percent);
    case 'year': return numCell(ref, v as number, S.year);
    case 'int':
    case 'days': return numCell(ref, v as number, bold ? S.intBold : S.int);
    case 'date': return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? numCell(ref, excelDate(v), S.date) : strCell(ref, String(v), bold);
    default: return strCell(ref, String(v), bold);
  }
}

const rowXml = (n: number, cells: string[], height?: number) => (cells.join('') === '' ? '' : `<row r="${n}"${height ? ` ht="${height}" customHeight="1"` : ''}>${cells.join('')}</row>`);

interface SheetOut { name: string; xml: string; filter: string | null }

function sheetName(raw: string, used: Set<string>): string {
  let base = raw.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 28)} ${i}`;
  used.add(name.toLowerCase());
  base = name;
  return base;
}

function metaRows(doc: ReportDoc): { rows: string[]; next: number } {
  const rows: string[] = [];
  let r = 1;
  rows.push(rowXml(r++, [strCell(`A${r - 1}`, doc.title, false, S.title)], 24));
  const kv = (k: string, v: string) => rows.push(rowXml(r++, [strCell(`A${r - 1}`, k, true), strCell(`B${r - 1}`, v)]));
  kv('Company', doc.company);
  kv('Basis', doc.basis);
  for (const [k, v] of doc.filters) kv(k, v);
  kv('As of', formatUsDate(doc.asOf));
  kv('Generated', doc.generatedAt.replace('T', ' ').slice(0, 16) + ' UTC');
  return { rows, next: r + 1 };
}

function tableSheet(doc: ReportDoc, t: Table, name: string): SheetOut {
  const { rows, next } = metaRows(doc);
  let r = next;
  rows.push(rowXml(r++, [strCell(`A${r - 1}`, t.title, true)]));
  const headerRow = r;
  rows.push(rowXml(r++, t.columns.map((c, i) => strCell(`${colName(i)}${headerRow}`, c.label, false, S.header)), 30));
  if (t.rows.length === 0) rows.push(rowXml(r++, [strCell(`A${r - 1}`, t.empty, false, S.note)]));
  for (const row of t.rows) {
    const n = r++;
    rows.push(rowXml(n, row.map((v, i) => cell(`${colName(i)}${n}`, v, t.columns[i]!.type))));
  }
  const lastData = r - 1;
  if (t.totals) {
    const n = r;
    rows.push(rowXml(n, t.totals.map((v, i) => cell(`${colName(i)}${n}`, v, t.columns[i]!.type, true)).map((c, i) => (c === '' ? `<c r="${colName(i)}${n}" s="${S.bold}"/>` : c))));
  }
  const widths = t.columns.map((c, i) => {
    const longest = Math.max(c.label.length * 0.9, ...t.rows.slice(0, 200).map((row) => displayLength(row[i] ?? null, c)));
    return `<col min="${i + 1}" max="${i + 1}" width="${Math.min(60, Math.max(c.width ?? 10, Math.ceil(longest) + 2))}" customWidth="1"/>`;
  });
  const lastCol = colName(Math.max(0, t.columns.length - 1));
  const filter = t.rows.length > 0 ? `${'A'}${headerRow}:${lastCol}${lastData}` : null;
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${widths.join('')}</cols><sheetData>${rows.join('')}</sheetData>${filter ? `<autoFilter ref="${filter}"/>` : ''}<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup orientation="landscape" fitToHeight="0"/></worksheet>`;
  return { name, xml, filter };
}

function displayLength(v: Cell, c: Column): number {
  if (v === null) return 0;
  if (c.type === 'money') return formatCents(v as number).length;
  if (c.type === 'date') return 10;
  if (c.type === 'percent') return formatBasisPoints(v as number).length;
  return String(v).length;
}

function summarySheet(doc: ReportDoc, name: string): SheetOut {
  const { rows, next } = metaRows(doc);
  let r = next;
  rows.push(rowXml(r++, [strCell(`A${r - 1}`, 'Summary', true)]));
  for (const l of doc.summary) {
    const n = r++;
    rows.push(rowXml(n, [strCell(`A${n}`, l.label, !!l.emphasis), cell(`B${n}`, l.value, l.type, !!l.emphasis)]));
  }
  if (doc.notes.length) {
    r++;
    for (const note of doc.notes) { const n = r++; rows.push(rowXml(n, [strCell(`A${n}`, note, false, S.note)])); }
  }
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="1" width="42" customWidth="1"/><col min="2" max="2" width="30" customWidth="1"/></cols><sheetData>${rows.join('')}</sheetData><pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/></worksheet>`;
  return { name, xml, filter: null };
}

export function buildWorkbook(doc: ReportDoc): Uint8Array {
  const used = new Set<string>();
  const sheets: SheetOut[] = [summarySheet(doc, sheetName('Summary', used))];
  for (const t of doc.tables) sheets.push(tableSheet(doc, t, sheetName(t.sheet, used)));

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`),
    'docProps/core.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(doc.title)}</dc:title><dc:creator>Gable</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${esc(doc.generatedAt.slice(0, 19))}Z</dcterms:created></cp:coreProperties>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><definedNames>${sheets.map((s, i) => (s.filter ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${s.name.replace(/'/g, "''")}'!${s.filter.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')}</definedName>` : '')).join('')}</definedNames></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(STYLES),
  };
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(s.xml); });
  return zipSync(files, { level: 6 });
}
