import { Plus, Trash2 } from 'lucide-react';
import { Button } from './Button';
import { Combobox } from './Combobox';
import { CurrencyField } from './inputs';
import { formatCents, parseCurrency } from '../../shared/money';

export interface AllocLine { category: string; amount: string }

/** Cents allocated across lines that parse; used for the live "remaining" figure. */
export function allocatedCents(lines: AllocLine[]): number {
  return lines.reduce((sum, l) => {
    const r = parseCurrency(l.amount);
    return sum + (r.ok ? r.cents : 0);
  }, 0);
}

/** Returns an error per line index plus one for the total, or empty when valid. */
export function validateAllocations(lines: AllocLine[], totalCents: number | null): { lines: Record<number, string>; total: string | null } {
  const errs: Record<number, string> = {};
  const seen = new Set<string>();
  lines.forEach((l, i) => {
    if (!l.category) errs[i] = 'Choose a category.';
    else if (seen.has(l.category)) errs[i] = 'Use each category once. Combine amounts instead.';
    else seen.add(l.category);
    const r = parseCurrency(l.amount);
    if (!r.ok && !errs[i]) errs[i] = r.message;
  });
  let total: string | null = null;
  if (totalCents !== null && Object.keys(errs).length === 0) {
    const diff = totalCents - allocatedCents(lines);
    if (diff !== 0) total = diff > 0 ? `${formatCents(diff)} is still unassigned.` : `Lines are ${formatCents(-diff)} over the total.`;
  }
  return { lines: errs, total };
}

interface Props {
  lines: AllocLine[];
  onChange: (lines: AllocLine[]) => void;
  categories: string[];
  totalCents: number | null;
  showErrors: boolean;
}

export function AllocationEditor({ lines, onChange, categories, totalCents, showErrors }: Props) {
  const options = categories.map((c) => ({ value: c, label: c }));
  const allocated = allocatedCents(lines);
  const remaining = totalCents === null ? null : totalCents - allocated;
  const v = validateAllocations(lines, totalCents);
  const set = (i: number, patch: Partial<AllocLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <div className="alloc">
      {lines.map((l, i) => (
        <div className="alloc__row" key={i}>
          <Combobox label={i === 0 ? 'Category' : `Category ${i + 1}`} options={options} value={l.category} onChange={(c) => set(i, { category: c })} error={showErrors ? v.lines[i] : null} placeholder="Choose a category" />
          <CurrencyField label="Amount" value={l.amount} onChange={(a) => set(i, { amount: a })} error={null} />
          <Button variant="ghost" size="sm" iconOnly aria-label={`Remove line ${i + 1}`} disabled={lines.length <= 2} onClick={() => onChange(lines.filter((_, j) => j !== i))} icon={<Trash2 size={16} aria-hidden="true" />} />
        </div>
      ))}
      <div className="alloc__foot">
        <Button variant="ghost" size="sm" icon={<Plus size={16} aria-hidden="true" />} onClick={() => onChange([...lines, { category: '', amount: '' }])}>Add category</Button>
        <p className={`alloc__remaining num${remaining === 0 ? ' is-ok' : ''}`} role="status" aria-live="polite">
          {remaining === null ? 'Enter the total amount first.' : remaining === 0 ? 'Fully assigned. Lines add up to the total.' : remaining > 0 ? `Remaining to assign: ${formatCents(remaining)}` : `Over by ${formatCents(-remaining)}`}
        </p>
      </div>
      {showErrors && v.total && <p className="field__error" role="alert">{v.total}</p>}
    </div>
  );
}
