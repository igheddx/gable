import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

export function Disclosure({ summary, children, defaultOpen }: { summary: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="disclosure" open={defaultOpen}>
      <summary>
        <ChevronRight size={16} aria-hidden="true" />
        {summary}
      </summary>
      <div className="disclosure__body">{children}</div>
    </details>
  );
}
