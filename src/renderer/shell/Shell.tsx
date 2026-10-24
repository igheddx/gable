import markUrl from '../assets/gable-mark.png';
import type { ReactNode } from 'react';
import { Banknote, BarChart3, Building2, FileText, Home, Receipt, Settings as SettingsIcon, Palette } from 'lucide-react';
import { useApp } from './AppContext';
import { SHOWCASE_ENABLED } from '../env';

const NAV = [
  { path: '/overview', label: 'Overview', icon: Home },
  { path: '/properties', label: 'Assets', icon: Building2 },
  { path: '/expenses', label: 'Expenses', icon: Receipt },
  { path: '/income', label: 'Income', icon: Banknote },
  { path: '/reports', label: 'Reports', icon: BarChart3 },
];

export function Shell({ children }: { children: ReactNode }) {
  const { route, navigate, scope, setScope, companies } = useApp();
  const link = (path: string, label: string, Icon: typeof Home) => {
    const current = route.path === path || route.path.startsWith(`${path}/`) || (path === '/expenses' && route.path.startsWith('/receipts'));
    return (
      <a
        key={path}
        href={`#${path}`}
        className="nav__link"
        aria-current={current ? 'page' : undefined}
        onClick={(e) => {
          e.preventDefault();
          navigate(path);
        }}
      >
        <Icon size={18} aria-hidden="true" />
        {label}
      </a>
    );
  };

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true"><GableMark /></span>
          <span className="brand__name">Gable</span>
        </div>

        <div className="company">
          <label htmlFor="company-switcher" className="company__label">Company</label>
          <select id="company-switcher" className="company__select" value={String(scope)} onChange={(e) => setScope(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.displayName}{c.isDefault ? ' (default)' : ''}</option>
            ))}
            <option value="all">All Companies (view only)</option>
          </select>
          {scope === 'all' && <p className="company__note">Viewing every company together. Choose a company to add records.</p>}
        </div>

        <nav className="nav" aria-label="Main">
          {NAV.map((n) => link(n.path, n.label, n.icon))}
        </nav>

        <div className="sidebar__bottom">
          {SHOWCASE_ENABLED && link('/showcase', 'Components', Palette)}
          {link('/settings', 'Settings', SettingsIcon)}
        </div>
      </aside>
      <main id="main" className="main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}

/** The Gable app mark (same artwork as the desktop icon). */
export function GableMark({ size = 28 }: { size?: number }) {
  return <img src={markUrl} width={size} height={size} alt="" />;
}

export function PageHeader({ title, context, actions }: { title: string; context?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {context && <p className="page-context">{context}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export { FileText };
