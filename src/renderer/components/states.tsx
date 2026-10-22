import type { ReactNode } from 'react';
import { AlertTriangle, Info, Inbox } from 'lucide-react';

export function EmptyState({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="state">
      <span className="state__icon">{icon ?? <Inbox size={32} aria-hidden="true" />}</span>
      <h2 className="state__title">{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="state state--error" role="alert">
      <span className="state__icon"><AlertTriangle size={32} aria-hidden="true" /></span>
      <h2 className="state__title">{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'preview' | 'danger'; children: ReactNode }) {
  return (
    <div className={`notice${tone === 'preview' ? ' notice--preview' : tone === 'danger' ? ' notice--danger' : ''}`} role={tone === 'danger' ? 'alert' : undefined}>
      {tone === 'danger' ? <AlertTriangle size={16} aria-hidden="true" /> : <Info size={16} aria-hidden="true" />}
      <div>{children}</div>
    </div>
  );
}
