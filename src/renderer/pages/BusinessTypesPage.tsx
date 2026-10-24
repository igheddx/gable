import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Badge, Button, Dialog, EmptyState, ErrorState, TextField, useToast } from '../components';
import { PageHeader } from '../shell/Shell';
import { useApp } from '../shell/AppContext';
import { ApiError, api, errorMessage, unwrap, useLoad } from '../api';
import { CUSTOM_TEMPLATES, TEMPLATE_INFO, type BusinessType, type Template } from '../../shared/businessTypes';

/** Settings: the kinds of business Gable tracks. Three are built in; a person can add their own. */
export function BusinessTypesPage() {
  const { navigate } = useApp();
  const toast = useToast();
  const { data, error, reload } = useLoad(() => unwrap(api().listBusinessTypes(true)), []);
  const [name, setName] = useState('');
  const [template, setTemplate] = useState<Template>('buy_sell');
  const [addError, setAddError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<BusinessType | null>(null);
  const [newName, setNewName] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const act = async (fn: () => Promise<unknown>, ok: string): Promise<boolean> => {
    try { await fn(); reload(); toast(ok); return true; } catch (e) { toast(errorMessage(e), 'error'); return false; }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);
    try {
      await unwrap(api().createBusinessType({ name, template: template as (typeof CUSTOM_TEMPLATES)[number] }));
      setName('');
      reload();
      toast('Business type added. You can now add assets of this type.');
    } catch (err) {
      setAddError(err instanceof ApiError ? (err.fields.name ?? err.message) : errorMessage(err));
    }
  };

  const rows = (data ?? []).filter((t) => showArchived || !t.isArchived);

  return (
    <>
      <PageHeader title="Business types" context="The kinds of business you track" actions={<Button variant="ghost" onClick={() => navigate('/settings')}>Back to settings</Button>} />
      <div className="page-body">
        <p className="muted">A business type decides what Gable records for an asset: a renovation tracks cost and profit, a rental tracks income and expenses, and so on. Renovation, Rental and Vehicle are built in. Add your own for anything else you buy and sell, or run as an ongoing business.</p>
        {error && <ErrorState title="Could not load business types">{error}</ErrorState>}

        <form className="panel add-type" onSubmit={(e) => void add(e)} noValidate aria-label="Add a business type">
          <h2 className="panel__title">Add a business type</h2>
          <TextField label="Name" value={name} onChange={(e) => { setName(e.target.value); setAddError(null); }} error={addError} maxLength={60} placeholder="For example: Boats, Equipment, Car wash" />
          <fieldset className="field">
            <legend className="field__label">How should it work?</legend>
            <div className="template-choices">
              {CUSTOM_TEMPLATES.map((t) => (
                <label key={t} className={`template-choice${template === t ? ' is-on' : ''}`}>
                  <input type="radio" name="template" checked={template === t} onChange={() => setTemplate(t)} />
                  <span><strong>{TEMPLATE_INFO[t].label}</strong><br /><span className="muted">{TEMPLATE_INFO[t].description}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          <div><Button variant="primary" type="submit" icon={<Plus size={16} aria-hidden="true" />}>Add business type</Button></div>
        </form>

        <div className="panel panel--flush">
          {!data ? <p className="pad muted">Loading…</p> : rows.length === 0 ? <EmptyState title="No business types">Add one above.</EmptyState> : (
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Business types</caption>
                <thead><tr><th scope="col">Name</th><th scope="col">Works like</th><th scope="col" className="is-right">Actions</th></tr></thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id} className={t.isArchived ? 'is-voided' : undefined}>
                      <td><span className="table__primary">{t.name}</span> {t.isBuiltin && <Badge tone="info" small icon={false}>Built in</Badge>} {t.isArchived && <Badge tone="neutral" small icon={false}>Archived</Badge>}</td>
                      <td>{TEMPLATE_INFO[t.template].label}</td>
                      <td className="is-right">
                        {!t.isBuiltin && (
                          <div className="row-actions">
                            <Button size="sm" variant="ghost" aria-label={`Rename ${t.name}`} onClick={() => { setRenaming(t); setNewName(t.name); setRenameError(null); }}>Rename</Button>
                            {t.isArchived
                              ? <Button size="sm" variant="ghost" aria-label={`Restore ${t.name}`} onClick={() => void act(() => unwrap(api().restoreBusinessType(t.id)), `${t.name} restored.`)}>Restore</Button>
                              : <Button size="sm" variant="ghost" aria-label={`Archive ${t.name}`} onClick={() => void act(() => unwrap(api().archiveBusinessType(t.id)), `${t.name} archived. Existing assets are kept.`)}>Archive</Button>}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <label className="check"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /><span>Show archived business types</span></label>
      </div>

      <Dialog open={renaming !== null} title="Rename business type" onClose={() => setRenaming(null)}
        actions={<><Button variant="secondary" onClick={() => setRenaming(null)}>Cancel</Button>
          <Button variant="primary" onClick={() => void (async () => {
            if (!renaming) return;
            try { await unwrap(api().renameBusinessType(renaming.id, newName)); setRenaming(null); reload(); toast('Business type renamed.'); }
            catch (err) { setRenameError(err instanceof ApiError ? (err.fields.name ?? err.message) : errorMessage(err)); }
          })()}>Save name</Button></>}>
        <p className="muted">Renaming keeps every asset of this type.</p>
        <TextField label="Name" value={newName} onChange={(e) => { setNewName(e.target.value); setRenameError(null); }} error={renameError} maxLength={60} autoFocus />
      </Dialog>
    </>
  );
}
