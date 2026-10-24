import { useState } from 'react';
import { Archive, RotateCcw } from 'lucide-react';
import { Button, Dialog, ErrorState, Notice, SelectField, useToast } from '../components';
import { PropertyForm, itemWord } from '../components/PropertyForm';
import { TEMPLATE_INFO } from '../../shared/businessTypes';
import { PageHeader } from '../shell/Shell';
import { useApp } from '../shell/AppContext';
import { api, errorMessage, unwrap, useLoad } from '../api';

export function PropertyEditPage() {
  const { route, navigate, companies, scope, companyName } = useApp();
  const toast = useToast();
  const id = Number(route.query.get('id'));
  const isNew = route.path === '/properties/new';
  const presetCompany = Number(route.query.get('company')) || (scope !== 'all' ? scope : 0);
  const [chosen, setChosen] = useState<number>(presetCompany);
  const typeId = Number(route.query.get('type')) || 0;
  const { data: types } = useLoad(() => unwrap(api().listBusinessTypes(false)), []);
  const businessType = types?.find((t) => t.id === typeId);
  const { data: property, error, reload } = useLoad(() => (isNew ? Promise.resolve(null) : unwrap(api().getProperty(id))), [isNew, id]);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const word = property ? itemWord(property.template) : businessType ? itemWord(businessType.template) : 'property';
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  const toDetail = (pid: number) => navigate(`/properties/view?id=${pid}`);

  const setArchived = async (archive: boolean) => {
    try {
      await unwrap(archive ? api().archiveProperty(id) : api().restoreProperty(id));
      toast(archive ? `${cap(word)} archived. Its history is kept.` : `${cap(word)} restored.`);
      setConfirmArchive(false);
      if (archive) navigate('/properties'); else reload();
    } catch (e) {
      toast(errorMessage(e), 'error');
      setConfirmArchive(false);
    }
  };

  if (!isNew && error) return <div className="page-body"><ErrorState title="Could not open this item">{error}</ErrorState></div>;
  if (!isNew && property === null && !error) return null;

  if (isNew && !chosen) {
    return (
      <>
        <PageHeader title="Add an asset" context="Which company owns it?" />
        <div className="page-body">
          <div className="panel narrow stack-form">
            <p className="muted">You are viewing All Companies, which is read only. Choose the company this belongs to. It cannot be changed later.</p>
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

  if (isNew && typeId && !types) return null;
  if (isNew && !businessType) {
    return (
      <>
        <PageHeader title="Add an asset" context={companyName(chosen)} />
        <div className="page-body">
          <div className="panel narrow stack-form">
            <h2 className="panel__title">What are you adding?</h2>
            <div className="type-choices" role="group" aria-label="Type of asset">
              {(types ?? []).map((t) => (
                <button key={t.id} type="button" className="type-choice" onClick={() => navigate(`/properties/new?company=${chosen}&type=${t.id}`)}>
                  <span className="type-choice__name">{t.name}</span>
                  <span className="muted">{TEMPLATE_INFO[t.template].description}</span>
                </button>
              ))}
            </div>
            <p className="muted">You can add more kinds of business, such as boats or equipment, in Settings.</p>
            <div className="form-actions"><Button variant="ghost" onClick={() => navigate('/properties')}>Cancel</Button></div>
          </div>
        </div>
      </>
    );
  }

  const archived = property?.isArchived ?? false;
  const newTitle = businessType ? `Add ${businessType.name.toLowerCase()}${word === 'property' ? ' property' : ''}` : 'Add an asset';
  return (
    <>
      <PageHeader
        title={isNew ? newTitle : archived ? `Archived ${word}` : `Edit ${word}`}
        context={isNew ? undefined : property?.address1}
        actions={!isNew && property && (
          archived
            ? <Button variant="secondary" icon={<RotateCcw size={16} aria-hidden="true" />} onClick={() => void setArchived(false)}>Restore {word}</Button>
            : <Button variant="secondary" icon={<Archive size={16} aria-hidden="true" />} onClick={() => setConfirmArchive(true)}>Archive</Button>
        )}
      />
      <div className="page-body">
        {archived && <Notice>This {word} is archived and read only. Restore it to make changes.</Notice>}
        {!archived && (
          <div className="panel narrow">
            <PropertyForm
              key={property?.id ?? 'new'}
              companyId={isNew ? chosen : (property?.companyId ?? null)}
              property={property ?? undefined}
              businessType={businessType}
              submitLabel={isNew ? `Add ${word}` : 'Save changes'}
              onSaved={(p) => { toast(isNew ? `${cap(word)} added.` : `${cap(word)} saved.`); toDetail(p.id); }}
              onCancel={() => (isNew ? navigate('/properties') : toDetail(id))}
            />
          </div>
        )}
      </div>
      <Dialog open={confirmArchive} title={`Archive this ${word}?`} onClose={() => setConfirmArchive(false)}
        actions={<><Button variant="secondary" onClick={() => setConfirmArchive(false)} autoFocus>Cancel</Button><Button variant="danger" onClick={() => void setArchived(true)}>Archive {word}</Button></>}>
        <p>Archiving hides it from lists. Its purchase, sale, income and any recorded expenses are kept, and you can restore it later.</p>
      </Dialog>
    </>
  );
}
