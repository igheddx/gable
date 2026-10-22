import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Field } from './Field';
import { formatCents, parseCurrency } from '../../shared/money';
import { formatUsDate, parseUsDate } from '../../shared/dates';

type CommonProps = {
  label: string;
  optional?: boolean;
  required?: boolean;
  hint?: string;
  error?: string | null;
  badge?: React.ReactNode;
  className?: string;
};

export const TextField = forwardRef<HTMLInputElement, CommonProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>>(
  function TextField({ label, optional, required, hint, error, badge, className, ...rest }, ref) {
    return (
      <Field label={label} optional={optional} required={required} hint={hint} error={error} badge={badge} className={className}>
        {(c) => <input ref={ref} className="input" {...c} {...rest} />}
      </Field>
    );
  },
);

export function TextAreaField({ label, optional, required, hint, error, className, ...rest }: CommonProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>) {
  return (
    <Field label={label} optional={optional} required={required} hint={hint} error={error} className={className}>
      {(c) => <textarea className="input" {...c} {...rest} />}
    </Field>
  );
}

interface CurrencyProps extends CommonProps {
  /** Raw text as typed. The parent owns it so errors never discard input. */
  value: string;
  onChange: (text: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
}

export const CurrencyField = forwardRef<HTMLInputElement, CurrencyProps>(function CurrencyField(
  { label, optional, required, hint, error, badge, className, value, onChange, onBlur, disabled },
  ref,
) {
  return (
    <Field label={label} optional={optional} required={required} hint={hint} error={error} badge={badge} className={className}>
      {(c) => (
        <div className="input-affix">
          <span className="input-affix__prefix" aria-hidden="true">$</span>
          <input
            ref={ref}
            className="input input--money num"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => {
              const r = parseCurrency(value);
              if (r.ok) onChange(formatCents(r.cents, { symbol: false }));
              onBlur?.();
            }}
            {...c}
          />
        </div>
      )}
    </Field>
  );
});

interface DateProps extends CommonProps {
  /** Typed text (MM/DD/YYYY). */
  value: string;
  onChange: (text: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
}

export const DateField = forwardRef<HTMLInputElement, DateProps>(function DateField(
  { label, optional, required, hint = 'MM/DD/YYYY', error, badge, className, value, onChange, onBlur, disabled },
  ref,
) {
  return (
    <Field label={label} optional={optional} required={required} hint={hint} error={error} badge={badge} className={className}>
      {(c) => (
        <input
          ref={ref}
          className="input num"
          inputMode="numeric"
          autoComplete="off"
          placeholder="MM/DD/YYYY"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            const r = parseUsDate(value);
            if (r.ok) onChange(formatUsDate(r.iso));
            onBlur?.();
          }}
          {...c}
        />
      )}
    </Field>
  );
});

export function SelectField({
  label, optional, required, hint, error, className, children, ...rest
}: CommonProps & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'className'>) {
  return (
    <Field label={label} optional={optional} required={required} hint={hint} error={error} className={className}>
      {(c) => (
        <select className="input" {...c} {...rest}>
          {children}
        </select>
      )}
    </Field>
  );
}
