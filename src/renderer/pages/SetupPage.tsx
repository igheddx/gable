import { useState } from 'react';
import { Building2, Home } from 'lucide-react';
import { CompanyForm } from '../components/CompanyForm';
import { PropertyForm } from '../components/PropertyForm';
import { Button } from '../components';
import logoUrl from '../assets/gable-logo.png';
import { useApp } from '../shell/AppContext';
import type { Company } from '../../shared/types';

/** First run: create the first company, then (optionally) its first property. Nothing sensitive is requested. */
export function SetupPage() {
  const { refreshCompanies, setScope, navigate } = useApp();
  const [company, setCompany] = useState<Company | null>(null);

  const finish = async (to: string) => {
    if (company) {
      await refreshCompanies();
      setScope(company.id);
    }
    window.location.hash = to;
    navigate(to);
  };

  return (
    <div className="setup">
      <div className="setup__card panel">
        <img className="setup__logo" src={logoUrl} alt="Gable: every property, every cost" />
        <ol className="steps" aria-label="Setup steps">
          <li aria-current={company ? undefined : 'step'}><Building2 size={16} aria-hidden="true" /> Your company</li>
          <li aria-current={company ? 'step' : undefined}><Home size={16} aria-hidden="true" /> First property</li>
        </ol>
        {!company ? (
          <>
            <h1 className="setup__title">Welcome to Gable</h1>
            <p className="muted">Start by naming the company that owns your properties. You can add more companies later and change anything here.</p>
            <CompanyForm submitLabel="Continue" onSaved={setCompany} />
          </>
        ) : (
          <>
            <h1 className="setup__title">Add your first property</h1>
            <p className="muted">For {company.displayName}. You can skip this and add properties whenever you like.</p>
            <PropertyForm
              companyId={company.id}
              submitLabel="Save property"
              cancelLabel="Back"
              onCancel={() => setCompany(null)}
              onSaved={async (p) => { await finish(`/properties/view?id=${p.id}`); }}
              extraAction={<Button variant="secondary" onClick={() => void finish('/properties')}>Skip for now</Button>}
            />
          </>
        )}
      </div>
    </div>
  );
}
