import { useEffect, useMemo, useRef, useState } from 'react';
import { Ban, FileText, History, Paperclip, RotateCcw } from 'lucide-react';
import { Badge, Button, Combobox, CurrencyField, DateField, Dialog, Disclosure, ErrorState, Notice, SelectField, TextAreaField, useToast } from '../components';
import { ReceiptDropZone, type PickedFile } from '../components/ReceiptDropZone';
import { AllocationEditor, allocatedCents, validateAllocations, type AllocLine } from '../components/AllocationEditor';
import { PageHeader } from '../shell/Shell';
import { useApp } from '../shell/AppContext';
import { ApiError, api, errorMessage, unwrap, useDebounced, useLoad } from '../api';
import { formatCents, parseCurrency } from '../../shared/money';

const inputMoney = (c: number) => formatCents(c, { symbol: false });
import { formatUsDate, parseUsDate, todayIso } from '../../shared/dates';
import type { Category, ExpenseDetail, Property } from '../../shared/types';

/** Create when no id is given; edit when `?id=` is present. */
export function ExpenseEntryPage() {
  const { route, navigate } = useApp();
  const pid = Number(route.query.get('property')) || 0;
  const eid = Number(route.query.get('id')) || 0;
  const { data, error, loading } = useLoad(async () => {
    const expense = eid ? await unwrap(api().getExpense(eid)) : null;
    const propertyId = expense?.propertyId ?? pid;
    const property = propertyId ? await unwrap(api().getProperty(propertyId)) : null;
    return { expense, property };
  }, [pid, eid]);
  if (loading) return null;
  const blocked = !eid && data?.property && (data.property.isArchived || data.property.companyArchived);
  if (error || !data || blocked) {
    return (
      <div className="page-body">
        <ErrorState title="Cannot open this expense" action={<Button onClick={() => navigate('/expenses')}>Back to expenses</Button>}>
          {error ?? 'This property or its company is archived. Restore it before adding expenses.'}
        </ErrorState>
      </div>
    );
  }
  return <ExpenseForm key={`${eid}-${pid}`} preset={data.property ?? undefined} expense={data.expense ?? undefined} />;
}

const newKey = () => crypto.randomUUID();

function ExpenseForm({ preset, expense }: { preset?: Property; expense?: ExpenseDetail }) {
  const { navigate, scope, setDirty, companyName, companies, route } = useApp();
  const toast = useToast();
  const editing = Boolean(expense);
  const returnTo = route.query.get('return');

  // Ownership is decided when the form opens and never follows later company switches.
  const [companyId, setCompanyId] = useState<number>(expense?.companyId ?? preset?.companyId ?? (scope === 'all' ? 0 : scope));
  const lockedCompany = editing || Boolean(preset) || scope !== 'all';
  const [propertyId, setPropertyId] = useState<string>(expense?.propertyId ? String(expense.propertyId) : preset ? String(preset.id) : '');
  const [vendor, setVendor] = useState(expense?.vendorName ?? '');
  const [date, setDate] = useState(expense ? formatUsDate(expense.expenseDate) : formatUsDate(todayIso()));
  const [categoryId, setCategoryId] = useState<string>(expense && expense.allocations.length === 1 ? String(expense.allocations[0]!.categoryId) : '');
  const [amount, setAmount] = useState(expense ? inputMoney(expense.totalCents) : '');
  const [notes, setNotes] = useState(expense?.notes ?? '');
  const [split, setSplit] = useState(Boolean(expense && expense.allocations.length > 1));
  const [lines, setLines] = useState<AllocLine[]>(
    expense && expense.allocations.length > 1 ? expense.allocations.map((a) => ({ category: String(a.categoryId), amount: inputMoney(a.amountCents) })) : [],
  );
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [key, setKey] = useState(newKey);
  const vendorRef = useRef<HTMLInputElement>(null);
  const voided = expense?.status === 'voided';

  const initial = useMemo(() => JSON.stringify({ propertyId, vendor, date, categoryId, amount, notes, split, lines }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify({ propertyId, vendor, date, categoryId, amount, notes, split, lines }) !== (editing ? initial : JSON.stringify({ propertyId: preset ? String(preset.id) : '', vendor: '', date, categoryId: '', amount: '', notes: '', split: false, lines: [] })) || files.length > 0 || removed.size > 0;
  useEffect(() => {
    setDirty(dirty);
    return () => setDirty(false);
  }, [dirty, setDirty]);

  const { data: cats } = useLoad(() => (companyId ? unwrap(api().listCategories(companyId, editing)) : Promise.resolve([] as Category[])), [companyId, editing]);
  const { data: props } = useLoad(
    () => (companyId ? unwrap(api().listProperties({ scope: companyId, pageSize: 100, sort: 'address' })) : Promise.resolve(null)),
    [companyId],
  );
  const vendorQuery = useDebounced(vendor, 150);
  const { data: vendorNames } = useLoad(() => (companyId ? unwrap(api().suggestVendors(companyId, vendorQuery)) : Promise.resolve([] as string[])), [companyId, vendorQuery]);

  const usable = (cats ?? []).filter((c) => !c.isArchived || expense?.allocations.some((a) => a.categoryId === c.id));
  const categoryOptions = usable.map((c) => ({ value: String(c.id), label: c.isArchived ? `${c.name} (archived)` : c.name }));
  const lineCategories = usable.map((c) => c.name);
  const idByName = new Map(usable.map((c) => [c.name, c.id]));
  const nameById = new Map(usable.map((c) => [String(c.id), c.name]));
  const propertyOptions = [
    { value: '', label: 'General company expense (no property)' },
    ...(props?.rows ?? []).map((p) => ({ value: String(p.id), label: p.address1, detail: `${p.city} ${p.zip}` })),
  ];
  if (expense?.propertyId && !propertyOptions.some((o) => o.value === String(expense.propertyId))) {
    propertyOptions.push({ value: String(expense.propertyId), label: expense.propertyAddress ?? 'Property', detail: 'archived' });
  }
  const vendorOptions = (vendorNames ?? []).map((v) => ({ value: v, label: v }));

  const amountParsed = parseCurrency(amount);
  const totalCents = amountParsed.ok ? amountParsed.cents : null;
  const dateParsed = parseUsDate(date);
  const errors: Record<string, string | undefined> = {};
  if (!companyId) errors.company = 'Choose which company this expense belongs to.';
  if (vendor.trim() === '') errors.vendor = 'Enter the vendor or payee.';
  if (!dateParsed.ok) errors.date = dateParsed.message;
  if (!amountParsed.ok) errors.amount = amountParsed.message;
  if (!split && !categoryId) errors.category = 'Choose a category.';
  const allocLines: AllocLine[] = lines.map((l) => ({ category: nameById.get(l.category) ?? '', amount: l.amount }));
  const allocErrors = split ? validateAllocations(allocLines, totalCents) : { lines: {}, total: null };
  const allocInvalid = split && (Object.keys(allocErrors.lines).length > 0 || allocErrors.total !== null || totalCents === null);
  const invalid = Object.keys(errors).filter((k) => !(split && k === 'category')).length > 0 || allocInvalid;
  const shown = (field: string, local?: string): string | null => (showErrors ? (local ?? serverErrors[field] ?? null) : (serverErrors[field] ?? null));

  const toggleSplit = (on: boolean) => {
    setSplit(on);
    if (on) setLines([{ category: categoryId, amount: totalCents !== null ? formatCents(totalCents, { symbol: false }) : '' }, { category: '', amount: '' }]);
    else {
      setCategoryId(lines[0]?.category ?? categoryId);
      setLines([]);
    }
  };

  const reset = () => {
    setVendor(''); setCategoryId(''); setAmount(''); setNotes(''); setFiles([]); setSplit(false); setLines([]);
    setShowErrors(false); setServerErrors({}); setFormError(null); setKey(newKey());
  };

  const save = async (addAnother: boolean) => {
    if (saving) return;
    setShowErrors(true);
    setServerErrors({});
    setFormError(null);
    if (invalid || !dateParsed.ok || !amountParsed.ok) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setSaving(true);
    try {
      const stagedFileIds: string[] = [];
      for (const f of files) {
        const buf = new Uint8Array(await f.file.arrayBuffer());
        stagedFileIds.push((await unwrap(api().stageReceiptFile(f.name, buf))).stagedId);
      }
      const allocations = split
        ? lines.map((l) => ({ categoryId: Number(l.category), amountCents: (parseCurrency(l.amount) as { cents: number }).cents }))
        : [{ categoryId: Number(categoryId), amountCents: amountParsed.cents }];
      const common = {
        propertyId: propertyId ? Number(propertyId) : null, vendorName: vendor.trim(), expenseDate: dateParsed.iso,
        totalCents: amountParsed.cents, allocations, notes, stagedFileIds,
      };
      if (expense) {
        await unwrap(api().updateExpense(expense.id, { ...common, removeAttachmentIds: [...removed] }));
        toast('Expense saved.');
      } else {
        await unwrap(api().createExpense({ ...common, companyId, idempotencyKey: key }));
        toast(`Expense added: ${vendor.trim()} ${formatCents(amountParsed.cents)}.`);
      }
      setDirty(false);
      if (addAnother && !editing) {
        reset();
        requestAnimationFrame(() => vendorRef.current?.focus());
      } else {
        navigate(returnTo ?? (preset ? `/properties/view?id=${preset.id}` : '/expenses'));
      }
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) {
        setServerErrors(err.fields);
        setFormError(err.message);
      } else setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleVoid = async () => {
    if (!expense) return;
    try {
      await unwrap(voided ? api().unvoidExpense(expense.id) : api().voidExpense(expense.id));
      toast(voided ? 'Expense restored. It counts in totals again.' : 'Expense voided. It no longer counts in any total.');
      setConfirmVoid(false);
      setDirty(false);
      navigate(returnTo ?? '/expenses');
    } catch (err) {
      toast(errorMessage(err), 'error');
      setConfirmVoid(false);
    }
  };

  const remaining = split && totalCents !== null ? totalCents - allocatedCents(allocLines) : null;
  const title = editing ? (voided ? 'Voided expense' : 'Edit expense') : 'Add expense';
  const owner = companyId ? companyName(companyId) : '';

  return (
    <>
      <PageHeader
        title={title}
        context={companyId ? <>For {owner}{preset ? <> · {preset.address1}</> : expense?.propertyAddress ? <> · {expense.propertyAddress}</> : null}</> : 'Choose a company to begin'}
        actions={
          <>
            {editing && (
              <Button variant="secondary" icon={voided ? <RotateCcw size={16} aria-hidden="true" /> : <Ban size={16} aria-hidden="true" />} onClick={() => setConfirmVoid(true)}>
                {voided ? 'Restore expense' : 'Void expense'}
              </Button>
            )}
            <Button variant="ghost" onClick={() => navigate(returnTo ?? (preset ? `/properties/view?id=${preset.id}` : '/expenses'))}>Cancel</Button>
          </>
        }
      />
      <div className="page-body">
        {voided && <Notice tone="danger">This expense is voided and does not count in any total. Restore it to make changes.</Notice>}
        {formError && <Notice tone="danger">{formError}</Notice>}
        <form className="entry" noValidate onSubmit={(e) => { e.preventDefault(); void save(false); }}>
          <fieldset className="entry__main panel fieldset" disabled={voided} aria-label="Expense details">
            <div className="form-grid">
              {lockedCompany ? (
                <div className="field span-2">
                  <span className="field__label">Company</span>
                  <p className="static-value">{owner || '—'}</p>
                </div>
              ) : (
                <SelectField className="span-2" label="Company" required value={companyId || ''} error={shown('company', errors.company)}
                  onChange={(e) => { setCompanyId(Number(e.target.value)); setPropertyId(''); setCategoryId(''); }}
                  hint="Viewing All Companies. Choose which company owns this expense.">
                  <option value="">Choose a company…</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
                </SelectField>
              )}

              <Combobox className="span-2" label="Property" optional options={propertyOptions} value={propertyId} onChange={setPropertyId}
                disabled={!companyId} placeholder="General company expense (no property)" error={shown('propertyId')}
                hint="Leave blank for overhead that does not belong to one property." />

              <Combobox className="span-2" label="Vendor" required freeText options={vendorOptions} value={vendor} onChange={setVendor}
                inputRef={vendorRef} error={shown('vendorName', errors.vendor)} placeholder="Who was paid?" emptyText="New vendor. Press Tab to keep what you typed." />

              <DateField label="Expense date" required value={date} onChange={setDate} error={shown('expenseDate', errors.date)} hint="The date of the expense decides which year it counts in." />
              <CurrencyField label="Amount" required value={amount} onChange={setAmount} error={shown('totalCents', errors.amount)} />

              {!split && (
                <Combobox className="span-2" label="Category" required options={categoryOptions} value={categoryId} onChange={setCategoryId}
                  error={shown('allocations', errors.category)} placeholder="Choose a category" />
              )}
            </div>

            <div className="split-toggle">
              <label className="check">
                <input type="checkbox" checked={split} onChange={(e) => toggleSplit(e.target.checked)} />
                <span>Split across several categories</span>
              </label>
              {split && (
                <AllocationEditor
                  lines={lines.map((l) => ({ category: nameById.get(l.category) ?? '', amount: l.amount }))}
                  onChange={(next) => setLines(next.map((l) => ({ category: String(idByName.get(l.category) ?? ''), amount: l.amount })))}
                  categories={lineCategories} totalCents={totalCents} showErrors={showErrors} />
              )}
              {split && serverErrors.allocations && <p className="field__error" role="alert">{serverErrors.allocations}</p>}
            </div>

            <Disclosure summary="More details" defaultOpen={Boolean(notes)}>
              <TextAreaField label="Notes" optional value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything worth remembering about this expense" />
            </Disclosure>
          </fieldset>

          <aside className="panel entry__side" aria-label="Receipts">
            <h2 className="panel__title"><Paperclip size={16} aria-hidden="true" /> Receipts</h2>
            <p className="muted">Attach one or more pages. Several pages of one invoice belong to a single expense.</p>
            {editing && expense!.attachments.length > 0 && (
              <ul className="files" aria-label="Saved receipts">
                {expense!.attachments.map((a) => (
                  <li key={a.id} className="files__item">
                    <FileText size={18} aria-hidden="true" />
                    <span className={`files__name${removed.has(a.id) ? ' is-removed' : ''}`}>{a.originalName}</span>
                    {removed.has(a.id) ? (
                      <Button variant="ghost" size="sm" onClick={() => setRemoved((r) => { const n = new Set(r); n.delete(a.id); return n; })}>Undo</Button>
                    ) : (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => void unwrap(api().openReceipt(a.id)).catch((e) => toast(errorMessage(e), 'error'))} aria-label={`Open ${a.originalName}`}>Open</Button>
                        <Button variant="ghost" size="sm" disabled={voided} onClick={() => setRemoved((r) => new Set(r).add(a.id))} aria-label={`Remove ${a.originalName}`}>Remove</Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {!voided && <ReceiptDropZone files={files} onChange={setFiles} note="A private copy is stored with Gable." />}
          </aside>

          {!voided && (
            <div className="entry__actions">
              <div aria-live="polite" className="entry__status muted">
                {showErrors && invalid ? 'Some fields need attention. Your entries are kept.' : remaining !== null && remaining !== 0 ? 'Assign the rest of the amount to finish the split.' : ''}
              </div>
              {!editing && <Button variant="secondary" onClick={() => void save(true)} disabled={saving}>Save &amp; add another</Button>}
              <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Save expense'}</Button>
            </div>
          )}
        </form>

        {editing && expense!.events.length > 0 && (
          <section className="panel" aria-label="History">
            <h2 className="panel__title"><History size={16} aria-hidden="true" /> History</h2>
            <ol className="history">
              {[...expense!.events].reverse().map((ev) => (
                <li key={ev.id}>
                  <Badge tone={ev.type === 'voided' ? 'danger' : ev.type === 'unvoided' ? 'success' : 'neutral'} small icon={false}>{ev.type === 'edited' ? 'Edited' : ev.type === 'created' ? 'Added' : ev.type === 'voided' ? 'Voided' : 'Restored'}</Badge>
                  <span>{ev.detail || 'Saved with no changes'}</span>
                  <time className="muted num" dateTime={ev.at}>{new Date(ev.at).toLocaleString('en-US')}</time>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>

      <Dialog open={confirmVoid} title={voided ? 'Restore this expense?' : 'Void this expense?'} onClose={() => setConfirmVoid(false)}
        actions={<><Button variant="secondary" onClick={() => setConfirmVoid(false)} autoFocus>Cancel</Button><Button variant={voided ? 'primary' : 'danger'} onClick={() => void toggleVoid()}>{voided ? 'Restore expense' : 'Void expense'}</Button></>}>
        <p>{voided ? 'It will count in totals and reports again.' : 'A voided expense stays on record with its history but no longer counts in any total or report. You can restore it later.'}</p>
      </Dialog>
    </>
  );
}
