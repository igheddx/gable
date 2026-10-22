import { useState } from 'react';
import { Pencil, Plus, ScanLine } from 'lucide-react';
import { Badge, Button, ErrorState, Notice, type Tone } from '../components';
import { PageHeader } from '../shell/Shell';
import { useApp } from '../shell/AppContext';
import { useToday } from '../shell/useToday';
import { api, unwrap, useLoad } from '../api';
import { formatCents } from '../../shared/money';
import { formatUsDate } from '../../shared/dates';
import { daysBetween, formatYmd, ymdBetween } from '../../shared/duration';
import type { Property } from '../../shared/types';

const TONE: Record<string, Tone> = { Held: 'neutral', Renovating: 'warning', Listed: 'info', Sold: 'success' };
const UNAVAILABLE = <span className="muted" title="Not available yet">Unavailable</span>;

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="fact"><dt>{label}</dt><dd>{children}</dd></div>;
}

export function PropertyDetailPage() {
  const { route, navigate } = useApp();
  const id = Number(route.query.get('id'));
  const { data: p, error } = useLoad(() => unwrap(api().getProperty(id)), [id]);
  const [tab, setTab] = useState<'lifetime' | 'year'>('lifetime');
  const today = useToday();

  if (error) return <div className="page-body"><ErrorState title="Could not open property" action={<Button onClick={() => navigate('/properties')}>Back to properties</Button>}>{error}</ErrorState></div>;
  if (!p) return null;

  const sold = p.status === 'Sold' && p.saleDate !== null;
  const endDate = sold ? p.saleDate! : today;
  const afterToday = p.purchaseDate > endDate; // purchase recorded in the future
  const days = afterToday ? null : daysBetween(p.purchaseDate, endDate);
  const readable = afterToday ? null : formatYmd(ymdBetween(p.purchaseDate, endDate));

  return (
    <>
      <PageHeader
        title={p.address1 + (p.address2 ? `, ${p.address2}` : '')}
        context={<>{p.city}, {p.state} {p.zip} · {p.companyName} · <Badge tone={TONE[p.status]!} icon={false}>{p.status}</Badge>{p.isArchived && <> <Badge tone="neutral" icon={false}>Archived</Badge></>}</>}
        actions={
          <>
            <Button variant="secondary" icon={<ScanLine size={16} aria-hidden="true" />} disabled={p.isArchived || p.companyArchived} onClick={() => navigate(`/receipts/review?property=${p.id}`)}>Add receipts</Button>
            <Button variant="secondary" icon={<Pencil size={16} aria-hidden="true" />} onClick={() => navigate(`/properties/edit?id=${p.id}`)}>Edit</Button>
            <Button variant="primary" icon={<Plus size={16} aria-hidden="true" />} disabled={p.isArchived || p.companyArchived} onClick={() => navigate(`/expenses/new?property=${p.id}`)}>Add expense</Button>
          </>
        }
      />
      <div className="page-body">
        {(p.isArchived || p.companyArchived) && <Notice>{p.isArchived ? 'This property is archived.' : `${p.companyName} is archived.`} Its history is kept, and new expenses cannot be added.</Notice>}

        <div className="tabs" role="tablist" aria-label="Property views">
          <button role="tab" aria-selected={tab === 'lifetime'} onClick={() => setTab('lifetime')}>Lifetime</button>
          <button role="tab" aria-selected={tab === 'year'} onClick={() => setTab('year')}>By year</button>
        </div>

        {tab === 'lifetime' ? <Lifetime p={p} sold={sold} days={days} readable={readable} /> : <ByYear p={p} sold={sold} endDate={endDate} />}

        {(p.description || p.notes) && (
          <div className="panel">
            {p.description && <><h2 className="section-title">Description</h2><p className="prewrap">{p.description}</p></>}
            {p.notes && <><h2 className="section-title">Notes</h2><p className="prewrap">{p.notes}</p></>}
          </div>
        )}
      </div>
    </>
  );
}

function Lifetime({ p, sold, days, readable }: { p: Property; sold: boolean; days: number | null; readable: string | null }) {
  return (
    <div className="detail-grid">
      <section className="panel" aria-label="Purchase and sale">
        <h2 className="section-title">Purchase and sale</h2>
        <dl className="facts">
          <Fact label="Purchased">{formatUsDate(p.purchaseDate)}</Fact>
          <Fact label="Purchase price"><span className="money num">{formatCents(p.purchasePriceCents)}</span></Fact>
          {sold ? (
            <>
              <Fact label="Sold">{formatUsDate(p.saleDate!)}</Fact>
              <Fact label="Gross sale price"><span className="money num">{formatCents(p.salePriceCents!)}</span></Fact>
            </>
          ) : <Fact label="Sale">Not sold</Fact>}
          <Fact label={sold ? 'Days held' : 'Held to date'}>
            {days === null ? UNAVAILABLE : <><span className="num">{days.toLocaleString('en-US')} {days === 1 ? 'day' : 'days'}</span><span className="muted"> · {readable}</span></>}
          </Fact>
        </dl>
      </section>

      <section className="panel" aria-label="Lifetime cost bridge">
        <h2 className="section-title">Lifetime cost</h2>
        <table className="bridge">
          <tbody>
            <tr><th scope="row">Purchase price</th><td className="money num">{formatCents(p.purchasePriceCents)}</td></tr>
            <tr><th scope="row">Purchase closing costs</th><td className="money">{UNAVAILABLE}</td></tr>
            <tr><th scope="row">Renovation and repairs</th><td className="money">{UNAVAILABLE}</td></tr>
            <tr><th scope="row">Holding costs</th><td className="money">{UNAVAILABLE}</td></tr>
            <tr><th scope="row">Selling costs</th><td className="money">{UNAVAILABLE}</td></tr>
            <tr className="bridge__total"><th scope="row">Total project cost</th><td className="money">{UNAVAILABLE}</td></tr>
            {sold && <tr><th scope="row">Gross sale price</th><td className="money num">{formatCents(p.salePriceCents!)}</td></tr>}
            <tr className="bridge__total"><th scope="row">Profit before taxes</th><td className="money">{UNAVAILABLE}</td></tr>
          </tbody>
        </table>
        <p className="muted">Expenses are recorded in the next stage. Costs and profit appear here once they are, and are never shown as zero while unknown.{!sold && ' Profit and return apply only to sold properties.'}</p>
      </section>
    </div>
  );
}

function ByYear({ p, sold, endDate }: { p: Property; sold: boolean; endDate: string }) {
  const startYear = Number(p.purchaseDate.slice(0, 4));
  const endYear = Math.max(startYear, Number(endDate.slice(0, 4)));
  const years = Array.from({ length: endYear - startYear + 1 }, (_, i) => startYear + i);
  return (
    <section className="panel panel--flush" aria-label="By year">
      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">Recorded activity for each calendar year</caption>
          <thead><tr><th scope="col">Year</th><th scope="col" className="is-right">Purchase price</th><th scope="col" className="is-right">Expenses</th><th scope="col" className="is-right">Sale proceeds</th></tr></thead>
          <tbody>
            {years.map((y) => (
              <tr key={y}>
                <th scope="row" className="num">{y}</th>
                <td className="money num">{y === startYear ? formatCents(p.purchasePriceCents) : <span className="muted">—</span>}</td>
                <td className="money">{UNAVAILABLE}</td>
                <td className="money num">{sold && y === Number(p.saleDate!.slice(0, 4)) ? formatCents(p.salePriceCents!) : <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted pad">Every year from purchase to {sold ? 'sale' : 'today'} is listed, including quiet years. Yearly expenses appear here once expenses are recorded. The purchase price is shown once, in the year of purchase.</p>
    </section>
  );
}
