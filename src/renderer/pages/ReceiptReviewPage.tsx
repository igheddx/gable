import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, CircleCheck, Plus, RefreshCw, RotateCcw, RotateCw, SkipForward, Square, Trash2, Undo2, ZoomIn, ZoomOut } from 'lucide-react';
import { Badge, Button, Combobox, CurrencyField, DateField, Dialog, Disclosure, EmptyState, ErrorState, Notice, SelectField, TextAreaField, useToast, type Tone } from '../components';
import { AllocationEditor, allocatedCents, validateAllocations, type AllocLine } from '../components/AllocationEditor';
import { ReceiptImport } from '../components/ReceiptImport';
import { PageHeader } from '../shell/Shell';
import { useApp } from '../shell/AppContext';
import { ApiError, api, errorMessage, unwrap, useLoad } from '../api';
import { formatCents, parseCurrency } from '../../shared/money';
import { formatUsDate, parseUsDate } from '../../shared/dates';
import type { DraftPatch } from '../../shared/schemas';
import type { DraftStatus, PostAllResult, ReceiptDraft, ReceiptDraftDetail } from '../../shared/types';

const TONE: Record<DraftStatus, Tone> = { queued: 'info', processing: 'info', needs_review: 'review', reviewed: 'success', failed: 'danger', skipped: 'neutral', saved: 'success' };
const LABEL: Record<DraftStatus, string> = {
  queued: 'Waiting to be read', processing: 'Reading…', needs_review: 'Needs review', reviewed: 'Reviewed', failed: 'Could not read', skipped: 'Skipped', saved: 'Saved',
};
const inputMoney = (c: number) => formatCents(c, { symbol: false });
const titleOf = (d: ReceiptDraft) => (d.files.length === 0 ? `Receipt ${d.id}` : d.files.length === 1 ? d.files[0]!.name : `${d.files[0]!.name} + ${d.files.length - 1} more`);

export function ReceiptReviewPage() {
  const { scope, navigate, route, companyName } = useApp();
  const toast = useToast();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [importing, setImporting] = useState(route.query.get('add') === '1');
  const [result, setResult] = useState<PostAllResult | null>(null);
  const [busy, setBusy] = useState(false);
  const presetProperty = Number(route.query.get('property')) || null;

  const { data: drafts, error, reload } = useLoad(() => unwrap(api().listReceipts({ scope })), [scope]);
  const reloadRef = useRef(reload);
  useEffect(() => { reloadRef.current = reload; });
  // Reading progress and status changes arrive from the main process; refresh the queue when they do.
  useEffect(() => api().onReceiptEvent(() => reloadRef.current()), []);

  const list = drafts ?? [];
  const selected = list.find((d) => d.id === selectedId) ?? list[0] ?? null;
  const reviewed = list.filter((d) => d.status === 'reviewed').length;
  const counts = list.reduce<Record<string, number>>((m, d) => ({ ...m, [d.status]: (m[d.status] ?? 0) + 1 }), {});

  const next = (fromId: number) => {
    const open = list.filter((d) => d.id !== fromId && ['needs_review', 'failed', 'reviewed'].includes(d.status));
    const after = open.find((d) => d.id > fromId) ?? open[0];
    if (after) setSelectedId(after.id);
    else { setSelectedId(null); toast('No more receipts are waiting for review.'); }
  };

  const saveAll = async () => {
    setBusy(true);
    try {
      const r = await unwrap(api().postReviewedReceipts(scope));
      setResult(r);
      reload();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Review receipts"
        context={
          list.length === 0
            ? scope === 'all' ? 'All companies · view only' : companyName(scope)
            : `${list.length} ${list.length === 1 ? 'receipt' : 'receipts'} · ${counts.needs_review ?? 0} need review · ${reviewed} reviewed${(counts.processing ?? 0) + (counts.queued ?? 0) > 0 ? ` · ${(counts.processing ?? 0) + (counts.queued ?? 0)} being read` : ''}`
        }
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate('/expenses')}>Back to expenses</Button>
            <Button variant="secondary" icon={<CircleCheck size={16} aria-hidden="true" />} disabled={reviewed === 0 || busy} onClick={() => void saveAll()}>
              Save all reviewed{reviewed ? ` (${reviewed})` : ''}
            </Button>
            <Button variant="primary" icon={<Plus size={16} aria-hidden="true" />} onClick={() => setImporting(true)}>Add receipts</Button>
          </>
        }
      />
      <div className="page-body page-body--wide">
        {error && <ErrorState title="Could not load receipts" action={<Button onClick={reload}>Try again</Button>}>{error}</ErrorState>}
        {!error && drafts && list.length === 0 && (
          <div className="panel">
            <EmptyState title="No receipts to review" action={<Button variant="primary" onClick={() => setImporting(true)}>Add receipts</Button>}>
              Add photos or PDFs of receipts. Gable reads them on this computer and suggests the vendor, date and total for you to check. Entering an expense by hand never needs a receipt.
            </EmptyState>
          </div>
        )}
        {list.length > 0 && selected && (
          <ReviewWorkspace key={selected.id} list={list} selected={selected} onSelect={setSelectedId} onNext={next} reloadList={reload} />
        )}
      </div>

      <ReceiptImport open={importing} onClose={() => setImporting(false)} presetPropertyId={presetProperty} onImported={(n) => { reload(); if (n > 0) toast(`${n} ${n === 1 ? 'receipt' : 'receipts'} added. Reading started.`); }} />

      <Dialog open={result !== null} title="Saved reviewed receipts" onClose={() => setResult(null)} actions={<Button variant="primary" onClick={() => setResult(null)} autoFocus>Done</Button>}>
        {result && (
          <>
            <p><strong>{result.saved.length}</strong> saved as expenses{result.failed.length > 0 && <>, <strong>{result.failed.length}</strong> could not be saved</>}. {result.skipped > 0 && <>{result.skipped} not yet reviewed {result.skipped === 1 ? 'was' : 'were'} left in the queue.</>}</p>
            {result.failed.length > 0 && (
              <Notice tone="danger">
                <strong>Not saved. Fix these and save again; nothing was duplicated.</strong>
                <ul className="problem-list">{result.failed.map((f) => <li key={f.draftId}>{f.name}: {f.message}</li>)}</ul>
              </Notice>
            )}
          </>
        )}
      </Dialog>
    </>
  );
}

function ReviewWorkspace({ list, selected, onSelect, onNext, reloadList }: { list: ReceiptDraft[]; selected: ReceiptDraft; onSelect: (id: number) => void; onNext: (id: number) => void; reloadList: () => void }) {
  const [pane, setPane] = useState<'preview' | 'details'>('details');
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [rot, setRot] = useState(0);
  const select = (id: number) => { onSelect(id); setPage(1); setZoom(1); setRot(0); };

  const { data: preview, error: previewError, loading: previewLoading } = useLoad(
    () => unwrap(api().previewReceipt(selected.id, page)),
    [selected.id, page, selected.files.map((f) => f.id).join(',')],
  );
  const pages = preview?.pageCount ?? selected.pageCount;

  return (
    <div className="review-wrap">
      <div className="review">
        <nav className="review__queue panel panel--flush" aria-label="Receipt queue">
          <ul>
            {list.map((d) => (
              <li key={d.id}>
                <button className="queue-item" aria-current={d.id === selected.id ? 'true' : undefined} onClick={() => select(d.id)}>
                  <span className="queue-item__file">{titleOf(d)}</span>
                  <span className="queue-item__meta muted num">
                    {d.vendor ? `${d.vendor}${d.totalCents ? ` · ${formatCents(d.totalCents)}` : ''}` : 'No details yet'}
                    {d.pageCount > 1 ? ` · ${d.pageCount} pages` : ''}
                  </span>
                  <Badge tone={TONE[d.status]} small>
                    {d.status === 'processing' && d.progress && d.progress.pages > 1 ? `Reading page ${Math.max(1, d.progress.page)} of ${d.progress.pages}` : LABEL[d.status]}
                  </Badge>
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
            {pages > 1 && (
              <>
                <span className="toolbar__sep" />
                <Button size="sm" variant="ghost" iconOnly aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} icon={<ChevronLeft size={16} aria-hidden="true" />} />
                <span className="toolbar__value num" aria-live="polite">Page {page} of {pages}</span>
                <Button size="sm" variant="ghost" iconOnly aria-label="Next page" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} icon={<ChevronRight size={16} aria-hidden="true" />} />
              </>
            )}
            <span className="toolbar__file muted">{titleOf(selected)}</span>
          </div>
          <div className="preview-stage" tabIndex={0} aria-label={`Preview of ${titleOf(selected)}. Scroll to pan.`}>
            {previewError ? <p className="muted pad">The preview could not be shown. You can still enter the details by hand.</p>
              : previewLoading && !preview ? <p className="muted pad">Loading preview…</p>
              : preview && <img className="receipt-img" src={preview.dataUrl} alt={`Receipt page ${page}`} style={{ transform: `rotate(${rot}deg) scale(${zoom})` }} />}
          </div>
        </section>

        <DetailPane key={`${selected.id}:${selected.status === 'processing' || selected.status === 'queued' ? 'busy' : 'idle'}:${selected.ocrConfidence}:${selected.suggestion ? 1 : 0}`}
          draftId={selected.id} active={pane === 'details'} onNext={onNext} reloadList={reloadList} />
      </div>
    </div>
  );
}

function DetailPane({ draftId, active, onNext, reloadList }: { draftId: number; active: boolean; onNext: (id: number) => void; reloadList: () => void }) {
  const { data: draft, error, reload } = useLoad(() => unwrap(api().getReceipt(draftId)), [draftId]);
  if (error) return <section className={`review__form panel${active ? ' is-active' : ''}`}><ErrorState title="Could not open this receipt">{error}</ErrorState></section>;
  if (!draft) return <section className={`review__form panel${active ? ' is-active' : ''}`} aria-busy="true" />;
  return <DraftForm draft={draft} active={active} onNext={onNext} reload={() => { reload(); reloadList(); }} />;
}

function DraftForm({ draft, active, onNext, reload }: { draft: ReceiptDraftDetail; active: boolean; onNext: (id: number) => void; reload: () => void }) {
  const toast = useToast();
  const { data: cats } = useLoad(() => unwrap(api().listCategories(draft.companyId, false)), [draft.companyId]);
  const { data: props } = useLoad(() => unwrap(api().listProperties({ scope: draft.companyId, pageSize: 100, sort: 'address' })), [draft.companyId]);
  const { data: vendorNames } = useLoad(() => unwrap(api().suggestVendors(draft.companyId, '')), [draft.companyId]);

  const [vendor, setVendor] = useState(draft.vendor);
  const [date, setDate] = useState(draft.expenseDate ? formatUsDate(draft.expenseDate) : '');
  const [total, setTotal] = useState(draft.totalCents !== null ? inputMoney(draft.totalCents) : '');
  const [categoryId, setCategoryId] = useState(draft.categoryId ? String(draft.categoryId) : '');
  const [split, setSplit] = useState(draft.split);
  const [lines, setLines] = useState<{ category: string; amount: string }[]>(draft.allocations.map((a) => ({ category: String(a.categoryId), amount: inputMoney(a.amountCents) })));
  const [propertyId, setPropertyId] = useState(draft.propertyId ? String(draft.propertyId) : '');
  const [notes, setNotes] = useState(draft.notes);
  const [remember, setRemember] = useState(draft.rememberVendor);
  const [override, setOverride] = useState(draft.duplicateOverride);
  const [edited, setEdited] = useState<Set<string>>(new Set(draft.touched));
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmRetry, setConfirmRetry] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const status = draft.status;
  const busy = status === 'processing' || status === 'queued';
  const editable = !busy && status !== 'saved' && status !== 'skipped';
  const catList = cats ?? [];
  const nameById = new Map(catList.map((c) => [String(c.id), c.name]));
  const idByName = new Map(catList.map((c) => [c.name, String(c.id)]));

  const totalParsed = parseCurrency(total);
  const totalCents = totalParsed.ok ? totalParsed.cents : null;
  const dateParsed = parseUsDate(date);
  const allocLines: AllocLine[] = lines.map((l) => ({ category: nameById.get(l.category) ?? '', amount: l.amount }));
  const allocV = split ? validateAllocations(allocLines, totalCents) : { lines: {}, total: null };
  const errors = {
    vendor: vendor.trim() ? null : 'Enter the vendor.',
    date: dateParsed.ok ? null : dateParsed.message,
    total: totalParsed.ok ? null : totalParsed.message,
    category: split || categoryId ? null : 'Choose a category.',
  };
  const splitBad = split && (Object.keys(allocV.lines).length > 0 || allocV.total !== null);
  const invalid = Object.values(errors).some(Boolean) || splitBad;
  const shown = (k: keyof typeof errors) => (showErrors ? (errors[k] ?? serverErrors[k === 'date' ? 'expenseDate' : k === 'total' ? 'totalCents' : k] ?? null) : null);

  const mark = (field: string, hasValue: boolean): React.ReactNode => {
    if (!draft.suggestion || !hasValue) return null;
    if (edited.has(field)) return <Badge tone="info" small>Edited by you</Badge>;
    return <Badge tone="review" small>Needs review</Badge>;
  };

  /** Writes the current form to the draft. Invalid text is not sent; it stays on screen for the person to fix. */
  const patchFromState = (): DraftPatch => {
    const p: DraftPatch = { vendor, notes, propertyId: propertyId ? Number(propertyId) : null, rememberVendor: remember, duplicateOverride: override, split };
    if (dateParsed.ok) p.expenseDate = dateParsed.iso; else if (date.trim() === '') p.expenseDate = null;
    if (totalCents !== null) p.totalCents = totalCents; else if (total.trim() === '') p.totalCents = null;
    p.categoryId = !split && categoryId ? Number(categoryId) : null;
    if (split) {
      p.allocations = lines.filter((l) => l.category && parseCurrency(l.amount).ok).map((l) => ({ categoryId: Number(l.category), amountCents: (parseCurrency(l.amount) as { cents: number }).cents }));
    }
    return p;
  };

  const persist = async (extra: DraftPatch = {}) => {
    try {
      await unwrap(api().updateReceipt(draft.id, { ...patchFromState(), ...extra }));
      reload();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const touch = (...f: string[]) => setEdited((s) => new Set([...s, ...f]));

  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setSaving(true);
    setFormError(null);
    setServerErrors({});
    try {
      await fn();
      after?.();
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) setServerErrors(e.fields);
      setFormError(errorMessage(e));
      setShowErrors(true);
      requestAnimationFrame(() => document.querySelector<HTMLElement>('.review__form [aria-invalid="true"]')?.focus());
    } finally {
      setSaving(false);
    }
  };

  const save = () => {
    setShowErrors(true);
    if (invalid) { requestAnimationFrame(() => document.querySelector<HTMLElement>('.review__form [aria-invalid="true"]')?.focus()); return; }
    void run(async () => {
      await unwrap(api().updateReceipt(draft.id, patchFromState()));
      const e = await unwrap(api().postReceipt(draft.id));
      toast(`Saved: ${e.vendorName} ${formatCents(e.totalCents)}.`);
    }, () => { reload(); onNext(draft.id); });
  };

  const markReviewed = (on: boolean) => {
    setShowErrors(true);
    if (on && invalid) return;
    void run(async () => {
      await unwrap(api().updateReceipt(draft.id, patchFromState()));
      await unwrap(api().markReceiptReviewed(draft.id, on));
    }, () => { reload(); if (on) onNext(draft.id); });
  };

  const catSuggestion = draft.suggestion?.category;
  const categoryHint = catSuggestion && categoryId === String(catSuggestion.categoryId) && !edited.has('category') ? catSuggestion.detail : undefined;

  const vendorOptions = (vendorNames ?? []).map((v) => ({ value: v, label: v }));
  const categoryOptions = catList.map((c) => ({ value: String(c.id), label: c.name }));
  const propertyOptions = [{ value: '', label: 'General company expense' }, ...(props?.rows ?? []).map((p) => ({ value: String(p.id), label: p.address1 }))];
  const totalSug = draft.suggestion?.total;
  const dateSug = draft.suggestion?.date;
  const unconfirmedAmounts = totalSug?.ambiguous && !edited.has('totalCents') ? totalSug.candidates : [];

  return (
    <section id="pane-details" role="tabpanel" aria-labelledby="tab-details" className={`review__form panel${active ? ' is-active' : ''}`} aria-label="Receipt details">
      <div className="review__form-head">
        <h2 className="panel__title">Details</h2>
        <Badge tone={TONE[status]}>{status === 'processing' && draft.progress && draft.progress.pages > 1 ? `Reading page ${Math.max(1, draft.progress.page)} of ${draft.progress.pages}` : LABEL[status]}</Badge>
      </div>
      <p className="muted">{draft.companyName}{draft.propertyAddress ? ` · ${draft.propertyAddress}` : ' · General company expense'}</p>

      {busy && <Notice>Reading this receipt on your computer. You can keep working; it will be ready to review shortly.</Notice>}
      {status === 'failed' && draft.errorMessage && <Notice tone="danger">{draft.errorMessage}</Notice>}
      {status === 'needs_review' && draft.errorMessage && <Notice tone="preview">{draft.errorMessage}</Notice>}
      {draft.ocrNotes.map((n) => <Notice key={n} tone="preview">{n}</Notice>)}
      {formError && <Notice tone="danger">{formError}</Notice>}
      {draft.duplicates.length > 0 && status !== 'saved' && (
        <Notice tone="danger">
          <strong>Possible duplicate.</strong>
          <ul className="problem-list">{draft.duplicates.map((d, i) => <li key={i}>{d.message}</li>)}</ul>
          <label className="check check--inline">
            <input type="checkbox" checked={override} disabled={!editable} aria-invalid={showErrors && serverErrors.duplicateOverride ? true : undefined}
              onChange={(e) => { setOverride(e.target.checked); void persist({ duplicateOverride: e.target.checked }); }} />
            <span>This is a different purchase</span>
          </label>
        </Notice>
      )}
      {unconfirmedAmounts.length > 1 && (
        <Notice tone="preview">
          <span>More than one amount looks like the total. Check the receipt and choose the right one:</span>
          <span className="chips">
            {unconfirmedAmounts.map((c) => (
              <button key={c} type="button" className="chip" disabled={!editable} onClick={() => { setTotal(inputMoney(c)); touch('totalCents'); void persist({ totalCents: c }); }}>Use {formatCents(c)}</button>
            ))}
          </span>
        </Notice>
      )}
      {totalSug && !totalSug.labeled && !edited.has('totalCents') && <Notice tone="preview">No line was labeled as the total. The amount shown is the largest one found. Please check it.</Notice>}

      <fieldset className="fieldset" disabled={!editable || saving}>
        <legend className="sr-only">Expense details</legend>
        <Combobox label="Vendor" required freeText options={vendorOptions} value={vendor} onChange={(v) => { setVendor(v); touch('vendor'); }} onBlur={() => void persist()}
          badge={mark('vendor', Boolean(vendor))} error={shown('vendor')} />
        {draft.suggestion?.vendor && draft.suggestion.vendor.candidates.length > 1 && !edited.has('vendor') && (
          <p className="muted small">Other lines near the top: {draft.suggestion.vendor.candidates.filter((c) => c !== vendor).slice(0, 3).join(' · ')}</p>
        )}
        <div className="form-grid">
          <DateField label="Expense date" required value={date} onChange={(t) => { setDate(t); touch('expenseDate'); }} onBlur={() => void persist()} badge={mark('expenseDate', Boolean(date))} error={shown('date')} hint="" />
          <CurrencyField label="Total" required value={total} onChange={(t) => { setTotal(t); touch('totalCents'); }} onBlur={() => void persist()} badge={mark('totalCents', Boolean(total))} error={shown('total')} />
        </div>
        {dateSug?.ambiguous && !edited.has('expenseDate') && (
          <p className="muted small">Other dates found: {dateSug.candidates.filter((d) => d !== (dateParsed.ok ? dateParsed.iso : '')).map((d) => (
            <button key={d} type="button" className="chip chip--inline" onClick={() => { setDate(formatUsDate(d)); touch('expenseDate'); void persist({ expenseDate: d }); }}>{formatUsDate(d)}</button>
          ))}</p>
        )}
        {!split ? (
          <Combobox label="Category" required options={categoryOptions} value={categoryId} onChange={(c) => { setCategoryId(c); touch('category'); void persist({ categoryId: c ? Number(c) : null }); }}
            badge={catSuggestion && categoryId === String(catSuggestion.categoryId) ? mark('category', true) : edited.has('category') && categoryId ? <Badge tone="info" small>Edited by you</Badge> : null}
            error={shown('category')} hint={categoryHint} placeholder="Select category" />
        ) : (
          <AllocationEditor lines={allocLines} onChange={(next) => { setLines(next.map((l) => ({ category: idByName.get(l.category) ?? '', amount: l.amount }))); touch('category'); }}
            categories={catList.map((c) => c.name)} totalCents={totalCents} showErrors={showErrors} />
        )}
        <label className="check">
          <input type="checkbox" checked={split} onChange={(e) => {
            const on = e.target.checked;
            setSplit(on); touch('category');
            const first = [{ category: categoryId, amount: totalCents !== null ? inputMoney(totalCents) : '' }, { category: '', amount: '' }];
            setLines(on ? first : []);
            void persist({ split: on, categoryId: on ? null : (categoryId ? Number(categoryId) : null), allocations: on ? first.filter((l) => l.category).map((l) => ({ categoryId: Number(l.category), amountCents: totalCents ?? 1 })) : [] });
          }} />
          <span>Split across several categories</span>
        </label>
        {split && totalCents !== null && <p className="muted num">Total {formatCents(totalCents)} · assigned {formatCents(allocatedCents(allocLines))}</p>}
        {split && (serverErrors.allocations || (showErrors && allocV.total)) && <p className="field__error" role="alert">{serverErrors.allocations ?? allocV.total}</p>}
        <SelectField label="Asset" optional value={propertyId} onChange={(e) => { setPropertyId(e.target.value); void persist({ propertyId: e.target.value ? Number(e.target.value) : null }); }}>
          {propertyOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </SelectField>
        {!split && vendor.trim() && categoryId && (
          <label className="check">
            <input type="checkbox" checked={remember} onChange={(e) => { setRemember(e.target.checked); void persist({ rememberVendor: e.target.checked }); }} />
            <span>Remember this vendor’s category for {draft.companyName}</span>
          </label>
        )}
        <Disclosure summary="Notes" defaultOpen={Boolean(notes)}>
          <TextAreaField label="Notes" optional value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => void persist()} />
        </Disclosure>
      </fieldset>

      {draft.ocrText && (
        <Disclosure summary="Recognized text">
          <p className="muted small">What the reader found, as plain text. {draft.ocrConfidence !== null ? `Reading confidence ${draft.ocrConfidence}%, which does not prove any value is right.` : ''}</p>
          <pre className="ocr-text">{draft.ocrText}</pre>
        </Disclosure>
      )}

      <div className="review__actions">
        {busy ? (
          <Button variant="secondary" icon={<Square size={14} aria-hidden="true" />} onClick={() => void run(async () => { await unwrap(api().cancelReceipt(draft.id)); }, reload)}>Stop reading</Button>
        ) : (
          <>
            <Button variant="ghost" icon={<Trash2 size={16} aria-hidden="true" />} onClick={() => setConfirmRemove(true)} aria-label="Remove this receipt from the queue">Remove</Button>
            {status !== 'skipped' && <Button variant="ghost" icon={<RefreshCw size={16} aria-hidden="true" />} onClick={() => (edited.size > 0 ? setConfirmRetry(true) : void run(async () => { await unwrap(api().retryReceipt(draft.id, false)); }, reload))}>Try reading again</Button>}
            {status === 'skipped'
              ? <Button variant="secondary" icon={<Undo2 size={16} aria-hidden="true" />} onClick={() => void run(async () => { await unwrap(api().unskipReceipt(draft.id)); }, reload)}>Bring back</Button>
              : <Button variant="ghost" icon={<SkipForward size={16} aria-hidden="true" />} onClick={() => void run(async () => { await unwrap(api().skipReceipt(draft.id)); }, () => { reload(); onNext(draft.id); })}>Skip</Button>}
          </>
        )}
        <Button variant="ghost" icon={<ArrowRight size={16} aria-hidden="true" />} onClick={() => onNext(draft.id)}>Next receipt</Button>
        {status === 'reviewed'
          ? <Button variant="secondary" onClick={() => markReviewed(false)} disabled={saving}>Undo reviewed</Button>
          : <Button variant="secondary" onClick={() => markReviewed(true)} disabled={!editable || saving}>Mark reviewed</Button>}
        <Button variant="primary" onClick={save} disabled={!editable || saving}>{saving ? 'Saving…' : 'Save expense'}</Button>
      </div>
      {showErrors && invalid && <p className="field__error" role="alert">Fix the highlighted fields to save this receipt.</p>}

      <Dialog open={confirmRetry} title="Read this receipt again?" onClose={() => setConfirmRetry(false)}
        actions={<>
          <Button variant="secondary" onClick={() => setConfirmRetry(false)} autoFocus>Cancel</Button>
          <Button variant="secondary" onClick={() => { setConfirmRetry(false); void run(async () => { await unwrap(api().retryReceipt(draft.id, false)); }, reload); }}>Keep my edits</Button>
          <Button variant="danger" onClick={() => { setConfirmRetry(false); void run(async () => { await unwrap(api().retryReceipt(draft.id, true)); }, reload); }}>Replace my edits</Button>
        </>}>
        <p>You have corrected some fields. “Keep my edits” fills in only the fields you have not touched. “Replace my edits” starts over from what the reader finds.</p>
      </Dialog>
      <Dialog open={confirmRemove} title="Remove this receipt?" onClose={() => setConfirmRemove(false)}
        actions={<><Button variant="secondary" onClick={() => setConfirmRemove(false)} autoFocus>Cancel</Button>
          <Button variant="danger" onClick={() => { setConfirmRemove(false); void run(async () => { await unwrap(api().removeReceipt(draft.id)); }, () => { reload(); onNext(draft.id); }); }}>Remove receipt</Button></>}>
        <p>The receipt and its stored copy are removed from the queue. This does not affect any saved expense.</p>
      </Dialog>
    </section>
  );
}

