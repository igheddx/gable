import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Dialog } from '../components';
import { COMPANIES, PROPERTIES, SEED_EXPENSES, RECEIPTS, type FxExpense, type FxReceipt, type ReceiptStatus } from '../fixtures';

export type CompanyScope = 'all' | string;

export interface Route { path: string; query: URLSearchParams }

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#/, '') || '/expenses';
  const [path = '/expenses', q = ''] = raw.split('?');
  return { path, query: new URLSearchParams(q) };
}

interface AppState {
  route: Route;
  /** Navigate, asking first if a form has unsaved work. */
  navigate: (to: string) => void;
  scope: CompanyScope;
  /** Switch company view. Never alters the default company or any open form's ownership. */
  setScope: (s: CompanyScope) => void;
  /** Pages with editable forms register whether they hold unsaved work. */
  setDirty: (dirty: boolean) => void;
  expenses: FxExpense[];
  addExpense: (e: Omit<FxExpense, 'id' | 'preview'>) => void;
  receipts: FxReceipt[];
  setReceiptStatus: (id: string, status: ReceiptStatus, suggestion?: FxReceipt['suggestion']) => void;
  companyName: (id: string) => string;
  propertyLabel: (id: string | null) => string;
}

const Ctx = createContext<AppState | null>(null);
export const useApp = (): AppState => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside provider');
  return v;
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(parseHash);
  const [scope, setScopeState] = useState<CompanyScope>('oak');
  const [expenses, setExpenses] = useState<FxExpense[]>(SEED_EXPENSES);
  const [receipts, setReceipts] = useState<FxReceipt[]>(RECEIPTS);
  const dirty = useRef(false);
  const [pending, setPending] = useState<null | { kind: 'route'; to: string } | { kind: 'scope'; to: CompanyScope }>(null);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (to: string) => {
    window.location.hash = to;
  };

  const navigate = useCallback((to: string) => {
    if (dirty.current) setPending({ kind: 'route', to });
    else go(to);
  }, []);

  const setScope = useCallback((s: CompanyScope) => {
    if (dirty.current) setPending({ kind: 'scope', to: s });
    else setScopeState(s);
  }, []);

  const setDirty = useCallback((d: boolean) => {
    dirty.current = d;
  }, []);

  const value = useMemo<AppState>(
    () => ({
      route, navigate, scope, setScope, setDirty, expenses,
      addExpense: (e) => setExpenses((xs) => [{ ...e, id: `new${xs.length}`, preview: true }, ...xs]),
      receipts,
      setReceiptStatus: (id, status, suggestion) =>
        setReceipts((rs) => rs.map((r) => (r.id === id ? { ...r, status, suggestion: suggestion === undefined ? r.suggestion : suggestion } : r))),
      companyName: (id) => COMPANIES.find((c) => c.id === id)?.name ?? 'Unknown company',
      propertyLabel: (id) => (id ? (PROPERTIES.find((p) => p.id === id)?.address ?? 'Unknown property') : 'General company expense'),
    }),
    [route, navigate, scope, setScope, setDirty, expenses, receipts],
  );

  const confirmDiscard = () => {
    if (!pending) return;
    dirty.current = false;
    if (pending.kind === 'route') go(pending.to);
    else setScopeState(pending.to);
    setPending(null);
  };

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
            ? 'You have an expense in progress. It stays with the company it was started for and will not move to the company you are switching to.'
            : 'You have an expense in progress. If you leave now, what you entered will be lost.'}
        </p>
      </Dialog>
    </Ctx.Provider>
  );
}
