import { useMemo, useState } from 'react';
import { Badge, DateField, EmptyState, ErrorState, SelectField } from '../components';
import { PageHeader } from '../shell/Shell';
import { useApp } from '../shell/AppContext';
import { api, unwrap, useLoad } from '../api';
import { periodPresets } from '../periods';
import { formatCents } from '../../shared/money';
import { formatUsDate, parseUsDate } from '../../shared/dates';

const iso = (t: string): string | null => { const r = parseUsDate(t); return r.ok ? r.iso : null; };

function Figure({ label, value, note, loss }: { label: string; value: string; note: string; loss?: boolean }) {
  return (
    <div className="summary__item">
      <span className="summary__label">{label}</span>
      <span className={`summary__value num${loss ? ' is-loss' : ''}`}>{value}</span>
      <span className="muted">{note}</span>
    </div>
  );
}

export function OverviewPage() {
  const { scope, companyName, navigate } = useApp();
  const presets = useMemo(() => periodPresets(), []);
  const [period, setPeriod] = useState('this-year');
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const preset = presets.find((p) => p.key === period)!;
  const custom = period === 'custom';
  const allDates = period === 'all';
  const from = allDates ? '1900-01-01' : custom ? iso(fromText) : preset.from;
  const to = allDates ? '2200-12-31' : custom ? iso(toText) : preset.to;
  const valid = Boolean(from && to && to >= from);
  const label = allDates ? 'All dates' : custom && valid ? `${formatUsDate(from!)} to ${formatUsDate(to!)}` : preset.label;
  const { data, error } = useLoad(() => (valid ? unwrap(api().getOverview(scope, from!, to!, label)) : Promise.resolve(null)), [scope, from, to]);

  return (
    <>
      <PageHeader title="Overview" context={scope === 'all' ? 'All companies · an aggregation, not a combined financial statement' : companyName(scope)} />
      <div className="page-body">
        <div className="filters filters--exp">
          <SelectField label="Period for sales and company expenses" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {presets.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </SelectField>
          {custom && (
            <>
              <DateField label="From" value={fromText} onChange={setFromText} hint="" error={fromText && !iso(fromText) ? 'Not a valid date.' : null} />
              <DateField label="To" value={toText} onChange={setToText} hint="" error={toText && !iso(toText) ? 'Not a valid date.' : to && from && to < from ? 'The end date is before the start date.' : null} />
            </>
          )}
        </div>
        {error && <ErrorState title="Could not load the overview">{error}</ErrorState>}
        {data && (
          <>
            <section className="summary summary--4" aria-label="Key figures">
              <Figure label="Active properties" value={String(data.activeProperties)} note="Not yet sold, not archived" />
              <Figure label="Investment in unsold properties" value={formatCents(data.unsoldInvestmentCents)} note="Cost recorded so far. Not a market value." />
              <Figure label="Realized profit on properties sold" value={`${data.realizedProfitCents < 0 ? '−' : ''}${formatCents(Math.abs(data.realizedProfitCents))}`} loss={data.realizedProfitCents < 0}
                note={`${data.soldInPeriod} sold · ${data.periodLabel} · before taxes`} />
              <Figure label="General company expenses" value={formatCents(data.generalExpensesCents)} note={`${data.periodLabel} · separate from any property`} />
            </section>

            {scope === 'all' && (
              <section className="panel panel--flush" aria-label="By company">
                <h3 className="report-table__title">By company</h3>
                <div className="table-wrap">
                  <table className="table">
                    <caption className="sr-only">Figures for each company</caption>
                    <thead><tr><th scope="col">Company</th><th scope="col" className="is-right">Active properties</th><th scope="col" className="is-right">Unsold investment</th><th scope="col" className="is-right">Realized profit</th><th scope="col" className="is-right">General expenses</th></tr></thead>
                    <tbody>
                      {data.companies.map((c) => (
                        <tr key={c.companyId}>
                          <td className="table__primary">{c.name}</td><td className="money num">{c.activeProperties}</td><td className="money num">{formatCents(c.unsoldInvestmentCents)}</td>
                          <td className={`money num${c.realizedProfitCents < 0 ? ' is-loss' : ''}`}>{formatCents(c.realizedProfitCents)}</td><td className="money num">{formatCents(c.generalExpensesCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr><td>All companies</td><td className="money num">{data.activeProperties}</td><td className="money num">{formatCents(data.unsoldInvestmentCents)}</td><td className="money num">{formatCents(data.realizedProfitCents)}</td><td className="money num">{formatCents(data.generalExpensesCents)}</td></tr></tfoot>
                  </table>
                </div>
              </section>
            )}

            <section className="panel panel--flush" aria-label="Recent activity">
              <h3 className="report-table__title">Recently recorded expenses</h3>
              {data.recent.length === 0 ? <EmptyState title="Nothing recorded yet">Expenses you add will appear here.</EmptyState> : (
                <div className="table-wrap">
                  <table className="table">
                    <caption className="sr-only">Most recently recorded expenses</caption>
                    <thead><tr><th scope="col">Date</th><th scope="col">Vendor</th><th scope="col">Property</th>{scope === 'all' && <th scope="col">Company</th>}<th scope="col" className="is-right">Amount</th></tr></thead>
                    <tbody>
                      {data.recent.map((r) => (
                        <tr key={r.expenseId}>
                          <td className="num">{formatUsDate(r.date)}</td>
                          <td><a className="link table__primary" href={`#/expenses/edit?id=${r.expenseId}`} onClick={(e) => { e.preventDefault(); navigate(`/expenses/edit?id=${r.expenseId}`); }}>{r.vendor}</a></td>
                          <td>{r.target === 'General company expense' ? <Badge tone="neutral" small icon={false}>General company</Badge> : r.target}</td>
                          {scope === 'all' && <td>{r.companyName}</td>}
                          <td className="money num">{formatCents(r.cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <p className="muted small">Sold-property profit is selected by sale date and includes each property&apos;s full lifetime costs. General company expenses are selected by expense date. They are different bases and are shown separately on purpose.</p>
          </>
        )}
      </div>
    </>
  );
}
