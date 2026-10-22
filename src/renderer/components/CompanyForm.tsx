import { useEffect, useState } from 'react';
import { Button, Disclosure, Notice, TextAreaField, TextField } from '.';
import { ApiError, api, errorMessage, unwrap } from '../api';
import { useApp } from '../shell/AppContext';
import type { Company } from '../../shared/types';

interface Props {
  company?: Company;
  submitLabel: string;
  onSaved: (c: Company) => void;
  onCancel?: () => void;
  cancelLabel?: string;
}

export function CompanyForm({ company, submitLabel, onSaved, onCancel, cancelLabel = 'Cancel' }: Props) {
  const { setDirty } = useApp();
  const [v, setV] = useState({
    displayName: company?.displayName ?? '',
    legalName: company?.legalName ?? '',
    address: company?.address ?? '',
    phone: company?.phone ?? '',
    email: company?.email ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const initial = JSON.stringify(v);
  const [baseline] = useState(initial);
  const dirty = initial !== baseline;

  useEffect(() => {
    setDirty(dirty);
    return () => setDirty(false);
  }, [dirty, setDirty]);

  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      const saved = await unwrap(company ? api().updateCompany(company.id, v) : api().createCompany(v));
      setDirty(false);
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VALIDATION') {
        setErrors(err.fields);
        requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      } else setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="stack-form" onSubmit={submit} noValidate>
      {formError && <Notice tone="danger">{formError}</Notice>}
      <TextField label="Company name" required value={v.displayName} onChange={set('displayName')} error={errors.displayName} autoFocus
        hint="The name you will see in the company switcher and on reports." maxLength={120} />
      <Disclosure summary="More details" defaultOpen={Boolean(company && (company.legalName || company.address || company.phone || company.email))}>
        <TextField label="Legal name" optional value={v.legalName} onChange={set('legalName')} error={errors.legalName} maxLength={160} />
        <TextAreaField label="Address" optional value={v.address} onChange={set('address')} maxLength={300} />
        <div className="form-grid">
          <TextField label="Phone" optional value={v.phone} onChange={set('phone')} type="tel" maxLength={40} />
          <TextField label="Email" optional value={v.email} onChange={set('email')} error={errors.email} type="email" maxLength={160} />
        </div>
      </Disclosure>
      <div className="form-actions">
        {onCancel && <Button variant="ghost" onClick={onCancel}>{cancelLabel}</Button>}
        <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Saving…' : submitLabel}</Button>
      </div>
    </form>
  );
}
