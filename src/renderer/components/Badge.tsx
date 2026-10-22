import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Eye, Info, XCircle } from 'lucide-react';

export type Tone = 'neutral' | 'success' | 'danger' | 'warning' | 'review' | 'info';

const ICONS: Record<Tone, ReactNode> = {
  neutral: null,
  success: <CheckCircle2 size={13} aria-hidden="true" />,
  danger: <XCircle size={13} aria-hidden="true" />,
  warning: <AlertTriangle size={13} aria-hidden="true" />,
  review: <Eye size={13} aria-hidden="true" />,
  info: <Info size={13} aria-hidden="true" />,
};

/** Status is always conveyed by text (and an icon), never by color alone. */
export function Badge({ tone = 'neutral', small, icon = true, children }: { tone?: Tone; small?: boolean; icon?: boolean; children: ReactNode }) {
  return (
    <span className={`badge badge--${tone}${small ? ' badge--sm' : ''}`}>
      {icon && ICONS[tone]}
      {children}
    </span>
  );
}
