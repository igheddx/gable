import { useMemo, useState } from 'react';
import { Plus, ScanLine, Search } from 'lucide-react';
import { Badge, Button, EmptyState, SelectField, TextField } from '../components';
import { PageHeader } from '../shell/Shell';
import { useApp } from '../shell/AppContext';
import { formatCents } from '../../shared/money';
import { formatUsDate } from '../../shared/dates';

export function ExpensesPage() {
  const { navigate, scope, expenses, companyName, receipts } = useApp();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const waiting = receipts.filter((r) => r.status === 'Needs review' || r.status === 'Failed').length;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return expenses
      .filter((e) => scope === 'all' || e.companyId === scope)
      .filter((e) => !cat || e.category === cat)
      .filter((e) => !needle || e.vendor.toLowerCase().includes(needle))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [expenses, scope, q, cat]);

  const categories = [...new Set(expenses.map((e) => e.category))].sort();
  const context = scope === 'all' ? 'All companies, view only' : companyName(scope);

  return (
    <>
      <PageHeader
        title="Expenses"
        context={context}
        actions={
          <>
            <Button variant="secondary" icon={<ScanLine size={16} aria-hidden="true" />} onClick={() => navigate('/receipts/review')}>
              Review receipts{waiting ? ` (${waiting})` : ''}
            </Button>
            <Button variant="primary" icon={<Plus size={16} aria-hidden="true" />} onClick={() => navigate('/expenses/new')}>Add expense</Button>
          </>
        }
      />
      <div className="page-body">
        <div className="filters" role="search" aria-label="Filter expenses">
          <TextField label="Search vendor" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type to filter" type="search" />
          <SelectField label="Category" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c}>{c}</option>)}
          </SelectField>
          <p className="filters__count muted" role="status">{rows.length} {rows.length === 1 ? 'expense' : 'expenses'}</p>
        </div>
        <div className="panel panel--flush">
          {rows.length === 0 ? (
            expenses.filter((e) => scope === 'all' || e.companyId === scope).length === 0 ? (
              <EmptyState title="No expenses yet" icon={<Search size={32} aria-hidden="true" />} action={<Button variant="primary" onClick={() => navigate('/expenses/new')}>Add the first expense</Button>}>
                Add an expense by hand, or add several receipts and review them together.
              </EmptyState>
            ) : (
              <EmptyState title="No matches" icon={<Search size={32} aria-hidden="true" />} action={<Button variant="secondary" onClick={() => { setQ(''); setCat(''); }}>Clear filters</Button>}>
                No expenses match these filters. Your records are still there.
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
                    <th scope="col" className="is-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id}>
                      <td className="num">{formatUsDate(e.date)}</td>
                      <td className="table__primary">{e.vendor} {e.preview && <Badge tone="review" small>Sample, not stored</Badge>}</td>
                      <td className="truncate">{e.propertyId ? `Property #${e.propertyId}` : <span className="muted">General company</span>}</td>
                      {scope === 'all' && <td>{companyName(e.companyId)}</td>}
                      <td>{e.category}</td>
                      <td className="money num">{formatCents(e.cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
