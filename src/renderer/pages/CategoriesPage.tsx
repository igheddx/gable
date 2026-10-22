import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Badge, Button, Dialog, EmptyState, ErrorState, SelectField, TextField, useToast } from '../components';
import { PageHeader } from '../shell/Shell';
import { useApp } from '../shell/AppContext';
import { ApiError, api, errorMessage, unwrap, useLoad } from '../api';
import { GROUP_LABELS, REPORTING_GROUPS, type ReportingGroup } from '../../shared/categories';
import type { Category } from '../../shared/types';

export function CategoriesPage() {
  const { scope, companies, companyName, navigate } = useApp();
  const toast = useToast();
  const [picked, setPicked] = useState<number>(scope === 'all' ? 0 : scope);
  const companyId = scope === 'all' ? picked : scope;
  const [showArchived, setShowArchived] = useState(false);
  const { data, error, reload } = useLoad(() => (companyId ? unwrap(api().listCategories(companyId, true)) : Promise.resolve([] as Category[])), [companyId]);
  const [name, setName] = useState('');
  const [group, setGroup] = useState<ReportingGroup>('renovation');
  const [addError, setAddError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Category | null>(null);
  const [newName, setNewName] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [regroup, setRegroup] = useState<{ cat: Category; to: ReportingGroup } | null>(null);

  const act = async (fn: () => Promise<unknown>, ok: string): Promise<boolean> => {
    try {
      await fn();
      reload();
      toast(ok);
      return true;
    } catch (e) {
      toast(errorMessage(e), 'error');
      return false;
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);
    try {
      await unwrap(api().createCategory({ companyId, name, reportingGroup: group }));
      setName('');
      reload();
      toast('Category added.');
    } catch (err) {
      setAddError(err instanceof ApiError ? (err.fields.name ?? err.message) : errorMessage(err));
    }
  };

  const rows = (data ?? []).filter((c) => showArchived || !c.isArchived);

  return (
    <>
      <PageHeader title="Categories" context={companyId ? companyName(companyId) : 'Choose a company'} actions={<Button variant="ghost" onClick={() => navigate('/settings')}>Back to settings</Button>} />
      <div className="page-body">
        {scope === 'all' && (
          <div className="panel narrow">
            <SelectField label="Company" value={picked || ''} onChange={(e) => setPicked(Number(e.target.value))} hint="Categories belong to one company. Choose which company to manage.">
              <option value="">Choose a company…</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
            </SelectField>
          </div>
        )}
        {error && <ErrorState title="Could not load categories">{error}</ErrorState>}
        {companyId > 0 && (
          <>
            <p className="muted">Each category belongs to one reporting group, which decides where its expenses appear in cost and profit reports. These are management groupings, not tax categories.</p>
            <form className="panel add-category" onSubmit={(e) => void add(e)} noValidate>
              <TextField label="New category" value={name} onChange={(e) => { setName(e.target.value); setAddError(null); }} error={addError} maxLength={80} placeholder="For example: Dumpster rental" />
              <SelectField label="Reporting group" value={group} onChange={(e) => setGroup(e.target.value as ReportingGroup)}>
                {REPORTING_GROUPS.map((g) => <option key={g} value={g}>{GROUP_LABELS[g]}</option>)}
              </SelectField>
              <Button variant="primary" type="submit" icon={<Plus size={16} aria-hidden="true" />}>Add category</Button>
            </form>
            <div className="panel panel--flush">
              {rows.length === 0 ? <EmptyState title="No categories">Add one above.</EmptyState> : (
                <div className="table-wrap">
                  <table className="table">
                    <caption className="sr-only">Categories</caption>
                    <thead><tr><th scope="col">Category</th><th scope="col">Reporting group</th><th scope="col" className="is-right">Actions</th></tr></thead>
                    <tbody>
                      {rows.map((c) => (
                        <tr key={c.id} className={c.isArchived ? 'is-voided' : undefined}>
                          <td><span className="table__primary">{c.name}</span> {c.isArchived && <Badge tone="neutral" small icon={false}>Archived</Badge>}</td>
                          <td>{GROUP_LABELS[c.reportingGroup]}</td>
                          <td className="is-right">
                            <div className="row-actions">
                              <Button size="sm" variant="ghost" aria-label={`Rename ${c.name}`} onClick={() => { setRenaming(c); setNewName(c.name); setRenameError(null); }}>Rename</Button>
                              <Button size="sm" variant="ghost" aria-label={`Change group for ${c.name}`} onClick={() => setRegroup({ cat: c, to: c.reportingGroup })}>Change group</Button>
                              {c.isArchived
                                ? <Button size="sm" variant="ghost" aria-label={`Restore ${c.name}`} onClick={() => void act(() => unwrap(api().restoreCategory(c.id)), `${c.name} restored.`)}>Restore</Button>
                                : <Button size="sm" variant="ghost" aria-label={`Archive ${c.name}`} onClick={() => void act(() => unwrap(api().archiveCategory(c.id)), `${c.name} archived. Past expenses keep it.`)}>Archive</Button>}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <label className="check"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /><span>Show archived categories</span></label>
          </>
        )}
      </div>

      <Dialog open={renaming !== null} title="Rename category" onClose={() => setRenaming(null)}
        actions={<><Button variant="secondary" onClick={() => setRenaming(null)}>Cancel</Button>
          <Button variant="primary" onClick={() => void (async () => {
            if (!renaming) return;
            try { await unwrap(api().renameCategory(renaming.id, newName)); setRenaming(null); reload(); toast('Category renamed.'); }
            catch (err) { setRenameError(err instanceof ApiError ? (err.fields.name ?? err.message) : errorMessage(err)); }
          })()}>Save name</Button></>}>
        <p className="muted">Renaming keeps the reporting group and all past expenses.</p>
        <TextField label="Category name" value={newName} onChange={(e) => { setNewName(e.target.value); setRenameError(null); }} error={renameError} maxLength={80} autoFocus />
      </Dialog>

      <Dialog open={regroup !== null} title="Change reporting group?" onClose={() => setRegroup(null)}
        actions={<><Button variant="secondary" onClick={() => setRegroup(null)} autoFocus>Cancel</Button>
          <Button variant="danger" disabled={!regroup || regroup.to === regroup.cat.reportingGroup} onClick={() => void (async () => {
            if (!regroup) return;
            if (await act(() => unwrap(api().setCategoryGroup(regroup.cat.id, regroup.to, true)), `${regroup.cat.name} moved to ${GROUP_LABELS[regroup.to]}.`)) setRegroup(null);
          })()}>Change group</Button></>}>
        <p>This changes how every expense in <strong>{regroup?.cat.name}</strong>, past and future, appears in cost and profit reports.</p>
        <SelectField label="Reporting group" value={regroup?.to ?? ''} onChange={(e) => regroup && setRegroup({ ...regroup, to: e.target.value as ReportingGroup })}>
          {REPORTING_GROUPS.map((g) => <option key={g} value={g}>{GROUP_LABELS[g]}</option>)}
        </SelectField>
      </Dialog>
    </>
  );
}
