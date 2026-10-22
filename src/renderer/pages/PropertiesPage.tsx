import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Badge, Button, EmptyState, SelectField, TextField, type Tone } from '../components';
import { PageHeader } from '../shell/Shell';
import { useApp } from '../shell/AppContext';
import { COMPANIES, PROPERTIES } from '../fixtures';
import { formatCents } from '../../shared/money';
import { formatUsDate } from '../../shared/dates';

const TONE: Record<string, Tone> = { Held: 'neutral', Renovating: 'warning', Listed: 'info', Sold: 'success' };

export function PropertiesPage() {
  const { scope, companyName } = useApp();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '');
    return PROPERTIES.filter((p) => scope === 'all' || p.companyId === scope)
      .filter((p) => !status || p.status === status)
      .filter((p) => !needle || `${p.address} ${p.city} ${p.zip}`.toLowerCase().replace(/[^a-z0-9 ]/g, '').includes(needle))
      .sort((a, b) => a.address.localeCompare(b.address, undefined, { numeric: true }));
  }, [scope, q, status]);

  return (
    <>
      <PageHeader title="Properties" context={scope === 'all' ? 'All companies, view only' : companyName(scope)} />
      <div className="page-body">
        <div className="filters" role="search" aria-label="Filter properties">
          <TextField label="Search address, city or ZIP" value={q} onChange={(e) => setQ(e.target.value)} placeholder="For example: oak, or 372" type="search" />
          <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {['Held', 'Renovating', 'Listed', 'Sold'].map((s) => <option key={s}>{s}</option>)}
          </SelectField>
          <p className="filters__count muted" role="status">{rows.length} {rows.length === 1 ? 'property' : 'properties'}</p>
        </div>
        <div className="panel panel--flush">
          {rows.length === 0 ? (
            <EmptyState title="No matching properties" icon={<Search size={32} aria-hidden="true" />} action={<Button variant="secondary" onClick={() => { setQ(''); setStatus(''); }}>Clear filters</Button>}>
              Nothing matches these filters. Your properties are still there.
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Properties</caption>
                <thead>
                  <tr>
                    <th scope="col">Address</th>
                    <th scope="col">City, ZIP</th>
                    {scope === 'all' && <th scope="col">Company</th>}
                    <th scope="col">Status</th>
                    <th scope="col">Purchased</th>
                    <th scope="col" className="is-right">Purchase price</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id}>
                      <td className="table__primary truncate" title={p.address}>{p.address}</td>
                      <td className="num">{p.city}, {p.state} {p.zip}</td>
                      {scope === 'all' && <td>{COMPANIES.find((c) => c.id === p.companyId)?.name}</td>}
                      <td><Badge tone={TONE[p.status]!} icon={false}>{p.status}</Badge></td>
                      <td className="num">{formatUsDate(p.purchaseDate)}</td>
                      <td className="money num">{formatCents(p.purchaseCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <p className="muted">Sample properties for the design preview. Adding and editing properties arrives in the next stage.</p>
      </div>
    </>
  );
}
