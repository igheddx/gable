import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Search } from 'lucide-react';
import { Badge, Button, DateField, EmptyState, ErrorState, SelectField, TextField, type Tone } from '../components';
import { PageHeader } from '../shell/Shell';
import { useApp } from '../shell/AppContext';
import { api, unwrap, useDebounced, useLoad } from '../api';
import { PROPERTY_STATUSES } from '../../shared/schemas';
import { formatCents } from '../../shared/money';
import { formatUsDate, parseUsDate } from '../../shared/dates';
import type { PropertyQuery } from '../../shared/schemas';

const TONE: Record<string, Tone> = { Held: 'neutral', Renovating: 'warning', Listed: 'info', Sold: 'success' };
type Sort = NonNullable<PropertyQuery['sort']>;

const iso = (t: string): string | null => {
  const r = parseUsDate(t);
  return r.ok ? r.iso : null;
};

export function PropertiesPage() {
  const { scope, companyName, navigate } = useApp();
  const [f, setF] = useState({ q: '', status: '', pf: '', pt: '', sf: '', st: '', archived: false });
  const [sort, setSort] = useState<{ by: Sort; dir: 'asc' | 'desc' }>({ by: 'address', dir: 'asc' });
  const [page, setPage] = useState(1);
  const q = useDebounced(f.q, 250);
  const filtersActive = Boolean(f.q || f.status || f.pf || f.pt || f.sf || f.st || f.archived);

  const change = (patch: Partial<typeof f>) => { setF((x) => ({ ...x, ...patch })); setPage(1); };
  const clear = () => { setF({ q: '', status: '', pf: '', pt: '', sf: '', st: '', archived: false }); setPage(1); };

  const query: PropertyQuery = useMemo(() => ({
    scope, q, status: (f.status || null) as PropertyQuery['status'], includeArchived: f.archived,
    purchaseFrom: iso(f.pf), purchaseTo: iso(f.pt), saleFrom: iso(f.sf), saleTo: iso(f.st),
    sort: sort.by, dir: sort.dir, page, pageSize: 25,
  }), [scope, q, f.status, f.archived, f.pf, f.pt, f.sf, f.st, sort, page]);

  const { data, error, loading, reload } = useLoad(() => unwrap(api().listProperties(query)), [JSON.stringify(query)]);

  const header = (label: string, by: Sort, right = false) => (
    <th scope="col" className={right ? 'is-right' : undefined} aria-sort={sort.by === by ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button className="th-sort" onClick={() => { setSort((s) => ({ by, dir: s.by === by && s.dir === 'asc' ? 'desc' : 'asc' })); setPage(1); }}>
        {label}
        {sort.by === by && (sort.dir === 'asc' ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />)}
      </button>
    </th>
  );

  const total = data?.total ?? 0;
  const first = total === 0 ? 0 : ((data?.page ?? 1) - 1) * (data?.pageSize ?? 25) + 1;
  const last = Math.min(total, (data?.page ?? 1) * (data?.pageSize ?? 25));
  const pages = Math.max(1, Math.ceil(total / (data?.pageSize ?? 25)));
  const addHref = scope === 'all' ? '/properties/new' : `/properties/new?company=${scope}`;

  return (
    <>
      <PageHeader
        title="Properties"
        context={scope === 'all' ? 'All companies · view only. Choose a company to add a property.' : companyName(scope)}
        actions={<Button variant="primary" icon={<Plus size={16} aria-hidden="true" />} onClick={() => navigate(addHref)}>Add property</Button>}
      />
      <div className="page-body">
        <div className="filters filters--props" role="search" aria-label="Filter properties">
          <TextField label="Search address, city or ZIP" value={f.q} onChange={(e) => change({ q: e.target.value })} placeholder="For example: oak, or 372" type="search" />
          <SelectField label="Status" value={f.status} onChange={(e) => change({ status: e.target.value })}>
            <option value="">All statuses</option>
            {PROPERTY_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </SelectField>
          <div className="filters__more">
            <details className="disclosure" open={Boolean(f.pf || f.pt || f.sf || f.st)}>
              <summary>Date filters</summary>
              <div className="form-grid form-grid--4">
                <DateField label="Purchased from" value={f.pf} onChange={(t) => change({ pf: t })} hint="" error={f.pf && !iso(f.pf) ? 'Not a valid date.' : null} />
                <DateField label="Purchased to" value={f.pt} onChange={(t) => change({ pt: t })} hint="" error={f.pt && !iso(f.pt) ? 'Not a valid date.' : null} />
                <DateField label="Sold from" value={f.sf} onChange={(t) => change({ sf: t })} hint="" error={f.sf && !iso(f.sf) ? 'Not a valid date.' : null} />
                <DateField label="Sold to" value={f.st} onChange={(t) => change({ st: t })} hint="" error={f.st && !iso(f.st) ? 'Not a valid date.' : null} />
              </div>
            </details>
          </div>
          <label className="check"><input type="checkbox" checked={f.archived} onChange={(e) => change({ archived: e.target.checked })} /><span>Include archived</span></label>
          {filtersActive && <Button variant="ghost" size="sm" onClick={clear}>Clear filters</Button>}
          <p className="filters__count muted" role="status">{data ? `${total} ${total === 1 ? 'property' : 'properties'}` : ''}</p>
        </div>

        <div className="panel panel--flush" aria-busy={loading}>
          {error ? (
            <ErrorState title="Could not load properties" action={<Button onClick={reload}>Try again</Button>}>{error}</ErrorState>
          ) : data && data.rows.length === 0 ? (
            filtersActive ? (
              <EmptyState title="No matching properties" icon={<Search size={32} aria-hidden="true" />} action={<Button variant="secondary" onClick={clear}>Clear filters</Button>}>
                Nothing matches these filters. Your properties are still there.
              </EmptyState>
            ) : (
              <EmptyState title="No properties yet" action={<Button variant="primary" onClick={() => navigate(addHref)}>Add the first property</Button>}>
                {scope === 'all' ? 'No company has any properties yet.' : `${companyName(scope)} has no properties yet.`}
              </EmptyState>
            )
          ) : (
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Properties</caption>
                <thead>
                  <tr>
                    {header('Address', 'address')}
                    <th scope="col">City, ZIP</th>
                    {scope === 'all' && <th scope="col">Company</th>}
                    {header('Status', 'status')}
                    {header('Purchased', 'purchaseDate')}
                    {header('Purchase price', 'purchasePrice', true)}
                  </tr>
                </thead>
                <tbody>
                  {(data?.rows ?? []).map((p) => (
                    <tr key={p.id}>
                      <td className="truncate" title={`${p.address1}${p.address2 ? ', ' + p.address2 : ''}`}>
                        <a className="link table__primary" href={`#/properties/view?id=${p.id}`} onClick={(e) => { e.preventDefault(); navigate(`/properties/view?id=${p.id}`); }}>
                          {p.address1}{p.address2 ? `, ${p.address2}` : ''}
                        </a>
                        {p.isArchived && <> <Badge tone="neutral" small icon={false}>Archived</Badge></>}
                      </td>
                      <td className="num">{p.city}, {p.state} {p.zip}</td>
                      {scope === 'all' && <td>{p.companyName}</td>}
                      <td><Badge tone={TONE[p.status]!} icon={false}>{p.status}</Badge></td>
                      <td className="num">{formatUsDate(p.purchaseDate)}</td>
                      <td className="money num">{formatCents(p.purchasePriceCents)}</td>
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
