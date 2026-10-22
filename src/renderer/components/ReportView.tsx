import { formatCell, isNumericType } from '../../shared/reportFormat';
import { formatUsDate } from '../../shared/dates';
import type { ReportDoc, Table } from '../../shared/reportTypes';

function ReportTable({ t }: { t: Table }) {
  return (
    <section className="panel panel--flush report-table" aria-label={t.title}>
      <h3 className="report-table__title">{t.title}</h3>
      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">{t.title}</caption>
          <thead>
            <tr>{t.columns.map((c) => <th key={c.key} scope="col" className={isNumericType(c.type) ? 'is-right' : undefined}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {t.rows.length === 0 && <tr><td colSpan={t.columns.length} className="muted">{t.empty}</td></tr>}
            {t.rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((v, i) => {
                  const col = t.columns[i]!;
                  const neg = col.type === 'money' && typeof v === 'number' && v < 0;
                  return <td key={col.key} className={`${isNumericType(col.type) ? 'money num' : i === 0 || col.key === 'address' || col.key === 'property' ? 'table__primary' : ''}${neg ? ' is-loss' : ''}`}>{formatCell(v, col.type)}{neg && <span className="sr-only"> (loss)</span>}</td>;
                })}
              </tr>
            ))}
          </tbody>
          {t.totals && (
            <tfoot>
              <tr>{t.totals.map((v, i) => <td key={t.columns[i]!.key} className={isNumericType(t.columns[i]!.type) ? 'money num' : undefined}>{formatCell(v, t.columns[i]!.type)}</td>)}</tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}

/** The report exactly as exported: same basis, summary, tables and totals. */
export function ReportView({ doc }: { doc: ReportDoc }) {
  return (
    <div className="report">
      <section className="panel report-head" aria-label="Report details">
        <h2 className="panel__title">{doc.title}</h2>
        <dl className="report-meta">
          <div><dt>Company</dt><dd>{doc.company}</dd></div>
          <div className="report-meta__basis"><dt>Basis</dt><dd><strong>{doc.basis}</strong></dd></div>
          {doc.filters.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          <div><dt>As of</dt><dd>{formatUsDate(doc.asOf)}</dd></div>
          <div><dt>Generated</dt><dd>{new Date(doc.generatedAt).toLocaleString('en-US')}</dd></div>
        </dl>
      </section>
      <section className="summary report-summary" aria-label="Report summary">
        {doc.summary.map((l) => (
          <div key={l.label} className={`summary__item${l.emphasis ? ' summary__item--em' : ''}`}>
            <span className="summary__label">{l.label}</span>
            <span className={`summary__value summary__value--sm num${l.type === 'money' && typeof l.value === 'number' && l.value < 0 ? ' is-loss' : ''}`}>{formatCell(l.value, l.type) || 'Unavailable'}</span>
          </div>
        ))}
      </section>
      {doc.tables.map((t) => <ReportTable key={t.id} t={t} />)}
      <ul className="report-notes muted">{doc.notes.map((n) => <li key={n}>{n}</li>)}</ul>
    </div>
  );
}
