import { useMemo, useState } from 'react';
import { Paperclip, Plus, ScanLine, Search } from 'lucide-react';
import { Badge, Button, DateField, EmptyState, ErrorState, SelectField, TextField } from '../components';
import { PageHeader } from '../shell/Shell';
import { useApp } from '../shell/AppContext';
import { api, unwrap, useDebounced, useLoad } from '../api';
import { formatCents } from '../../shared/money';
import { formatUsDate, parseUsDate } from '../../shared/dates';
import type { ExpenseQuery } from '../../shared/schemas';

const iso = (t: string): string | null => {
  const r = parseUsDate(t);
  return r.ok ? r.iso : null;
};

export function ExpensesPage() {
  const { navigate, scope, companyName } = useApp();
  const [f, setF] = useState({ q: '', category: '', property: '', from: '', to: '', voided: false });
  const [page, setPage] = useState(1);
  const q = useDebounced(f.q, 250);
  const active = Boolean(f.q || f.category || f.property || f.from || f.to || f.voided);
  const change = (patch: Partial<typeof f>) => { setF((x) => ({ ...x, ...patch })); setPage(1); };
  const clear = () => { setF({ q: '', category: '', property: '', from: '', to: '', voided: false }); setPage(1); };

  const query: ExpenseQuery = useMemo(() => ({
    scope, q, property: f.property === '' ? null : f.property === 'general' ? 'general' : Number(f.property),
    categoryId: f.category ? Number(f.category) : null, from: iso(f.from), to: iso(f.to), includeVoided: f.voided, page, pageSize: 25,
  }), [scope, q, f.property, f.category, f.from, f.to, f.voided, page]);

  const { data, error, loading, reload } = useLoad(() => unwrap(api().listExpenses(query)), [JSON.stringify(query)]);
  const { data: queue } = useLoad(() => unwrap(api().listReceipts({ scope })), [scope]);
  const waiting = (queue ?? []).filter((d) => ['needs_review', 'reviewed', 'failed', 'queued', 'processing'].includes(d.status)).length;
  const { data: cats } = useLoad(() => (scope === 'all' ? Promise.resolve([]) : unwrap(api().listCategories(scope, true))), [scope]);
  const { data: props } = useLoad(() => (scope === 'all' ? Promise.resolve(null) : unwrap(api().listProperties({ scope, pageSize: 100, includeArchived: true }))), [scope]);

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / (data?.pageSize ?? 25)));
  const first = total === 0 ? 0 : ((data?.page ?? 1) - 1) * (data?.pageSize ?? 25) + 1;
  const last = Math.min(total, (data?.page ?? 1) * (data?.pageSize ?? 25));
  const addHref = '/expenses/new';

  return (
    <>
      <PageHeader
        title="Expenses"
        context={scope === 'all' ? 'All companies · view only. Choose a company to add an expense.' : companyName(scope)}
        actions={
          <>
            <Button variant="secondary" icon={<ScanLine size={16} aria-hidden="true" />} onClick={() => navigate('/receipts/review')}>
              Review receipts{waiting ? ` (${waiting})` : ''}
            </Button>
            <Button variant="primary" icon={<Plus size={16} aria-hidden="true" />} onClick={() => navigate(addHref)}>Add expense</Button>
          </>
        }
      />
      <div className="page-body">
        <div className="filters filters--exp" role="search" aria-label="Filter expenses">
          <TextField label="Search vendor or notes" value={f.q} onChange={(e) => change({ q: e.target.value })} placeholder="Type to filter" type="search" />
          {scope !== 'all' && (
            <>
              <SelectField label="Category" value={f.category} onChange={(e) => change({ category: e.target.value })}>
                <option value="">All categories</option>
                {(cats ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.isArchived ? ' (archived)' : ''}</option>)}
              </SelectField>
              <SelectField label="Property" value={f.property} onChange={(e) => change({ property: e.target.value })}>
                <option value="">All properties</option>
                <option value="general">General company expenses</option>
                {(props?.rows ?? []).map((p) => <option key={p.id} value={p.id}>{p.address1}</option>)}
              </SelectField>
            </>
          )}
          <DateField label="From" value={f.from} onChange={(t) => change({ from: t })} hint="" error={f.from && !iso(f.from) ? 'Not a valid date.' : null} />
          <DateField label="To" value={f.to} onChange={(t) => change({ to: t })} hint="" error={f.to && !iso(f.to) ? 'Not a valid date.' : null} />
          <label className="check"><input type="checkbox" checked={f.voided} onChange={(e) => change({ voided: e.target.checked })} /><span>Include voided</span></label>
          {active && <Button variant="ghost" size="sm" onClick={clear}>Clear filters</Button>}
          <p className="filters__count muted" role="status">{data ? `${total} ${total === 1 ? 'expense' : 'expenses'}` : ''}</p>
        </div>

        <div className="panel panel--flush" aria-busy={loading}>
          {error ? (
            <ErrorState title="Could not load expenses" action={<Button onClick={reload}>Try again</Button>}>{error}</ErrorState>
          ) : data && data.rows.length === 0 ? (
            active ? (
              <EmptyState title="No matching expenses" icon={<Search size={32} aria-hidden="true" />} action={<Button variant="secondary" onClick={clear}>Clear filters</Button>}>
                No expenses match these filters. Your records are still there.
              </EmptyState>
            ) : (
              <EmptyState title="No expenses yet" action={<Button variant="primary" onClick={() => navigate(addHref)}>Add the first expense</Button>}>
                Add an expense by hand. Past expenses are welcome too; no receipt is needed.
              </EmptyState>
            )
          ) : (
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Expenses, newest first</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Vendor</th>
                    <th scope="col">Property</th>
                    {scope === 'all' && <th scope="col">Company</th>}
                    <th scope="col">Category</th>
                    <th scope="col"><span className="sr-only">Receipts</span></th>
                    <th scope="col" className="is-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.rows ?? []).map((e) => (
                    <tr key={e.id} className={e.status === 'voided' ? 'is-voided' : undefined}>
                      <td className="num">{formatUsDate(e.expenseDate)}</td>
                      <td>
                        <a className="link table__primary" href={`#/expenses/edit?id=${e.id}`} onClick={(ev) => { ev.preventDefault(); navigate(`/expenses/edit?id=${e.id}`); }}>{e.vendorName}</a>
                        {e.status === 'voided' && <> <Badge tone="danger" small>Voided</Badge></>}
                      </td>
                      <td className="truncate" title={e.propertyAddress ?? undefined}>{e.propertyAddress ?? <span className="muted">General company</span>}</td>
                      {scope === 'all' && <td>{e.companyName}</td>}
                      <td title={e.allocations.map((a) => `${a.categoryName} ${formatCents(a.amountCents)}`).join(', ')}>
                        {e.allocations.length === 1 ? e.allocations[0]!.categoryName : `Split: ${e.allocations.map((a) => a.categoryName).join(' + ')}`}
                      </td>
                      <td className="num muted">{e.attachments.length > 0 && <span title={`${e.attachments.length} receipt${e.attachments.length === 1 ? '' : 's'}`}><Paperclip size={14} aria-hidden="true" /> {e.attachments.length}<span className="sr-only"> receipts</span></span>}</td>
                      <td className="money num">{formatCents(e.totalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data && total > 0 && (
            <div className="pager">
              <span className="muted num" role="status">Showing {first}–{last} of {total}</span>
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span className="muted num">Page {page} of {pages}</span>
              <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
