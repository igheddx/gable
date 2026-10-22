import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Combobox, CurrencyField, DateField, Disclosure, Notice, SelectField, TextAreaField, useToast } from '../components';
import { ReceiptDropZone, type PickedFile } from '../components/ReceiptDropZone';
import { AllocationEditor, allocatedCents, validateAllocations, type AllocLine } from '../components/AllocationEditor';
import { PageHeader } from '../shell/Shell';
import { useApp } from '../shell/AppContext';
import { CATEGORIES, COMPANIES, PROPERTIES, VENDORS } from '../fixtures';
import { formatCents, parseCurrency } from '../../shared/money';
import { formatUsDate, parseUsDate, todayIso } from '../../shared/dates';

type Errors = Partial<Record<'company' | 'vendor' | 'date' | 'category' | 'amount', string>>;

export function ExpenseEntryPage() {
  const { route, navigate, scope, setDirty, addExpense, companyName } = useApp();
  const toast = useToast();

  const presetProperty = PROPERTIES.find((p) => p.id === route.query.get('property'));
  // Ownership is decided when the form opens and never follows later company switches.
  const [companyId, setCompanyId] = useState<string>(presetProperty?.companyId ?? (scope === 'all' ? '' : scope));
  const lockedCompany = Boolean(presetProperty) || scope !== 'all';
  const [propertyId, setPropertyId] = useState(presetProperty?.id ?? '');
  const [vendor, setVendor] = useState('');
  const [date, setDate] = useState(formatUsDate(todayIso()));
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [split, setSplit] = useState(false);
  const [lines, setLines] = useState<AllocLine[]>([]);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const vendorRef = useRef<HTMLInputElement>(null);
  const firstErrorRef = useRef<HTMLDivElement>(null);

  const dirty = vendor !== '' || category !== '' || amount !== '' || notes !== '' || files.length > 0 || split;
  useEffect(() => {
    setDirty(dirty);
    return () => setDirty(false);
  }, [dirty, setDirty]);

  const propertyOptions = useMemo(
    () => [{ value: '', label: 'General company expense (no property)' }, ...PROPERTIES.filter((p) => p.companyId === companyId).map((p) => ({ value: p.id, label: p.address, detail: `${p.city} ${p.zip}` }))],
    [companyId],
  );
  const vendorOptions = useMemo(() => VENDORS.map((v) => ({ value: v, label: v })), []);
  const categoryOptions = useMemo(() => CATEGORIES.map((c) => ({ value: c, label: c })), []);

  const amountParsed = parseCurrency(amount);
  const totalCents = amountParsed.ok ? amountParsed.cents : null;
  const dateParsed = parseUsDate(date);

  const errors: Errors = {};
  if (!companyId) errors.company = 'Choose which company this expense belongs to.';
  if (vendor.trim() === '') errors.vendor = 'Enter the vendor or payee.';
  if (!dateParsed.ok) errors.date = dateParsed.message;
  if (!amountParsed.ok) errors.amount = amountParsed.message;
  if (!split && !category) errors.category = 'Choose a category.';
  const allocErrors = split ? validateAllocations(lines, totalCents) : { lines: {}, total: null };
  const allocInvalid = split && (Object.keys(allocErrors.lines).length > 0 || allocErrors.total !== null || totalCents === null);
  const invalid = Object.keys(errors).filter((k) => !(split && k === 'category')).length > 0 || allocInvalid;

  const toggleSplit = (on: boolean) => {
    setSplit(on);
    if (on) setLines([{ category, amount: totalCents !== null ? formatCents(totalCents, { symbol: false }) : '' }, { category: '', amount: '' }]);
    else {
      setCategory(lines[0]?.category ?? category);
      setLines([]);
    }
  };

  const reset = (keepContext: boolean) => {
    setVendor(''); setCategory(''); setAmount(''); setNotes(''); setFiles([]); setSplit(false); setLines([]); setShowErrors(false);
    if (!keepContext) { setPropertyId(''); setDate(formatUsDate(todayIso())); }
  };

  const save = (addAnother: boolean) => {
    if (saving) return;
    setShowErrors(true);
    if (invalid || !dateParsed.ok || !amountParsed.ok) {
      // Keep everything the user typed; send focus to the first problem.
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setSaving(true);
    addExpense({
      companyId, propertyId: propertyId || null, vendor: vendor.trim(), date: dateParsed.iso,
      category: split ? `Split: ${lines.map((l) => l.category).join(' + ')}` : category, cents: amountParsed.cents,
    });
    toast(`Expense added: ${vendor.trim()} ${formatCents(amountParsed.cents)} (sample preview, not stored).`);
    setDirty(false);
    if (addAnother) {
      reset(true);
      setSaving(false);
      requestAnimationFrame(() => vendorRef.current?.focus());
    } else {
      navigate('/expenses');
    }
  };

  const remaining = split && totalCents !== null ? totalCents - allocatedCents(lines) : null;

  return (
    <>
      <PageHeader
        title="Add expense"
        context={companyId ? <>For {companyName(companyId)}{presetProperty ? <> · {presetProperty.address}</> : null}</> : 'Choose a company to begin'}
        actions={
          <Button variant="ghost" onClick={() => navigate('/expenses')}>Cancel</Button>
        }
      />
      <div className="page-body">
        <Notice tone="preview">Design preview with fictional sample data. Expenses you add here are kept only until you close Gable and are not saved yet.</Notice>
        <form
          className="entry"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            save(false);
          }}
        >
          <section className="panel entry__main" ref={firstErrorRef} aria-label="Expense details">
            <div className="form-grid">
              {lockedCompany ? (
                <div className="field span-2">
                  <span className="field__label">Company</span>
                  <p className="static-value">{companyId ? companyName(companyId) : '—'}</p>
                </div>
              ) : (
                <SelectField className="span-2" label="Company" required value={companyId} error={showErrors ? errors.company : null}
                  onChange={(e) => { setCompanyId(e.target.value); setPropertyId(''); }}
                  hint="Viewing All Companies. Choose which company owns this expense.">
                  <option value="">Choose a company…</option>
                  {COMPANIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </SelectField>
              )}

              <Combobox className="span-2" label="Property" optional options={propertyOptions} value={propertyId} onChange={setPropertyId}
                disabled={!companyId} placeholder="General company expense (no property)"
                hint="Leave blank for overhead that does not belong to one property." />

              <Combobox className="span-2" label="Vendor" required freeText options={vendorOptions} value={vendor} onChange={setVendor}
                inputRef={vendorRef} error={showErrors ? errors.vendor : null} placeholder="Who was paid?" emptyText="New vendor. Press Tab to keep what you typed." />

              <DateField label="Expense date" required value={date} onChange={setDate} error={showErrors ? errors.date : null} hint="The date of the expense decides which year it counts in." />
              <CurrencyField label="Amount" required value={amount} onChange={setAmount} error={showErrors ? errors.amount : null} />

              {!split && (
                <Combobox className="span-2" label="Category" required options={categoryOptions} value={category} onChange={setCategory}
                  error={showErrors ? errors.category : null} placeholder="Choose a category" />
              )}
            </div>

            <div className="split-toggle">
              <label className="check">
                <input type="checkbox" checked={split} onChange={(e) => toggleSplit(e.target.checked)} />
                <span>Split across several categories</span>
              </label>
              {split && (
                <AllocationEditor lines={lines} onChange={setLines} categories={CATEGORIES} totalCents={totalCents} showErrors={showErrors} />
              )}
            </div>

            <Disclosure summary="More details">
              <TextAreaField label="Notes" optional value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything worth remembering about this expense" />
            </Disclosure>
          </section>

          <aside className="panel entry__side" aria-label="Receipts">
            <h2 className="panel__title">Receipts</h2>
            <p className="muted">Attach one or more pages. Several pages of one invoice belong to a single expense.</p>
            <ReceiptDropZone files={files} onChange={setFiles} note="Preview only: files are not stored yet." />
          </aside>

          <div className="entry__actions">
            <div aria-live="polite" className="entry__status muted">
              {showErrors && invalid ? 'Some fields need attention. Your entries are kept.' : remaining !== null && remaining !== 0 ? 'Assign the rest of the amount to finish the split.' : ''}
            </div>
            <Button variant="secondary" onClick={() => save(true)} disabled={saving}>Save &amp; add another</Button>
            <Button variant="primary" type="submit" disabled={saving}>Save expense</Button>
          </div>
        </form>
      </div>
    </>
  );
}
