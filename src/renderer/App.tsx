import { useEffect, useState } from 'react';
import type { AppInfo } from '../shared/ipc';

/** Foundation placeholder: proves renderer -> preload -> main -> database. Real screens start at Prompt 2. */
export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.gable.getAppInfo().then((r) => (r.ok ? setInfo(r.value) : setError(r.error.message)));
  }, []);

  return (
    <main className="shell">
      <h1>Gable</h1>
      <p className="muted">Property and expense ledger. Foundation build: screens arrive in later stages.</p>
      {error && <p role="alert">{error}</p>}
      {info && (
        <dl data-testid="app-info">
          <dt>Version</dt>
          <dd>{info.version}</dd>
          <dt>Data format</dt>
          <dd>Version {info.schemaVersion}</dd>
          {info.isDemoData && (
            <>
              <dt>Data</dt>
              <dd>Demo data (fictional)</dd>
            </>
          )}
        </dl>
      )}
    </main>
  );
}
