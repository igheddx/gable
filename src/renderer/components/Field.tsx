import { useId, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  'aria-required'?: true;
}

interface Props {
  label: string;
  optional?: boolean;
  required?: boolean;
  hint?: string;
  error?: string | null;
  badge?: ReactNode;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
}

/** Visible label, hint and inline error wired to the control with ARIA. */
export function Field({ label, optional, required, hint, error, badge, className = '', children }: Props) {
  const uid = useId();
  const id = `f${uid}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field ${className}`}>
      <label className="field__label" htmlFor={id}>
        <span>
          {label}
          {required && <span aria-hidden="true"> *</span>}
        </span>
        {optional && <span className="field__optional">Optional</span>}
        {badge}
      </label>
      {children({
        id,
        'aria-describedby': describedBy,
        ...(error ? { 'aria-invalid': true as const } : {}),
        ...(required ? { 'aria-required': true as const } : {}),
      })}
      {hint && !error && (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field__error" id={errId} role="alert">
          <AlertCircle size={16} aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
