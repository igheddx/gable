import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, RefreshCw, RotateCcw, RotateCw, SkipForward, ZoomIn, ZoomOut } from 'lucide-react';
import { Badge, Button, Combobox, CurrencyField, DateField, Notice, useToast, type Tone } from '../components';
import { AllocationEditor, allocatedCents, validateAllocations, type AllocLine } from '../components/AllocationEditor';
import { PageHeader } from '../shell/Shell';
import { useApp } from '../shell/AppContext';
import { CATEGORIES, VENDORS, type FxReceipt, type ReceiptStatus } from '../fixtures';
import { formatCents, parseCurrency } from '../../shared/money';
import { parseUsDate } from '../../shared/dates';

const TONE: Record<ReceiptStatus, Tone> = { Processing: 'info', 'Needs review': 'review', Reviewed: 'success', Failed: 'danger', Skipped: 'neutral' };

interface Draft { vendor: string; date: string; total: string; category: string; split: boolean; lines: AllocLine[]; ok: boolean; edited: Set<string> }

function initialDraft(r: FxReceipt): Draft {
  const s = r.suggestion;
  return { vendor: s?.vendor ?? '', date: s?.date ?? '', total: s?.total ?? '', category: s?.category ?? '', split: false, lines: [], ok: false, edited: new Set() };
}

export function ReceiptReviewPage() {
  const { receipts, setReceiptStatus, setDirty, navigate, route, scope, companyName } = useApp();
  const toast = useToast();
  const [selectedId, setSelectedId] = useState(receipts[0]!.id);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [pane, setPane] = useState<'preview' | 'details'>('details');
  const [zoom, setZoom] = useState(1);
  const [rot, setRot] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const receipt = receipts.find((r) => r.id === selectedId)!;
  const draft = drafts[selectedId] ?? initialDraft(receipt);
  const patch = (field: string, p: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [selectedId]: { ...draft, ...p, edited: new Set([...draft.edited, field]) } }));

  useEffect(() => {
    setDirty(Object.values(drafts).some((d) => d.edited.size > 0) && receipts.some((r) => r.status === 'Needs review'));
    return () => setDirty(false);
  }, [drafts, receipts, setDirty]);

  const select = (id: string) => {
    setSelectedId(id);
    setZoom(1);
    setRot(0);
    setShowErrors(false);
  };

  const categoryOptions = useMemo(() => CATEGORIES.map((c) => ({ value: c, label: c })), []);
  const vendorOptions = useMemo(() => VENDORS.map((v) => ({ value: v, label: v })), []);

  const totalParsed = parseCurrency(draft.total);
  const dateParsed = parseUsDate(draft.date);
  const totalCents = totalParsed.ok ? totalParsed.cents : null;
  const allocV = draft.split ? validateAllocations(draft.lines, totalCents) : { lines: {}, total: null };
  const e = {
    vendor: draft.vendor.trim() ? null : 'Enter the vendor.',
    date: dateParsed.ok ? null : dateParsed.message,
    total: totalParsed.ok ? null : totalParsed.message,
    category: draft.split || draft.category ? null : 'Choose a category.',
    dup: receipt.duplicateOf && !draft.ok ? 'Confirm this is a different purchase, or skip the receipt.' : null,
  };
  const splitBad = draft.split && (Object.keys(allocV.lines).length > 0 || allocV.total !== null);
  const invalid = Object.values(e).some(Boolean) || splitBad;
  const editable = receipt.status === 'Needs review' || receipt.status === 'Failed' || receipt.status === 'Skipped';

  const mark = (field: string): React.ReactNode => {
    if (!receipt.suggestion) return null;
    if (draft.edited.has(field)) return <Badge tone="info" small>Edited by you</Badge>;
    if (field === 'category' && !receipt.suggestion.category) return null;
    return <Badge tone="review" small>Needs review</Badge>;
  };

  const next = (fromId: string) => {
    const idx = receipts.findIndex((r) => r.id === fromId);
    const after = [...receipts.slice(idx + 1), ...receipts.slice(0, idx)].find((r) => r.status === 'Needs review' || r.status === 'Failed');
    if (after) select(after.id);
    else toast('No more receipts waiting for review.');
  };

  const save = () => {
    setShowErrors(true);
    if (invalid) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('.review__form [aria-invalid="true"]')?.focus());
      return;
    }
    setReceiptStatus(receipt.id, 'Reviewed');
    toast(`${receipt.file} reviewed and saved as an expense (sample preview, not stored).`);
    next(receipt.id);
  };

  const retry = () => {
    setRetrying(true);
    setTimeout(() => {
      setRetrying(false);
      setReceiptStatus(receipt.id, 'Needs review', { vendor: 'Redwood Hardware', date: '09/09/2026', total: '41.30', category: '', categorySource: '' });
      setDrafts((d) => ({ ...d, [receipt.id]: initialDraft({ ...receipt, suggestion: { vendor: 'Redwood Hardware', date: '09/09/2026', total: '41.30', category: '', categorySource: '' } }) }));
    }, 700);
  };

  const counts = receipts.reduce<Record<string, number>>((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {});

  return (
    <>
      <PageHeader
        title="Review receipts"
        context={`${receipts.length} receipts · ${counts['Needs review'] ?? 0} need review · ${counts['Reviewed'] ?? 0} reviewed`}
        actions={<Button variant="ghost" onClick={() => navigate('/expenses')}>Back to expenses</Button>}
      />
      <div className="page-body page-body--wide">
        <Notice tone="preview">Design preview. These sample receipts and suggested values are fictional; real scanning arrives in a later stage. Nothing here is counted as an expense until you save it.</Notice>
        <div className="review-wrap"><div className="review">
          <nav className="review__queue panel panel--flush" aria-label="Receipt queue">
            <ul>
              {receipts.map((r) => (
                <li key={r.id}>
                  <button className="queue-item" aria-current={r.id === selectedId ? 'true' : undefined} onClick={() => select(r.id)}>
                    <span className="queue-item__file">{r.file}</span>
                    <span className="queue-item__meta muted num">
                      {r.suggestion ? `${r.suggestion.vendor} · $${r.suggestion.total}` : 'No details yet'}
                      {r.pages > 1 ? ` · ${r.pages} pages` : ''}
                    </span>
                    <Badge tone={TONE[r.status]} small>{r.status}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div className="review__tabs" role="tablist" aria-label="Receipt view">
            <button role="tab" id="tab-preview" aria-selected={pane === 'preview'} aria-controls="pane-preview" onClick={() => setPane('preview')}>Receipt</button>
            <button role="tab" id="tab-details" aria-selected={pane === 'details'} aria-controls="pane-details" onClick={() => setPane('details')}>Details</button>
          </div>

          <section id="pane-preview" role="tabpanel" aria-labelledby="tab-preview" className={`review__preview panel panel--flush${pane === 'preview' ? ' is-active' : ''}`} aria-label="Receipt preview">
            <div className="toolbar" role="toolbar" aria-label="Preview controls">
              <Button size="sm" variant="ghost" iconOnly aria-label="Zoom out" disabled={zoom <= 0.5} onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} icon={<ZoomOut size={16} aria-hidden="true" />} />
              <span className="toolbar__value num" aria-live="polite">{Math.round(zoom * 100)}%</span>
              <Button size="sm" variant="ghost" iconOnly aria-label="Zoom in" disabled={zoom >= 3} onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))} icon={<ZoomIn size={16} aria-hidden="true" />} />
              <Button size="sm" variant="ghost" onClick={() => { setZoom(1); setRot(0); }}>Reset</Button>
              <span className="toolbar__sep" />
              <Button size="sm" variant="ghost" iconOnly aria-label="Rotate left" onClick={() => setRot((r) => r - 90)} icon={<RotateCcw size={16} aria-hidden="true" />} />
              <Button size="sm" variant="ghost" iconOnly aria-label="Rotate right" onClick={() => setRot((r) => r + 90)} icon={<RotateCw size={16} aria-hidden="true" />} />
              <span className="toolbar__file muted">{receipt.file}{receipt.pages > 1 ? ` · ${receipt.pages} pages` : ''}</span>
            </div>
            <div className="preview-stage" tabIndex={0} aria-label={`Preview of ${receipt.file}. Scroll to pan.`}>
              <div className="paper" style={{ transform: `rotate(${rot}deg) scale(${zoom})` }} role="img" aria-label={`Sample receipt: ${receipt.lines.map((l) => l.join(' ')).join(', ')}`}>
                <p className="paper__head">{receipt.suggestion?.vendor ?? 'SAMPLE RECEIPT'}</p>
                <p className="paper__sub">Sample document, fictional</p>
                <hr />
                {receipt.lines.map(([k, v], i) => (
                  <div className="paper__line" key={i}><span>{k}</span><span className="num">{v}</span></div>
                ))}
              </div>
            </div>
          </section>

          <section id="pane-details" role="tabpanel" aria-labelledby="tab-details" className={`review__form panel${pane === 'details' ? ' is-active' : ''}`} aria-label="Receipt details">
            <div className="review__form-head">
              <h2 className="panel__title">Details</h2>
              <Badge tone={TONE[receipt.status]}>{receipt.status}</Badge>
            </div>
            <p className="muted">{scope === 'all' ? 'Sample receipt' : `Sample receipt · will belong to ${companyName(scope)}`}{route.query.get('property') ? ' · property chosen from its page' : ''}</p>

            {receipt.status === 'Failed' && <Notice tone="danger">{receipt.note} Fill in the details below by hand to continue.</Notice>}
            {receipt.status === 'Processing' && <Notice>Reading this file. It will be ready to review shortly.</Notice>}
            {receipt.status === 'Needs review' && receipt.note && <Notice tone="preview">{receipt.note}</Notice>}
            {receipt.duplicateOf && receipt.status !== 'Reviewed' && (
              <Notice tone="danger">
                Possible duplicate of {receipt.duplicateOf}.
                <label className="check check--inline">
                  <input type="checkbox" checked={draft.ok} onChange={(ev) => setDrafts((d) => ({ ...d, [selectedId]: { ...draft, ok: ev.target.checked } }))} aria-invalid={showErrors && e.dup ? true : undefined} />
                  <span>This is a different purchase</span>
                </label>
              </Notice>
            )}

            <fieldset className="fieldset" disabled={!editable || retrying}>
              <legend className="sr-only">Expense details for {receipt.file}</legend>
              <Combobox label="Vendor" required freeText options={vendorOptions} value={draft.vendor} onChange={(v) => patch('vendor', { vendor: v })} badge={mark('vendor')} error={showErrors ? e.vendor : null} />
              <div className="form-grid">
                <DateField label="Expense date" required value={draft.date} onChange={(v) => patch('date', { date: v })} badge={mark('date')} error={showErrors ? e.date : null} hint="" />
                <CurrencyField label="Total" required value={draft.total} onChange={(v) => patch('total', { total: v })} badge={mark('total')} error={showErrors ? e.total : null} />
              </div>
              {!draft.split ? (
                <Combobox label="Category" required options={categoryOptions} value={draft.category} onChange={(c) => patch('category', { category: c })} badge={mark('category')}
                  error={showErrors ? e.category : null} hint={receipt.suggestion?.categorySource && !draft.edited.has('category') ? receipt.suggestion.categorySource : undefined} placeholder="Select category" />
              ) : (
                <AllocationEditor lines={draft.lines} onChange={(lines) => patch('lines', { lines })} categories={CATEGORIES} totalCents={totalCents} showErrors={showErrors} />
              )}
              <label className="check">
                <input type="checkbox" checked={draft.split} onChange={(ev) => {
                  const on = ev.target.checked;
                  patch('split', { split: on, lines: on ? [{ category: draft.category, amount: totalCents !== null ? formatCents(totalCents, { symbol: false }) : '' }, { category: '', amount: '' }] : [] });
                }} />
                <span>Split across several categories</span>
              </label>
              {draft.split && totalCents !== null && <p className="muted num">Total {formatCents(totalCents)} · assigned {formatCents(allocatedCents(draft.lines))}</p>}
            </fieldset>

            <div className="review__actions">
              {receipt.status === 'Failed' && <Button variant="secondary" icon={<RefreshCw size={16} aria-hidden="true" />} onClick={retry} disabled={retrying}>{retrying ? 'Trying again…' : 'Try reading again'}</Button>}
              <Button variant="ghost" icon={<SkipForward size={16} aria-hidden="true" />} disabled={!editable} onClick={() => { setReceiptStatus(receipt.id, 'Skipped'); next(receipt.id); }}>Skip</Button>
              <Button variant="ghost" icon={<ArrowRight size={16} aria-hidden="true" />} onClick={() => next(receipt.id)}>Next receipt</Button>
              <Button variant="primary" onClick={save} disabled={!editable || retrying || receipt.status === 'Processing'}>Save expense</Button>
            </div>
            {showErrors && invalid && <p className="field__error" role="alert">Fix the highlighted fields to save this receipt.</p>}
          </section>
        </div></div>
      </div>
    </>
  );
}

