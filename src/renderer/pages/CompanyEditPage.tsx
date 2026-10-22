import { useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { Button, ErrorState, useToast } from '../components';
import { CompanyForm } from '../components/CompanyForm';
import { PageHeader } from '../shell/Shell';
import { useApp } from '../shell/AppContext';
import { api, errorMessage, unwrap, useLoad } from '../api';

export function CompanyEditPage() {
  const { route, navigate, refreshCompanies } = useApp();
  const toast = useToast();
  const isNew = route.query.get('new') === '1';
  const id = Number(route.query.get('id'));
  const { data: company, error, reload } = useLoad(async () => (isNew ? null : (await unwrap(api().listCompanies(true))).find((c) => c.id === id) ?? null), [isNew, id]);
  const { data: logo, reload: reloadLogo } = useLoad(() => (isNew ? Promise.resolve(null) : unwrap(api().getCompanyLogo(id))), [isNew, id]);
  const [busy, setBusy] = useState(false);

  const back = () => navigate('/settings');

  const logoAction = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r !== null) toast(ok);
      await refreshCompanies();
      reload();
      reloadLogo();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!isNew && error) return <div className="page-body"><ErrorState title="Could not open company">{error}</ErrorState></div>;
  if (!isNew && company === undefined) return null;
  if (!isNew && company === null && !error) {
    return <div className="page-body"><ErrorState title="Company not found" action={<Button onClick={back}>Back to settings</Button>}>It may have been removed.</ErrorState></div>;
  }

  return (
    <>
      <PageHeader title={isNew ? 'Add company' : (company?.displayName ?? 'Company')} context={isNew ? 'A new company for your properties' : 'Company profile'} />
      <div className="page-body">
        <div className="panel narrow">
          <CompanyForm
            key={company?.id ?? 'new'}
            company={company ?? undefined}
            submitLabel={isNew ? 'Add company' : 'Save changes'}
            onSaved={async (c) => { await refreshCompanies(); toast(isNew ? `${c.displayName} added.` : 'Company saved.'); back(); }}
            onCancel={back}
          />
        </div>
        {!isNew && company && (
          <div className="panel narrow">
            <h2 className="panel__title">Logo</h2>
            <p className="muted">Shown on reports. PNG or JPG, up to 1 MB.</p>
            <div className="logo-row">
              {logo ? <img className="logo-preview" src={logo} alt={`${company.displayName} logo`} /> : <div className="logo-preview logo-preview--empty">No logo</div>}
              <Button variant="secondary" icon={<ImagePlus size={16} aria-hidden="true" />} disabled={busy} onClick={() => void logoAction(() => unwrap(api().chooseCompanyLogo(company.id)), 'Logo saved.')}>{logo ? 'Change logo' : 'Choose logo'}</Button>
              {logo && <Button variant="ghost" icon={<Trash2 size={16} aria-hidden="true" />} disabled={busy} onClick={() => void logoAction(() => unwrap(api().clearCompanyLogo(company.id)), 'Logo removed.')}>Remove</Button>}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
