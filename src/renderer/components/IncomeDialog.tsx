import { useState } from 'react';
import { Button, CurrencyField, DateField, Dialog, Notice, SelectField, TextAreaField } from '.';
import { ApiError, api, errorMessage, unwrap } from '../api';
import { INCOME_CATEGORIES } from '../../shared/businessTypes';
import { formatCents, parseCurrency } from '../../shared/money';
import { formatUsDate, parseUsDate, todayIso } from '../../shared/dates';
import type { Income, Property } from '../../shared/types';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (i: Income) => void;
  companyId: number;
  /** Items in this company that take income (rentals and ongoing businesses). */
  items: Property[];
  presetPropertyId?: number | null;
  /** Set to edit an existing entry. The item cannot be changed. */
  income?: Income;
}

const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}-key`);

/** Adds or edits one income entry (rent and other money received). */
export function IncomeDialog({ open, onClose, onSaved, companyId, items, presetPropertyId = null, income }: Props) {
  const [propertyId, setPropertyId] = useState('');
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [key, setKey] = useState(newKey);

  const item = items.find((p) => String(p.id) === propertyId);
  const categories = item ? INCOME_CATEGORIES[item.template] ?? [] : [];

  // Start fresh each time the dialog opens (adjusting state while rendering, so no stale values flash).
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setKey(newKey());
      setErrors({}); setFormError(null); setSaving(false);
      if (income) {
        setPropertyId(String(income.propertyId)); setDate(formatUsDate(income.incomeDate));
        setAmount(formatCents(income.amountCents, { symbol: false })); setCategory(income.category); setNotes(income.notes);
      } else {
        const pre = presetPropertyId ?? (items.length === 1 ? items[0]!.id : null);
        setPropertyId(pre ? String(pre) : ''); setDate(formatUsDate(todayIso())); setAmount(''); setNotes('');
        const first = pre ? items.find((p) => p.id === pre) : undefined;
        setCategory(first ? INCOME_CATEGORIES[first.template]?.[0] ?? '' : '');
      }
    }
  }

  const pickItem = (id: string) => {
    setPropertyId(id);
    const chosen = items.find((p) => String(p.id) === id);
    const list = chosen ? INCOME_CATEGORIES[chosen.template] ?? [] : [];
    if (!list.includes(category)) setCategory(list[0] ?? '');
  };

  const save = async () => {
    if (saving) return;
    const e: Record<string, string> = {};
    const d = parseUsDate(date);
    const a = parseCurrency(amount);
    if (!income && !propertyId) e.propertyId = 'Choose where this income belongs.';
    if (!d.ok) e.incomeDate = d.message;
    if (!a.ok) e.amount = a.message; else if (a.cents <= 0) e.amount = 'Enter an amount greater than zero.';
    if (!category) e.category = 'Choose a type of income.';
    setErrors(e);
    setFormError(null);
    if (Object.keys(e).length || !d.ok || !a.ok) return;
    setSaving(true);
    try {
      const body = { incomeDate: d.iso, amountCents: a.cents, category, notes };
      const saved = await unwrap(income ? api().updateIncome(income.id, body) : api().createIncome({ ...body, companyId, propertyId: Number(propertyId), idempotencyKey: key }));
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError && err.fields && Object.keys(err.fields).length) {
        const map: Record<string, string> = { ...err.fields };
        if (map.amountCents) map.amount = map.amountCents;
        setErrors(map);
      } else setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} title={income ? 'Edit income' : 'Add income'} onClose={onClose}
      actions={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : income ? 'Save changes' : 'Add income'}</Button></>}>
      <form className="stack-form" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {formError && <Notice tone="danger">{formError}</Notice>}
        {items.length === 0 && !income && <Notice>Add a rental property or an ongoing business first. Income is recorded against those.</Notice>}
        <SelectField label="Rental or business" required value={propertyId} onChange={(e) => pickItem(e.target.value)} error={errors.propertyId} disabled={Boolean(income) || items.length === 0}>
          <option value="">Choose…</option>
          {items.map((p) => <option key={p.id} value={p.id}>{p.address1}</option>)}
          {income && !item && <option value={income.propertyId}>{income.propertyName}</option>}
        </SelectField>
        <div className="form-grid">
          <DateField label="Date received" required value={date} onChange={setDate} error={errors.incomeDate} hint="" />
          <CurrencyField label="Amount" required value={amount} onChange={setAmount} error={errors.amount} />
        </div>
        <SelectField label="Type of income" required value={category} onChange={(e) => setCategory(e.target.value)} error={errors.category} disabled={categories.length === 0 && !income}>
          {categories.length === 0 && !income && <option value="">Choose a rental or business first</option>}
          {[...categories, ...(income && !categories.includes(income.category) ? [income.category] : [])].map((c) => <option key={c} value={c}>{c}</option>)}
        </SelectField>
        <TextAreaField label="Notes" optional value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} />
      </form>
    </Dialog>
  );
}
