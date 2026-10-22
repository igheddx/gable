import { useState } from 'react';
import { Archive, RotateCcw } from 'lucide-react';
import { Button, Dialog, ErrorState, Notice, SelectField, useToast } from '../components';
import { PropertyForm } from '../components/PropertyForm';
import { PageHeader } from '../shell/Shell';
import { useApp } from '../shell/AppContext';
import { api, errorMessage, unwrap, useLoad } from '../api';

export function PropertyEditPage() {
  const { route, navigate, companies, scope } = useApp();
  const toast = useToast();
  const id = Number(route.query.get('id'));
  const isNew = route.path === '/properties/new';
  const presetCompany = Number(route.query.get('company')) || (scope !== 'all' ? scope : 0);
  const [chosen, setChosen] = useState<number>(presetCompany);
  const { data: property, error, reload } = useLoad(() => (isNew ? Promise.resolve(null) : unwrap(api().getProperty(id))), [isNew, id]);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const toDetail = (pid: number) => navigate(`/properties/view?id=${pid}`);

  const setArchived = async (archive: boolean) => {
    try {
      await unwrap(archive ? api().archiveProperty(id) : api().restoreProperty(id));
      toast(archive ? 'Property archived. Its history is kept.' : 'Property restored.');
      setConfirmArchive(false);
      if (archive) navigate('/properties'); else reload();
    } catch (e) {
      toast(errorMessage(e), 'error');
      setConfirmArchive(false);
    }
  };

  if (!isNew && error) return <div className="page-body"><ErrorState title="Could not open property">{error}</ErrorState></div>;
  if (!isNew && property === null && !error) return null;

  if (isNew && !chosen) {
    return (
      <>
        <PageHeader title="Add property" context="Which company owns it?" />
        <div className="page-body">
          <div className="panel narrow stack-form">
            <p className="muted">You are viewing All Companies, which is read only. Choose the company this property belongs to. It cannot be changed later.</p>
            <SelectField label="Company" required value="" onChange={(e) => setChosen(Number(e.target.value))}>
              <option value="">Choose a company…</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
            </SelectField>
            <div className="form-actions"><Button variant="ghost" onClick={() => navigate('/properties')}>Cancel</Button></div>
          </div>
        </div>
      </>
    );
  }

  const archived = property?.isArchived ?? false;
  return (
    <>
      <PageHeader
        title={isNew ? 'Add property' : archived ? 'Archived property' : 'Edit property'}
        context={isNew ? undefined : property?.address1}
        actions={!isNew && property && (
          archived
            ? <Button variant="secondary" icon={<RotateCcw size={16} aria-hidden="true" />} onClick={() => void setArchived(false)}>Restore property</Button>
            : <Button variant="secondary" icon={<Archive size={16} aria-hidden="true" />} onClick={() => setConfirmArchive(true)}>Archive</Button>
        )}
      />
      <div className="page-body">
        {archived && <Notice>This property is archived and read only. Restore it to make changes.</Notice>}
        {!archived && (
          <div className="panel narrow">
            <PropertyForm
              key={property?.id ?? 'new'}
              companyId={isNew ? chosen : (property?.companyId ?? null)}
              property={property ?? undefined}
              submitLabel={isNew ? 'Add property' : 'Save changes'}
              onSaved={(p) => { toast(isNew ? 'Property added.' : 'Property saved.'); toDetail(p.id); }}
              onCancel={() => (isNew ? navigate('/properties') : toDetail(id))}
            />
          </div>
        )}
      </div>
      <Dialog open={confirmArchive} title="Archive this property?" onClose={() => setConfirmArchive(false)}
        actions={<><Button variant="secondary" onClick={() => setConfirmArchive(false)} autoFocus>Cancel</Button><Button variant="danger" onClick={() => void setArchived(true)}>Archive property</Button></>}>
        <p>Archiving hides the property from lists. Its purchase, sale and any recorded expenses are kept, and you can restore it later.</p>
      </Dialog>
    </>
  );
}
