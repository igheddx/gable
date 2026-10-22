import { useEffect, useId, useRef, type ReactNode } from 'react';

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions: ReactNode;
  wide?: boolean;
}

/** Native <dialog>: modal, focus trapped, Escape closes, focus returns to the opener. */
export function Dialog({ open, title, onClose, children, actions, wide }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const titleId = useId(); // several dialogs can exist on one page; each needs its own label id

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement;
      d.showModal();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`dialog${wide ? ' dialog--wide' : ''}`}
      aria-labelledby={titleId}
      onClose={() => {
        (opener.current as HTMLElement | null)?.focus?.();
        onClose();
      }}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="dialog__body">
        <h2 className="dialog__title" id={titleId}>{title}</h2>
        {children}
      </div>
      <div className="dialog__actions">{actions}</div>
    </dialog>
  );
}
