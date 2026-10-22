import { Hammer } from 'lucide-react';
import { EmptyState } from '../components';
import { PageHeader } from '../shell/Shell';
import { useApp } from '../shell/AppContext';

/** Honest stand-in: no buttons that look functional. */
export function PlaceholderPage({ title, what }: { title: string; what: string }) {
  const { scope, companyName } = useApp();
  return (
    <>
      <PageHeader title={title} context={scope === 'all' ? 'All companies, view only' : companyName(scope)} />
      <div className="page-body">
        <div className="panel">
          <EmptyState title={`${title} is not built yet`} icon={<Hammer size={32} aria-hidden="true" />}>{what}</EmptyState>
        </div>
      </div>
    </>
  );
}
