import { useId, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Field } from './Field';

export interface ComboOption {
  value: string;
  label: string;
  detail?: string;
}

interface Props {
  label: string;
  options: ComboOption[];
  /** Selected option value (select mode) or the typed text (freeText mode). */
  value: string;
  onChange: (value: string) => void;
  freeText?: boolean;
  optional?: boolean;
  required?: boolean;
  hint?: string;
  error?: string | null;
  badge?: React.ReactNode;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  emptyText?: string;
  inputRef?: React.Ref<HTMLInputElement>;
  onBlur?: () => void;
}

/** Searchable select (WAI-ARIA combobox with list autocomplete). */
export function Combobox(p: Props) {
  const uid = useId();
  const listId = `lb${uid}`;
  const selected = p.options.find((o) => o.value === p.value);
  // `typed` holds what the user is typing; otherwise show the value owned by the parent.
  const [typed, setTyped] = useState<string | null>(null);
  const text = typed ?? (p.freeText ? p.value : (selected?.label ?? ''));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!open || q === '' || (!p.freeText && selected && text === selected.label)) return p.options;
    return p.options.filter((o) => o.label.toLowerCase().includes(q) || o.detail?.toLowerCase().includes(q));
  }, [p.options, text, open, p.freeText, selected]);

  const choose = (o: ComboOption) => {
    p.onChange(p.freeText ? o.label : o.value);
    setTyped(null);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && open && filtered[active]) {
      e.preventDefault();
      choose(filtered[active]!);
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <Field label={p.label} optional={p.optional} required={p.required} hint={p.hint} error={p.error} badge={p.badge} className={p.className}>
      {(c) => (
        <div
          className="combo"
          ref={wrapRef}
          onBlur={(e) => {
            if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) {
              setOpen(false);
              if (!p.freeText && text.trim() === '' && p.value !== '') p.onChange('');
              setTyped(null);
              p.onBlur?.();
            }
          }}
        >
          <div className="input-affix">
            <input
              {...c}
              ref={p.inputRef}
              className="input"
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={open && filtered[active] ? `${listId}-${active}` : undefined}
              autoComplete="off"
              disabled={p.disabled}
              placeholder={p.placeholder}
              value={text}
              onChange={(e) => {
                setTyped(e.target.value);
                setOpen(true);
                setActive(0);
                if (p.freeText) p.onChange(e.target.value);
              }}
              onClick={() => setOpen(true)}
              onKeyDown={onKeyDown}
              style={{ paddingRight: 34 }}
            />
            <ChevronDown size={16} aria-hidden="true" style={{ position: 'absolute', right: 12, pointerEvents: 'none' }} />
          </div>
          {open && (
            <ul className="combo__list" role="listbox" id={listId} aria-label={`${p.label} options`}>
              {filtered.length === 0 && <li className="combo__empty">{p.emptyText ?? 'No matches'}</li>}
              {filtered.map((o, i) => (
                <li
                  key={o.value}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className="combo__opt"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(o)}
                  onMouseMove={() => setActive(i)}
                >
                  <span>{o.label}</span>
                  {o.detail && <small>{o.detail}</small>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Field>
  );
}
