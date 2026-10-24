import { useEffect, useState } from 'react';
import { Button, CurrencyField, DateField, Dialog, Notice, SelectField, TextAreaField, TextField } from '.';
import { ApiError, api, errorMessage, unwrap } from '../api';
import { useApp } from '../shell/AppContext';
import { type PropertyFields, type PropertyStatus } from '../../shared/schemas';
import { TEMPLATE_INFO, statusLabel, statusesFor, type BusinessType, type Template } from '../../shared/businessTypes';
import type { Property } from '../../shared/types';
import { formatCents, parseCurrency } from '../../shared/money';
import { formatUsDate, parseUsDate } from '../../shared/dates';
import { US_STATE_CODES } from '../../shared/usStates';

const inputMoney = (c: number) => formatCents(c, { symbol: false });

interface Props {
  /** Required when creating. Fixed once the item exists. */
  companyId: number | null;
  /** What kind of item is being created. Omitted means a renovation, and is ignored when editing. */
  businessType?: BusinessType;
  property?: Property;
  submitLabel: string;
  onSaved: (p: Property) => void;
  onCancel: () => void;
  cancelLabel?: string;
  /** Lets the first-run flow offer "skip". */
  extraAction?: React.ReactNode;
}

interface FormState {
  address1: string; address2: string; city: string; state: string; zip: string; identifier: string;
  purchaseDate: string; purchasePrice: string; status: PropertyStatus;
  saleDate: string; salePrice: string; description: string; notes: string;
}

const fromProperty = (p?: Property): FormState => ({
  address1: p?.address1 ?? '', address2: p?.address2 ?? '', city: p?.city ?? '', state: p?.state ?? '', zip: p?.zip ?? '', identifier: p?.identifier ?? '',
  purchaseDate: p?.purchaseDate ? formatUsDate(p.purchaseDate) : '', purchasePrice: p?.purchasePriceCents != null ? inputMoney(p.purchasePriceCents) : '',
  status: p?.status ?? 'Held', saleDate: p?.saleDate ? formatUsDate(p.saleDate) : '',
  salePrice: p?.salePriceCents != null ? inputMoney(p.salePriceCents) : '', description: p?.description ?? '', notes: p?.notes ?? '',
});

/** The plain word for one of these in sentences: addresses are properties, everything else is an item. */
export const itemWord = (template: Template): string => (TEMPLATE_INFO[template].hasAddress ? 'property' : 'item');

export function PropertyForm({ companyId, businessType, property, submitLabel, onSaved, onCancel, cancelLabel = 'Cancel', extraAction }: Props) {
  const { setDirty, companyName } = useApp();
  const template: Template = property?.template ?? businessType?.template ?? 'renovation';
  const info = TEMPLATE_INFO[template];
  const typeName = property?.businessTypeName ?? businessType?.name ?? 'Renovation';
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
  const money = (text: string) => (text.trim() === '0' ? { ok: true as const, cents: 0 } : parseCurrency(text));

  /** Client-side checks mirror the main process so errors appear instantly; the main process is still the authority. */
  const build = (): { fields?: PropertyFields; errors: Record<string, string> } => {
    const e: Record<string, string> = {};
    if (v.address1.trim() === '') e.address1 = info.hasAddress ? 'Enter the street address.' : 'Enter a name.';
    if (info.hasAddress) {
      if (v.city.trim() === '') e.city = 'Enter the city.';
      if (!/^[A-Za-z]{2}$/.test(v.state.trim())) e.state = 'Choose a state.';
      if (!/^\d{5}(-\d{4})?$/.test(v.zip.trim())) e.zip = 'Enter a ZIP code like 37201.';
    }

    let purchaseDate: string | null = null;
    let purchasePriceCents: number | null = null;
    if (info.purchase !== 'none') {
      const dateBlank = v.purchaseDate.trim() === '';
      const priceBlank = v.purchasePrice.trim() === '';
      const optionalAndEmpty = info.purchase === 'optional' && dateBlank && priceBlank;
      if (!optionalAndEmpty) {
        const pd = parseUsDate(v.purchaseDate);
        const pp = money(v.purchasePrice);
        if (!pd.ok) e.purchaseDate = dateBlank && info.purchase === 'optional' ? 'Enter the purchase date, or clear the price.' : pd.message; else purchaseDate = pd.iso;
        if (priceBlank) e.purchasePrice = info.purchase === 'optional' ? 'Enter the purchase price, or clear the date.' : 'Enter the purchase price.';
        else if (!pp.ok) e.purchasePrice = pp.message; else purchasePriceCents = pp.cents;
      }
    }

    let saleDate: string | null = null;
    let salePriceCents: number | null = null;
    if (v.status === 'Sold') {
      const sd = parseUsDate(v.saleDate);
      const sp = money(v.salePrice);
      if (!sd.ok) e.saleDate = sd.message; else saleDate = sd.iso;
      if (!sp.ok) e.salePrice = sp.message; else salePriceCents = sp.cents;
      if (sd.ok && purchaseDate && sd.iso < purchaseDate) e.saleDate = 'The sale date cannot be before the purchase date.';
    }
    if (Object.keys(e).length) return { errors: e };
    return {
      errors: e,
      fields: {
        address1: v.address1, address2: info.hasAddress ? v.address2 : '', city: info.hasAddress ? v.city : '', state: info.hasAddress ? v.state.toUpperCase() : '', zip: info.hasAddress ? v.zip : '',
        identifier: info.identifierLabel ? v.identifier : '',
        purchaseDate, purchasePriceCents, status: v.status, saleDate, salePriceCents, description: v.description, notes: v.notes,
        ...(property ? {} : { businessTypeId: businessType?.id }),
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
  const word = itemWord(template);
  const statuses = statusesFor(template);
  const optionalPurchase = info.purchase === 'optional';

  return (
    <form className="property-form stack-form" onSubmit={(e) => { e.preventDefault(); void save(false); }} noValidate>
      {formError && <Notice tone="danger">{formError}</Notice>}
      <div className="form-grid">
        <div className="field">
          <span className="field__label">Company</span>
          <p className="static-value">{owner}</p>
          {property && <p className="field__hint">A {word} stays with its company. To track it under another company, archive it and add it there.</p>}
        </div>
        <div className="field">
          <span className="field__label">Type</span>
          <p className="static-type">{typeName}</p>
          {property && <p className="field__hint">The type cannot be changed after the {word} is added.</p>}
        </div>
      </div>
      <div className="form-grid">
        <TextField className="span-2" label={info.nameLabel} required value={v.address1} onChange={set('address1')} error={errors.address1} autoFocus={!property} maxLength={160}
          placeholder={info.hasAddress ? undefined : template === 'buy_sell' ? 'For example: 2018 Honda Accord' : 'For example: Main Street Car Wash'} />
        {info.hasAddress && (
          <>
            <TextField className="span-2" label="Unit or suite" optional value={v.address2} onChange={set('address2')} maxLength={80} />
            <TextField label="City" required value={v.city} onChange={set('city')} error={errors.city} maxLength={80} />
            <div className="form-grid form-grid--tight">
              <SelectField label="State" required value={v.state.toUpperCase()} onChange={set('state')} error={errors.state}>
                <option value="">Select</option>
                {[...new Set([...(v.state && !US_STATE_CODES.includes(v.state.toUpperCase() as never) ? [v.state.toUpperCase()] : []), ...US_STATE_CODES])].map((code) => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </SelectField>
              <TextField label="ZIP" required value={v.zip} onChange={set('zip')} error={errors.zip} maxLength={10} inputMode="numeric" />
            </div>
          </>
        )}
        {info.identifierLabel && (
          <TextField className="span-2" label={info.identifierLabel} optional value={v.identifier} onChange={set('identifier')} error={errors.identifier} maxLength={80}
            hint={template === 'buy_sell' ? 'For a car, the VIN. Used when searching.' : undefined} />
        )}
        {info.purchase !== 'none' && (
          <>
            <DateField label="Purchase date" required={!optionalPurchase} optional={optionalPurchase} value={v.purchaseDate} onChange={(t) => setV((x) => ({ ...x, purchaseDate: t }))} error={errors.purchaseDate}
              hint={optionalPurchase ? 'Leave the date and price blank if you do not want to record them.' : 'Any date, including years ago.'} />
            <CurrencyField label="Purchase price" required={!optionalPurchase} optional={optionalPurchase} value={v.purchasePrice} onChange={(t) => setV((x) => ({ ...x, purchasePrice: t }))} error={errors.purchasePrice} />
          </>
        )}
        {statuses.length > 1 && (
          <SelectField label="Status" required value={v.status} onChange={set('status')} error={errors.status}>
            {statuses.map((s) => <option key={s} value={s}>{statusLabel(template, s)}</option>)}
          </SelectField>
        )}
      </div>
      {v.status === 'Sold' && (
        <fieldset className="panel panel--tinted fieldset">
          <legend className="section-title">Sale</legend>
          <div className="form-grid">
            <DateField label="Sale date" required value={v.saleDate} onChange={(t) => setV((x) => ({ ...x, saleDate: t }))} error={errors.saleDate} />
            <CurrencyField label="Gross sale price" required value={v.salePrice} onChange={(t) => setV((x) => ({ ...x, salePrice: t }))} error={errors.salePrice}
              hint="Before commissions and fees. Enter those as expenses." />
          </div>
        </fieldset>
      )}
      {reopening && <Notice tone="danger">Changing this {word} from Sold removes its sale date and sale price. You will be asked to confirm.</Notice>}
      <TextAreaField label="Description" optional value={v.description} onChange={set('description')} maxLength={2000} />
      <TextAreaField label="Notes" optional value={v.notes} onChange={set('notes')} maxLength={5000} />
      <div className="form-actions">
        {extraAction}
        <Button variant="ghost" onClick={onCancel}>{cancelLabel}</Button>
        <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Saving…' : submitLabel}</Button>
      </div>
      <ReopenDialog word={word} open={confirmReopen} onCancel={() => setConfirmReopen(false)} onConfirm={() => { setConfirmReopen(false); void save(true); }} />
    </form>
  );
}

function ReopenDialog({ open, word, onCancel, onConfirm }: { open: boolean; word: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Dialog open={open} title="Reopen this sale?" onClose={onCancel}
      actions={<><Button variant="secondary" onClick={onCancel} autoFocus>Keep it sold</Button><Button variant="danger" onClick={onConfirm}>Remove sale and save</Button></>}>
      <p>The sale date and sale price will be removed and the {word} will no longer count as sold. Expenses you recorded stay as they are.</p>
    </Dialog>
  );
}
