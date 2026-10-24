import { useMemo, useState } from 'react';
import { FileSpreadsheet, FileText } from 'lucide-react';
import { Button, DateField, ErrorState, Notice, SelectField, useToast } from '../components';
import { ReportView } from '../components/ReportView';
import { PageHeader } from '../shell/Shell';
import { useApp } from '../shell/AppContext';
import { ApiError, api, errorMessage, unwrap, useLoad } from '../api';
import { periodPresets } from '../periods';
import { parseUsDate } from '../../shared/dates';
import type { ReportKind, ReportRequest } from '../../shared/reportTypes';

const KINDS: { kind: ReportKind; label: string; help: string; needs: 'sale' | 'expense' | 'income' | 'none' | 'property' }[] = [
  { kind: 'sold-performance', label: 'Sold-asset performance', help: 'Renovations and vehicles sold in a period (by sale date), with their full lifetime costs and profit.', needs: 'sale' },
  { kind: 'income-expense', label: 'Rental and other income', help: 'Income received and expenses paid by rentals and ongoing businesses in a period, by item, month and category.', needs: 'income' },
  { kind: 'expense-activity', label: 'Expense activity', help: 'Expenses dated in a period (by expense date), by category and asset. General company expenses are listed separately.', needs: 'expense' },
  { kind: 'portfolio-snapshot', label: 'Current portfolio snapshot', help: 'Investment recorded in unsold renovations and vehicles, and realized results of sold ones, kept apart.', needs: 'none' },
  { kind: 'property', label: 'Individual asset', help: 'One asset from start to today: costs and profit for a renovation or vehicle, or income and expenses by year for a rental.', needs: 'property' },
];

const iso = (t: string): string | null => { const r = parseUsDate(t); return r.ok ? r.iso : null; };

export function ReportsPage() {
  const { scope, companyName, route } = useApp();
  const toast = useToast();
  const presets = useMemo(() => periodPresets(), []);
  const [kind, setKind] = useState<ReportKind>((route.query.get('kind') as ReportKind) || 'sold-performance');
  const [period, setPeriod] = useState('this-year');
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const [propertyId, setPropertyId] = useState<string>(route.query.get('property') ?? '');
  const [busy, setBusy] = useState<'xlsx' | 'pdf' | null>(null);

  const meta = KINDS.find((k) => k.kind === kind)!;
  const preset = presets.find((p) => p.key === period)!;
  const custom = period === 'custom';
  const ranged = meta.needs === 'sale' || meta.needs === 'expense' || meta.needs === 'income';
  const from = ranged ? (custom ? iso(fromText) : preset.from) : null;
  const to = ranged ? (custom ? iso(toText) : preset.to) : null;
  const badRange = custom && ((fromText && !iso(fromText)) || (toText && !iso(toText)) || (from && to && to < from));

  const { data: props } = useLoad(() => (scope === 'all' ? Promise.resolve(null) : unwrap(api().listProperties({ scope, pageSize: 100, sort: 'address', includeArchived: true }))), [scope]);
  const needsProperty = meta.needs === 'property';
  const propertyForScope = scope !== 'all' && props?.rows.some((p) => String(p.id) === propertyId) ? propertyId : (route.query.get('property') ?? '');
  const request: ReportRequest | null =
    badRange ? null : needsProperty && !propertyForScope ? null
    : { kind, scope, from, to, propertyId: needsProperty ? Number(propertyForScope) : null };

  const { data: doc, error, loading } = useLoad(() => (request ? unwrap(api().buildReport(request)) : Promise.resolve(null)), [JSON.stringify(request)]);

  const run = async (type: 'xlsx' | 'pdf') => {
    if (!request) return;
    setBusy(type);
    try {
      const r = await unwrap(type === 'xlsx' ? api().exportReportXlsx(request) : api().exportReportPdf(request));
      if (r.saved) toast(`Saved ${r.fileName}.`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Reports"
        context={scope === 'all' ? 'All companies · combined view' : companyName(scope)}
        actions={
          <>
            <Button variant="secondary" icon={<FileSpreadsheet size={16} aria-hidden="true" />} disabled={!request || busy !== null || !doc} onClick={() => void run('xlsx')}>{busy === 'xlsx' ? 'Saving…' : 'Export Excel'}</Button>
            <Button variant="secondary" icon={<FileText size={16} aria-hidden="true" />} disabled={!request || busy !== null || !doc} onClick={() => void run('pdf')}>{busy === 'pdf' ? 'Preparing PDF…' : 'Export PDF'}</Button>
          </>
        }
      />
      <div className="page-body page-body--wide">
        <div className="panel report-controls">
          <div className="report-kinds" role="radiogroup" aria-label="Report">
            {KINDS.map((k) => (
              <label key={k.kind} className={`report-kind${kind === k.kind ? ' is-on' : ''}`}>
                <input type="radio" name="report-kind" checked={kind === k.kind} onChange={() => setKind(k.kind)} />
                <span className="report-kind__label">{k.label}</span>
                <span className="muted small">{k.help}</span>
              </label>
            ))}
          </div>
          <div className="report-filters">
            {ranged && (
              <>
                <SelectField label={meta.needs === 'sale' ? 'Sale date range' : meta.needs === 'income' ? 'Date range' : 'Expense date range'} value={period} onChange={(e) => setPeriod(e.target.value)}>
                  {presets.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                </SelectField>
                {custom && (
                  <>
                    <DateField label="From" value={fromText} onChange={setFromText} hint="" error={fromText && !iso(fromText) ? 'Not a valid date.' : null} />
                    <DateField label="To" value={toText} onChange={setToText} hint="" error={toText && !iso(toText) ? 'Not a valid date.' : to && from && to < from ? 'The end date is before the start date.' : null} />
                  </>
                )}
              </>
            )}
            {needsProperty && (
              scope === 'all'
                ? <Notice>Choose one company in the sidebar to pick an asset.</Notice>
                : <SelectField label="Asset" required value={propertyForScope} onChange={(e) => setPropertyId(e.target.value)}>
                    <option value="">Choose an asset…</option>
                    {(props?.rows ?? []).map((p) => <option key={p.id} value={p.id}>{p.address1}{p.isArchived ? ' (archived)' : ''}</option>)}
                  </SelectField>
            )}
          </div>
        </div>
        <p className="muted small">These are management reports built from the records in Gable. They are not financial statements or tax returns.</p>
        {error && <ErrorState title="Could not build this report">{error}</ErrorState>}
        {!error && loading && !doc && <p className="muted">Building report…</p>}
        {!error && doc && <ReportView doc={doc} />}
      </div>
    </>
  );
}
