import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isDirty, setDirtyFlag } from './dirtyFlag';
import { Button, Dialog } from '../components';
import { RECEIPTS, type FxExpense, type FxReceipt, type ReceiptStatus } from '../fixtures';
import { api, errorMessage, unwrap } from '../api';
import type { Company } from '../../shared/types';

/** A company id, or 'all' for the explicit read-only aggregate view. */
export type CompanyScope = 'all' | number;

export interface Route { path: string; query: URLSearchParams }

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#/, '') || '/properties';
  const [path = '/properties', q = ''] = raw.split('?');
  return { path, query: new URLSearchParams(q) };
}

interface AppState {
  route: Route;
  /** Navigate, asking first if a form has unsaved work. */
  navigate: (to: string) => void;
  companies: Company[];
  defaultCompanyId: number | null;
  scope: CompanyScope;
  /** Switch which company is shown. Never changes the default company or any open form's ownership. */
  setScope: (s: CompanyScope) => void;
  /** Re-read companies after a change. */
  refreshCompanies: () => Promise<Company[]>;
  /** Pages with editable forms register whether they hold unsaved work. */
  setDirty: (dirty: boolean) => void;
  /** Preview-only expense list until expenses are stored (next stage). */
  expenses: FxExpense[];
  addExpense: (e: Omit<FxExpense, 'id' | 'preview'>) => void;
  receipts: FxReceipt[];
  setReceiptStatus: (id: string, status: ReceiptStatus, suggestion?: FxReceipt['suggestion']) => void;
  companyName: (id: number) => string;
}

const Ctx = createContext<AppState | null>(null);
export const useApp = (): AppState => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside provider');
  return v;
};

type Pending = { kind: 'route'; to: string } | { kind: 'scope'; to: CompanyScope };

export function AppProvider({ children, onFirstRun }: { children: ReactNode; onFirstRun?: boolean }) {
  void onFirstRun;
  const [route, setRoute] = useState<Route>(parseHash);
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scope, setScopeState] = useState<CompanyScope | null>(null);
  const [expenses, setExpenses] = useState<FxExpense[]>([]);
  const [receipts, setReceipts] = useState<FxReceipt[]>(RECEIPTS);
  const [pending, setPending] = useState<Pending | null>(null);

  const refreshCompanies = useCallback(async () => {
    const list = await unwrap(api().listCompanies(false));
    setCompanies(list);
    return list;
  }, []);

  // Open to the default company on launch. Later switches never touch the default.
  useEffect(() => {
    unwrap(api().listCompanies(false)).then(
      (list) => {
        setCompanies(list);
        setScopeState((s) => s ?? list.find((c) => c.isDefault)?.id ?? list[0]?.id ?? 'all');
      },
      (e) => setLoadError(errorMessage(e)),
    );
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (to: string) => { window.location.hash = to; };

  const navigate = useCallback((to: string) => {
    if (isDirty()) setPending({ kind: 'route', to });
    else go(to);
  }, []);

  const setScope = useCallback((s: CompanyScope) => {
    if (isDirty()) setPending({ kind: 'scope', to: s });
    else setScopeState(s);
  }, []);

  const setDirty = useCallback((d: boolean) => setDirtyFlag(d), []);

  const activeCompanies = companies ?? [];
  // If the viewed company was archived, fall back to the default (view only; default is unchanged).
  const effectiveScope: CompanyScope | null =
    scope === null ? null : scope === 'all' || activeCompanies.some((c) => c.id === scope) ? scope : (activeCompanies.find((c) => c.isDefault)?.id ?? 'all');

  const value = useMemo<AppState | null>(
    () =>
      companies === null || effectiveScope === null
        ? null
        : {
            route, navigate, companies, defaultCompanyId: companies.find((c) => c.isDefault)?.id ?? null,
            scope: effectiveScope, setScope, refreshCompanies, setDirty, expenses,
            addExpense: (e) => setExpenses((xs) => [{ ...e, id: `new${xs.length}`, preview: true }, ...xs]),
            receipts,
            setReceiptStatus: (id, status, suggestion) =>
              setReceipts((rs) => rs.map((r) => (r.id === id ? { ...r, status, suggestion: suggestion === undefined ? r.suggestion : suggestion } : r))),
            companyName: (id) => companies.find((c) => c.id === id)?.displayName ?? 'Archived company',
          },
    [route, navigate, companies, effectiveScope, setScope, refreshCompanies, setDirty, expenses, receipts],
  );

  const confirmDiscard = () => {
    if (!pending) return;
    setDirtyFlag(false);
    if (pending.kind === 'route') go(pending.to);
    else setScopeState(pending.to);
    setPending(null);
  };

  if (loadError) {
    return <div className="boot"><p role="alert">Gable could not open your data. {loadError}</p></div>;
  }
  if (!value) return <div className="boot"><p className="muted">Opening Gable…</p></div>;

  return (
    <Ctx.Provider value={value}>
      {children}
      <Dialog
        open={pending !== null}
        title="Discard unsaved changes?"
        onClose={() => setPending(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setPending(null)} autoFocus>Keep editing</Button>
            <Button variant="danger" onClick={confirmDiscard}>Discard changes</Button>
          </>
        }
      >
        <p>
          {pending?.kind === 'scope'
            ? 'You have unsaved work. It stays with the company it was started for and will not move to the company you are switching to.'
            : 'You have unsaved work. If you leave now, what you entered will be lost.'}
        </p>
      </Dialog>
    </Ctx.Provider>
  );
}
