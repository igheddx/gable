import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Badge, Button, Dialog, EmptyState, ErrorState, Notice, SelectField, useToast } from '../components';
import { PageHeader } from '../shell/Shell';
import { useApp } from '../shell/AppContext';
import { api, errorMessage, unwrap, useLoad } from '../api';
import type { Company } from '../../shared/types';

export function SettingsPage() {
  const { navigate, refreshCompanies } = useApp();
  const toast = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const { data, error, reload } = useLoad(() => unwrap(api().listCompanies(true)), []);
  const [archiving, setArchiving] = useState<Company | null>(null);
  const [replacement, setReplacement] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const all = data ?? [];
  const active = all.filter((c) => !c.isArchived);
  const rows = showArchived ? all : active;

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await refreshCompanies();
      reload();
      toast(label);
      return true;
    } catch (e) {
      toast(errorMessage(e), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const confirmArchive = async () => {
    if (!archiving) return;
    const needsReplacement = archiving.isDefault;
    if (needsReplacement && !replacement) { setDialogError('Choose which company becomes the default.'); return; }
    const ok = await run(`${archiving.displayName} archived. Its records are kept.`, () =>
      unwrap(api().archiveCompany(archiving.id, needsReplacement ? Number(replacement) : undefined)));
    if (ok) { setArchiving(null); setReplacement(''); setDialogError(null); }
  };

  return (
    <>
      <PageHeader
        title="Settings"
        context="Companies"
        actions={<Button variant="primary" icon={<Plus size={16} aria-hidden="true" />} onClick={() => navigate('/settings/company?new=1')}>Add company</Button>}
      />
      <div className="page-body">
        <p className="muted">The default company is the one Gable opens to. Switching companies in the sidebar never changes it.</p>
        {error && <ErrorState title="Could not load companies">{error}</ErrorState>}
        <div className="panel panel--flush">
          {rows.length === 0 && !error ? (
            <EmptyState title="No companies">Add a company to get started.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Companies</caption>
                <thead><tr><th scope="col">Company</th><th scope="col">Status</th><th scope="col" className="is-right">Actions</th></tr></thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id}>
                      <td><span className="table__primary">{c.displayName}</span>{c.legalName && <div className="muted">{c.legalName}</div>}</td>
                      <td>
                        {c.isDefault && <Badge tone="info" icon={false}>Default</Badge>}{' '}
                        {c.isArchived && <Badge tone="neutral" icon={false}>Archived</Badge>}
                      </td>
                      <td className="is-right">
                        <div className="row-actions">
                          {!c.isArchived && <Button size="sm" variant="ghost" onClick={() => navigate(`/settings/company?id=${c.id}`)} aria-label={`Edit ${c.displayName}`}>Edit</Button>}
                          {!c.isArchived && !c.isDefault && (
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(`${c.displayName} is now the default company.`, () => unwrap(api().setDefaultCompany(c.id)))} aria-label={`Make ${c.displayName} the default company`}>Make default</Button>
                          )}
                          {!c.isArchived && <Button size="sm" variant="ghost" onClick={() => { setArchiving(c); setReplacement(''); setDialogError(null); }} aria-label={`Archive ${c.displayName}`}>Archive</Button>}
                          {c.isArchived && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(`${c.displayName} restored.`, () => unwrap(api().restoreCompany(c.id)))} aria-label={`Restore ${c.displayName}`}>Restore</Button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="panel narrow settings-link">
          <div>
            <h2 className="panel__title">Business types</h2>
            <p className="muted">Renovations, rentals and vehicles are built in. Add other kinds of business to track, such as boats or equipment.</p>
          </div>
          <Button variant="secondary" onClick={() => navigate('/settings/business-types')}>Manage business types</Button>
        </div>
        <div className="panel narrow settings-link">
          <div>
            <h2 className="panel__title">Categories</h2>
            <p className="muted">Customize the expense categories for each company and see how they roll up in reports.</p>
          </div>
          <Button variant="secondary" onClick={() => navigate('/settings/categories')}>Manage categories</Button>
        </div>
        <div className="panel narrow settings-link">
          <div>
            <h2 className="panel__title">Backups</h2>
            <p className="muted">Back up everything, choose where backups go, and restore from one if something goes wrong.</p>
          </div>
          <Button variant="secondary" onClick={() => navigate('/settings/backups')}>Manage backups</Button>
        </div>
        <label className="check">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          <span>Show archived companies</span>
        </label>
      </div>

      <Dialog
        open={archiving !== null}
        title={`Archive ${archiving?.displayName ?? ''}?`}
        onClose={() => setArchiving(null)}
        actions={<><Button variant="secondary" onClick={() => setArchiving(null)} autoFocus>Cancel</Button><Button variant="danger" onClick={() => void confirmArchive()} disabled={busy}>Archive company</Button></>}
      >
        <p>Archiving hides the company and stops new assets, income and expenses from being added to it. Nothing is deleted, and you can restore it later.</p>
        {archiving?.isDefault && (
          <>
            <Notice>{archiving.displayName} is your default company. Choose the company Gable should open to instead.</Notice>
            <SelectField label="New default company" required value={replacement} onChange={(e) => { setReplacement(e.target.value); setDialogError(null); }} error={dialogError}>
              <option value="">Choose a company…</option>
              {active.filter((c) => c.id !== archiving.id).map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
            </SelectField>
            {active.length <= 1 && <Notice tone="danger">This is your only active company. Add another company first.</Notice>}
          </>
        )}
      </Dialog>
    </>
  );
}
