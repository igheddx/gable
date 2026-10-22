import { useEffect, useState } from 'react';
import { Button, CurrencyField, DateField, Dialog, Notice, SelectField, TextAreaField, TextField } from '.';
import { ApiError, api, errorMessage, unwrap } from '../api';
import { useApp } from '../shell/AppContext';
import { PROPERTY_STATUSES, type PropertyFields, type PropertyStatus } from '../../shared/schemas';
import type { Property } from '../../shared/types';
import { centsToInput, parseCurrency } from '../../shared/money';
import { formatUsDate, parseUsDate } from '../../shared/dates';

interface Props {
  /** Required when creating. Fixed once the property exists. */
  companyId: number | null;
  property?: Property;
  submitLabel: string;
  onSaved: (p: Property) => void;
  onCancel: () => void;
  cancelLabel?: string;
  /** Lets the first-run flow offer "skip". */
  extraAction?: React.ReactNode;
}

interface FormState {
  address1: string; address2: string; city: string; state: string; zip: string;
  purchaseDate: string; purchasePrice: string; status: PropertyStatus;
  saleDate: string; salePrice: string; description: string; notes: string;
}

const fromProperty = (p?: Property): FormState => ({
  address1: p?.address1 ?? '', address2: p?.address2 ?? '', city: p?.city ?? '', state: p?.state ?? '', zip: p?.zip ?? '',
  purchaseDate: p ? formatUsDate(p.purchaseDate) : '', purchasePrice: p ? centsToInput(p.purchasePriceCents) : '',
  status: p?.status ?? 'Held', saleDate: p?.saleDate ? formatUsDate(p.saleDate) : '',
  salePrice: p?.salePriceCents != null ? centsToInput(p.salePriceCents) : '', description: p?.description ?? '', notes: p?.notes ?? '',
});

export function PropertyForm({ companyId, property, submitLabel, onSaved, onCancel, cancelLabel = 'Cancel', extraAction }: Props) {
  const { setDirty, companyName } = useApp();
  const [v, setV] = useState<FormState>(() => fromProperty(property));
  const [baseline] = useState(() => JSON.stringify(fromProperty(property)));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(v) !== baseline;
  const reopening = property?.status === 'Sold' && v.status !== 'Sold';
  const [confirmReopen, setConfirmReopen] = useState(false);

  useEffect(() => {
    setDirty(dirty);
    return () => setDirty(false);
  }, [dirty, setDirty]);

  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));

  /** Client-side checks mirror the main process so errors appear instantly; the main process is still the authority. */
  const build = (): { fields?: PropertyFields; errors: Record<string, string> } => {
    const e: Record<string, string> = {};
    const pd = parseUsDate(v.purchaseDate);
    const pp = v.purchasePrice.trim() === '' ? null : (v.purchasePrice.trim() === '0' ? { ok: true as const, cents: 0 } : parseCurrency(v.purchasePrice));
    if (v.address1.trim() === '') e.address1 = 'Enter the street address.';
    if (v.city.trim() === '') e.city = 'Enter the city.';
    if (!/^[A-Za-z]{2}$/.test(v.state.trim())) e.state = 'Use the 2-letter state code, like TN.';
    if (!/^\d{5}(-\d{4})?$/.test(v.zip.trim())) e.zip = 'Enter a ZIP code like 37201.';
    if (!pd.ok) e.purchaseDate = pd.message;
    if (pp === null) e.purchasePrice = 'Enter the purchase price.';
    else if (!pp.ok) e.purchasePrice = pp.message;
    let saleDate: string | null = null;
    let salePriceCents: number | null = null;
    if (v.status === 'Sold') {
      const sd = parseUsDate(v.saleDate);
      const sp = v.salePrice.trim() === '0' ? { ok: true as const, cents: 0 } : parseCurrency(v.salePrice);
      if (!sd.ok) e.saleDate = sd.message; else saleDate = sd.iso;
      if (!sp.ok) e.salePrice = sp.message; else salePriceCents = sp.cents;
      if (sd.ok && pd.ok && sd.iso < pd.iso) e.saleDate = 'The sale date cannot be before the purchase date.';
    }
    if (Object.keys(e).length || !pd.ok || !pp || !pp.ok) return { errors: e };
    return {
      errors: e,
      fields: {
        address1: v.address1, address2: v.address2, city: v.city, state: v.state.toUpperCase(), zip: v.zip,
        purchaseDate: pd.iso, purchasePriceCents: pp.cents, status: v.status, saleDate, salePriceCents,
        description: v.description, notes: v.notes,
      },
    };
  };

  const save = async (confirmed: boolean) => {
    if (saving) return;
    const built = build();
    setErrors(built.errors);
    setFormError(null);
    if (!built.fields) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('.property-form [aria-invalid="true"]')?.focus());
      return;
    }
    if (reopening && !confirmed) {
      setConfirmReopen(true);
      return;
    }
    setSaving(true);
    try {
      const saved = await unwrap(
        property ? api().updateProperty(property.id, built.fields, confirmed) : api().createProperty(companyId!, built.fields),
      );
      setDirty(false);
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError && err.fields && Object.keys(err.fields).length) {
        const map: Record<string, string> = { ...err.fields };
        if (map.salePriceCents) map.salePrice = map.salePriceCents;
        if (map.purchasePriceCents) map.purchasePrice = map.purchasePriceCents;
        setErrors(map);
        requestAnimationFrame(() => document.querySelector<HTMLElement>('.property-form [aria-invalid="true"]')?.focus());
      } else setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const owner = property?.companyName ?? (companyId ? companyName(companyId) : '');

  return (
    <form className="property-form stack-form" onSubmit={(e) => { e.preventDefault(); void save(false); }} noValidate>
      {formError && <Notice tone="danger">{formError}</Notice>}
      <div className="field">
        <span className="field__label">Company</span>
        <p className="static-value">{owner}</p>
        {property && <p className="field__hint">A property stays with its company. To track it under another company, archive it and add it there.</p>}
      </div>
      <div className="form-grid">
        <TextField className="span-2" label="Street address" required value={v.address1} onChange={set('address1')} error={errors.address1} autoFocus={!property} maxLength={160} />
        <TextField className="span-2" label="Unit or suite" optional value={v.address2} onChange={set('address2')} maxLength={80} />
        <TextField label="City" required value={v.city} onChange={set('city')} error={errors.city} maxLength={80} />
        <div className="form-grid form-grid--tight">
          <TextField label="State" required value={v.state} onChange={set('state')} error={errors.state} maxLength={2} placeholder="TN" />
          <TextField label="ZIP" required value={v.zip} onChange={set('zip')} error={errors.zip} maxLength={10} inputMode="numeric" />
        </div>
        <DateField label="Purchase date" required value={v.purchaseDate} onChange={(t) => setV((x) => ({ ...x, purchaseDate: t }))} error={errors.purchaseDate} hint="Any date, including years ago." />
        <CurrencyField label="Purchase price" required value={v.purchasePrice} onChange={(t) => setV((x) => ({ ...x, purchasePrice: t }))} error={errors.purchasePrice} />
        <SelectField label="Status" required value={v.status} onChange={set('status')} error={errors.status}>
          {PROPERTY_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </SelectField>
      </div>
      {v.status === 'Sold' && (
        <fieldset className="panel panel--tinted fieldset">
          <legend className="section-title">Sale</legend>
          <div className="form-grid">
            <DateField label="Sale date" required value={v.saleDate} onChange={(t) => setV((x) => ({ ...x, saleDate: t }))} error={errors.saleDate} />
            <CurrencyField label="Gross sale price" required value={v.salePrice} onChange={(t) => setV((x) => ({ ...x, salePrice: t }))} error={errors.salePrice}
              hint="Before commissions and closing costs. Enter those as expenses." />
          </div>
        </fieldset>
      )}
      {reopening && <Notice tone="danger">Changing this property from Sold removes its sale date and sale price. You will be asked to confirm.</Notice>}
      <TextAreaField label="Description" optional value={v.description} onChange={set('description')} maxLength={2000} />
      <TextAreaField label="Notes" optional value={v.notes} onChange={set('notes')} maxLength={5000} />
      <div className="form-actions">
        {extraAction}
        <Button variant="ghost" onClick={onCancel}>{cancelLabel}</Button>
        <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Saving…' : submitLabel}</Button>
      </div>
      <ReopenDialog open={confirmReopen} onCancel={() => setConfirmReopen(false)} onConfirm={() => { setConfirmReopen(false); void save(true); }} />
    </form>
  );
}

function ReopenDialog({ open, onCancel, onConfirm }: { open: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Dialog open={open} title="Reopen this sale?" onClose={onCancel}
      actions={<><Button variant="secondary" onClick={onCancel} autoFocus>Keep it sold</Button><Button variant="danger" onClick={onConfirm}>Remove sale and save</Button></>}>
      <p>The sale date and sale price will be removed and the property will no longer count as sold. Expenses you recorded stay as they are.</p>
    </Dialog>
  );
}
