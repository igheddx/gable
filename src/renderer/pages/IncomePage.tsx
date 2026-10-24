import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Badge, Button, EmptyState, ErrorState, SelectField, useToast } from '../components';
import { IncomeDialog } from '../components/IncomeDialog';
import { PageHeader } from '../shell/Shell';
import { useApp } from '../shell/AppContext';
import { api, errorMessage, unwrap, useLoad } from '../api';
import { TEMPLATE_INFO } from '../../shared/businessTypes';
import { formatCents } from '../../shared/money';
import { formatUsDate } from '../../shared/dates';
import type { Income } from '../../shared/types';
import type { IncomeQuery } from '../../shared/schemas';

/** Rent and other money received by rentals and ongoing businesses. */
export function IncomePage() {
  const { scope, companyName, navigate } = useApp();
  const toast = useToast();
  const [item, setItem] = useState('');
  const [voided, setVoided] = useState(false);
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Income | null>(null);

  const query: IncomeQuery = useMemo(() => ({ scope, propertyId: item ? Number(item) : null, includeVoided: voided, page, pageSize: 25 }), [scope, item, voided, page]);
  const { data, error, loading, reload } = useLoad(() => unwrap(api().listIncome(query)), [JSON.stringify(query)]);
  const { data: props } = useLoad(() => unwrap(api().listProperties({ scope, pageSize: 100, sort: 'address' })), [scope]);
  const items = (props?.rows ?? []).filter((p) => TEMPLATE_INFO[p.template].tracksIncome);
  const open = items.filter((p) => !p.isArchived);

  const total = data?.total ?? 0;
  const first = total === 0 ? 0 : ((data?.page ?? 1) - 1) * (data?.pageSize ?? 25) + 1;
  const last = Math.min(total, (data?.page ?? 1) * (data?.pageSize ?? 25));
  const pages = Math.max(1, Math.ceil(total / (data?.pageSize ?? 25)));

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast(ok); reload(); } catch (e) { toast(errorMessage(e), 'error'); }
  };

  return (
    <>
      <PageHeader
        title="Income"
        context={scope === 'all' ? 'All companies · view only. Choose a company to add income.' : companyName(scope)}
        actions={<Button variant="primary" icon={<Plus size={16} aria-hidden="true" />} disabled={scope === 'all'} onClick={() => setAdding(true)}>Add income</Button>}
      />
      <div className="page-body">
        <p className="muted">Rent and other money received by your rentals and ongoing businesses. Expenses for these are entered under Expenses, and net income is on each rental&apos;s page and in Reports.</p>
        <div className="filters filters--exp" role="search" aria-label="Filter income">
          <SelectField label="Rental or business" value={item} onChange={(e) => { setItem(e.target.value); setPage(1); }}>
            <option value="">All</option>
            {items.map((p) => <option key={p.id} value={p.id}>{p.address1}</option>)}
          </SelectField>
          <label className="check"><input type="checkbox" checked={voided} onChange={(e) => { setVoided(e.target.checked); setPage(1); }} /><span>Include voided</span></label>
          <p className="filters__count muted" role="status">{data ? `${total} ${total === 1 ? 'entry' : 'entries'}` : ''}</p>
        </div>

        <div className="panel panel--flush" aria-busy={loading}>
          {error ? (
            <ErrorState title="Could not load income" action={<Button onClick={reload}>Try again</Button>}>{error}</ErrorState>
          ) : data && data.rows.length === 0 ? (
            <EmptyState title="No income recorded" action={scope !== 'all' ? <Button variant="primary" disabled={open.length === 0} onClick={() => setAdding(true)}>Add income</Button> : undefined}>
              {open.length === 0 && scope !== 'all'
                ? <>Add a rental property or an ongoing business under <a className="link" href="#/properties" onClick={(e) => { e.preventDefault(); navigate('/properties'); }}>Assets</a> first. Income is recorded against those.</>
                : 'Rent and other income you record will appear here.'}
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Income</caption>
                <thead><tr><th scope="col">Date</th><th scope="col">Rental or business</th>{scope === 'all' && <th scope="col">Company</th>}<th scope="col">Type</th><th scope="col">Notes</th><th scope="col" className="is-right">Amount</th><th scope="col" className="is-right">Actions</th></tr></thead>
                <tbody>
                  {(data?.rows ?? []).map((i) => {
                    const locked = scope === 'all';
                    return (
                      <tr key={i.id} className={i.status === 'voided' ? 'is-voided' : undefined}>
                        <td className="num">{formatUsDate(i.incomeDate)}</td>
                        <td className="truncate"><a className="link table__primary" href={`#/properties/view?id=${i.propertyId}`} onClick={(e) => { e.preventDefault(); navigate(`/properties/view?id=${i.propertyId}`); }}>{i.propertyName}</a></td>
                        {scope === 'all' && <td>{i.companyName}</td>}
                        <td>{i.category} {i.status === 'voided' && <Badge tone="neutral" small icon={false}>Voided</Badge>}</td>
                        <td className="truncate" title={i.notes}>{i.notes}</td>
                        <td className="money num">{formatCents(i.amountCents)}</td>
                        <td className="is-right">
                          <div className="row-actions">
                            {i.status === 'posted' && <Button size="sm" variant="ghost" disabled={locked} aria-label={`Edit income of ${formatCents(i.amountCents)} for ${i.propertyName} on ${formatUsDate(i.incomeDate)}`} onClick={() => setEditing(i)}>Edit</Button>}
                            {i.status === 'posted'
                              ? <Button size="sm" variant="ghost" disabled={locked} aria-label={`Void income of ${formatCents(i.amountCents)} for ${i.propertyName} on ${formatUsDate(i.incomeDate)}`} onClick={() => void act(() => unwrap(api().voidIncome(i.id)), 'Income voided. It no longer counts.')}>Void</Button>
                              : <Button size="sm" variant="ghost" disabled={locked} aria-label={`Restore income of ${formatCents(i.amountCents)} for ${i.propertyName} on ${formatUsDate(i.incomeDate)}`} onClick={() => void act(() => unwrap(api().unvoidIncome(i.id)), 'Income restored.')}>Restore</Button>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
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
      {scope !== 'all' && (
        <IncomeDialog open={adding} onClose={() => setAdding(false)} companyId={scope} items={open}
          onSaved={() => { setAdding(false); toast('Income added.'); reload(); }} />
      )}
      {scope !== 'all' && (
        <IncomeDialog open={editing !== null} onClose={() => setEditing(null)} companyId={scope} items={items} income={editing ?? undefined}
          onSaved={() => { setEditing(null); toast('Income saved.'); reload(); }} />
      )}
    </>
  );
}
