import { formatUsDate } from '../../shared/dates';
import { formatCell, isNumericType } from '../../shared/reportFormat';
import type { CellType, ReportDoc, Table } from '../../shared/reportTypes';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export { formatCell };

const isNumeric = (t: CellType) => isNumericType(t);

function tableHtml(t: Table): string {
  const head = `<tr>${t.columns.map((c) => `<th class="${isNumeric(c.type) ? 'r' : ''}">${esc(c.label)}</th>`).join('')}</tr>`;
  const body = t.rows.length === 0
    ? `<tr><td colspan="${t.columns.length}" class="empty">${esc(t.empty)}</td></tr>`
    : t.rows.map((row) => `<tr>${row.map((v, i) => `<td class="${isNumeric(t.columns[i]!.type) ? 'r num' : ''}${typeof v === 'number' && v < 0 && t.columns[i]!.type === 'money' ? ' neg' : ''}">${esc(formatCell(v, t.columns[i]!.type))}</td>`).join('')}</tr>`).join('');
  const foot = t.totals ? `<tr class="tot">${t.totals.map((v, i) => `<td class="${isNumeric(t.columns[i]!.type) ? 'r num' : ''}">${esc(formatCell(v, t.columns[i]!.type))}</td>`).join('')}</tr>` : '';
  return `<section class="tbl"><h2>${esc(t.title)}</h2><table><thead>${head}</thead><tbody>${body}${foot}</tbody></table></section>`;
}

export interface HtmlOptions {
  /** data: URL of the company logo, when the report is for a single company that has one. */
  logoDataUrl: string | null;
  /** Base64 woff2 of the bundled fonts, so the printout needs no installed or network fonts. */
  fonts: { sans: string | null; serif: string | null };
}

/** True when any table is wide enough that the page should print in landscape. */
export function wantsLandscape(doc: ReportDoc): boolean {
  return doc.tables.some((t) => t.columns.length > 7);
}

/**
 * A self-contained print layout: no scripts, no network, fonts embedded. Table headers repeat on every
 * page and rows are kept whole across page breaks.
 */
export function buildReportHtml(doc: ReportDoc, o: HtmlOptions): string {
  const font = (name: string, b64: string | null, weight: string) => (b64 ? `@font-face{font-family:'${name}';font-weight:${weight};src:url(data:font/woff2;base64,${b64}) format('woff2');}` : '');
  const compact = doc.tables.some((t) => t.columns.length > 10);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">
<title>${esc(doc.title)}</title>
<style>
${font('Inter Variable', o.fonts.sans, '100 900')}${font('Source Serif 4 Variable', o.fonts.serif, '200 900')}
*{box-sizing:border-box}
html{font-family:'Inter Variable','Segoe UI',system-ui,sans-serif;color:#182724;font-size:${compact ? '8.5px' : '10px'};line-height:1.4}
body{margin:0}
.head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:2px solid #a78348;padding-bottom:10px;margin-bottom:12px}
h1{font-family:'Source Serif 4 Variable',Georgia,serif;font-size:22px;margin:0 0 4px;font-weight:600}
.sub{color:#55625f}
.logo{max-height:48px;max-width:160px;object-fit:contain}
dl.meta{display:grid;grid-template-columns:max-content 1fr;gap:2px 12px;margin:0 0 12px}
dl.meta dt{color:#55625f;font-weight:600}dl.meta dd{margin:0}
h2{font-size:12px;margin:14px 0 6px;color:#7a5f2b;text-transform:uppercase;letter-spacing:.05em;break-after:avoid}
table{width:100%;border-collapse:collapse}
thead{display:table-header-group}
tr{break-inside:avoid;page-break-inside:avoid}
th{background:#efece4;text-align:left;font-size:.9em;text-transform:uppercase;letter-spacing:.03em;padding:5px 6px;border-bottom:1px solid #8a9490}
td{padding:4px 6px;border-bottom:1px solid #ddd9ce;vertical-align:top;overflow-wrap:anywhere}
.r{text-align:right}.num{font-variant-numeric:tabular-nums lining-nums;white-space:nowrap}
.neg{color:#8e2323}
.tot td{font-weight:700;border-top:2px solid #182724;border-bottom:0;background:#faf9f5}
.empty{color:#55625f;font-style:italic}
table.summary{width:auto;min-width:50%;margin-bottom:6px}
table.summary td{border-bottom:1px solid #ddd9ce;padding:4px 10px 4px 0}
table.summary td.v{text-align:right;padding-right:0;padding-left:24px}
table.summary tr.em td{font-weight:700;font-size:1.1em}
.notes{margin:14px 0 0;padding-left:16px;color:#55625f}
</style></head><body>
<div class="head"><div><h1>${esc(doc.title)}</h1><div class="sub">${esc(doc.company)}</div></div>${o.logoDataUrl ? `<img class="logo" alt="" src="${o.logoDataUrl}">` : ''}</div>
<dl class="meta"><dt>Basis</dt><dd>${esc(doc.basis)}</dd>${doc.filters.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}<dt>As of</dt><dd>${esc(formatUsDate(doc.asOf))}</dd><dt>Generated</dt><dd>${esc(doc.generatedAt.replace('T', ' ').slice(0, 16))} UTC</dd></dl>
<h2>Summary</h2>
<table class="summary"><tbody>${doc.summary.map((l) => `<tr class="${l.emphasis ? 'em' : ''}"><td>${esc(l.label)}</td><td class="v num">${esc(formatCell(l.value, l.type) || 'Unavailable')}</td></tr>`).join('')}</tbody></table>
${doc.tables.map(tableHtml).join('')}
<ul class="notes">${doc.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
</body></html>`;
}

/** Footer for each printed page: report name and "Page X of Y" (filled in by the print engine). */
export function pdfFooterTemplate(doc: ReportDoc): string {
  return `<div style="font-size:8px;width:100%;padding:0 28px;display:flex;justify-content:space-between;color:#55625f;font-family:sans-serif"><span>${esc(doc.company)} · ${esc(doc.title)} · As of ${esc(formatUsDate(doc.asOf))}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
}
