import { useState } from 'react';
import { DatabaseBackup, FolderOpen, RotateCcw, ShieldCheck } from 'lucide-react';
import { Badge, Button, Dialog, ErrorState, Notice, useToast } from '../components';
import { PageHeader } from '../shell/Shell';
import { api, errorMessage, unwrap, useLoad } from '../api';
import { useApp } from '../shell/AppContext';
import type { FileCheck, RestorePreview } from '../../shared/types';

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const size = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function BackupsPage() {
  const { navigate } = useApp();
  const toast = useToast();
  const { data: status, error, reload } = useLoad(() => unwrap(api().getBackupStatus()), []);
  const [busy, setBusy] = useState<'backup' | 'inspect' | 'restore' | 'check' | null>(null);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [check, setCheck] = useState<FileCheck | null>(null);
  const [restarting, setRestarting] = useState(false);

  const guard = async (kind: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    setBusy(kind);
    try { await fn(); } catch (e) { toast(errorMessage(e), 'error'); reload(); } finally { setBusy(null); }
  };

  const backupNow = () => guard('backup', async () => {
    const r = await unwrap(api().runBackup());
    toast(`Backup saved: ${r.file}${r.warnings.length ? ' (with a warning)' : ''}.`);
    reload();
  });

  const inspect = (listed: string | null) => guard('inspect', async () => {
    setProblem(null);
    try {
      const r = await unwrap(api().inspectBackup(listed));
      if (r) { setPreview(r); setUnderstood(false); }
    } catch (e) {
      setProblem(errorMessage(e));
    }
  });

  const cancelRestore = () => {
    if (preview) void api().discardRestore(preview.token);
    setPreview(null);
  };

  const restore = () => guard('restore', async () => {
    if (!preview) return;
    await unwrap(api().restoreBackup(preview.token));
    setRestarting(true);
  });

  const destinationNote = !status ? null : !status.destinationAvailable
    ? <Notice tone="danger">The backup folder cannot be reached right now. If it is an external drive, plug it in. Backups will not run until it is available.</Notice>
    : status.sameDisk
      ? <Notice tone="preview">These backups are on the same drive as your Gable data. They protect against mistakes, but not against losing that drive. Choose a folder on an external drive or another computer for real protection.</Notice>
      : null;

  return (
    <>
      <PageHeader title="Backups" context="Protect your records" actions={<Button variant="ghost" onClick={() => navigate('/settings')}>Back to settings</Button>} />
      <div className="page-body">
        {error && <ErrorState title="Could not load backup settings">{error}</ErrorState>}
        {status?.lastRestore && <Notice tone={status.lastRestore.ok ? 'info' : 'danger'}><strong>{status.lastRestore.ok ? 'Last restore succeeded' : 'Last restore did not complete'}</strong> ({when(status.lastRestore.at)}). {status.lastRestore.message}</Notice>}
        {status && (
          <>
            <section className="panel" aria-label="Backup status">
              <div className="backup-head">
                <div>
                  <h2 className="panel__title"><ShieldCheck size={18} aria-hidden="true" /> Last successful backup</h2>
                  {status.lastSuccess
                    ? <p><strong>{when(status.lastSuccess.at)}</strong> <Badge tone="neutral" small icon={false}>{status.lastSuccess.kind}</Badge></p>
                    : <p className="muted">No backup has been made yet.</p>}
                  {status.lastSuccess?.warnings.map((w) => <p key={w} className="muted small">{w}</p>)}
                  {status.lastFailure && <p className="field__error" role="alert">The last attempt failed ({when(status.lastFailure.at)}): {status.lastFailure.message}</p>}
                </div>
                <Button variant="primary" icon={<DatabaseBackup size={16} aria-hidden="true" />} onClick={() => void backupNow()} disabled={busy !== null || status.running}>{busy === 'backup' ? 'Backing up…' : 'Back up now'}</Button>
              </div>
              {destinationNote}
              <div className="backup-dest">
                <div><span className="field__label">Backup folder</span><p className="static-value">{status.destinationLabel}</p></div>
                <Button variant="secondary" icon={<FolderOpen size={16} aria-hidden="true" />} onClick={() => void guard('inspect', async () => { await unwrap(api().chooseBackupFolder()); reload(); })}>Choose folder…</Button>
                {!status.isDefaultDestination && <Button variant="ghost" onClick={() => void guard('inspect', async () => { await unwrap(api().useDefaultBackupFolder()); reload(); })}>Use Gable&apos;s folder</Button>}
              </div>
              <label className="check">
                <input type="checkbox" checked={status.autoEnabled} onChange={(e) => void guard('inspect', async () => { await unwrap(api().setAutoBackup(e.target.checked)); reload(); })} />
                <span>Back up automatically once a day</span>
              </label>
              <p className="muted small">Automatic backups happen only while Gable is open: when it starts (if today&apos;s is missing) and then once a day. Nothing runs while Gable is closed. Gable keeps the {status.retention} newest automatic backups; backups you make yourself are never deleted automatically. Backups are not encrypted: keep them somewhere private.</p>
            </section>

            <section className="panel panel--flush" aria-label="Saved backups">
              <h3 className="report-table__title">Saved backups</h3>
              {status.backups.length === 0 ? <p className="muted pad">No backups in this folder yet.</p> : (
                <div className="table-wrap">
                  <table className="table">
                    <caption className="sr-only">Backups in the backup folder, newest first</caption>
                    <thead><tr><th scope="col">Made</th><th scope="col">Kind</th><th scope="col" className="is-right">Size</th><th scope="col" className="is-right">Actions</th></tr></thead>
                    <tbody>
                      {status.backups.map((b) => (
                        <tr key={b.file}>
                          <td className="num">{when(b.modifiedAt)}</td>
                          <td>{b.kind === 'pre-restore' ? 'Before a restore' : b.kind === 'auto' ? 'Automatic' : 'Manual'}</td>
                          <td className="money num">{size(b.bytes)}</td>
                          <td className="is-right"><Button size="sm" variant="ghost" icon={<RotateCcw size={14} aria-hidden="true" />} disabled={busy !== null} onClick={() => void inspect(b.file)} aria-label={`Restore the backup from ${when(b.modifiedAt)}`}>Restore…</Button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="pager"><span className="muted small">Restoring replaces everything in Gable with the backup. You will see what it contains first.</span><Button variant="secondary" disabled={busy !== null} onClick={() => void inspect(null)}>Restore from a file…</Button></div>
            </section>
            {problem && <Notice tone="danger"><strong>That backup was not used.</strong> {problem} Nothing in Gable was changed.</Notice>}

            <section className="panel" aria-label="Receipt file check">
              <h3 className="panel__title">Check receipt files</h3>
              <p className="muted">Looks for receipts that Gable has on record but can no longer find on disk, for example if files were deleted by hand.</p>
              <Button variant="secondary" disabled={busy !== null} onClick={() => void guard('check', async () => setCheck(await unwrap(api().checkReceiptFiles())))}>{busy === 'check' ? 'Checking…' : 'Check now'}</Button>
              {check && (check.missing.length === 0
                ? <Notice>All receipt files are present.</Notice>
                : <Notice tone="danger">
                    <strong>{check.missing.length} receipt {check.missing.length === 1 ? 'file is' : 'files are'} missing:</strong>
                    <ul className="problem-list">{check.missing.map((m) => <li key={`${m.kind}${m.id}${m.label}`}>{m.label}</li>)}</ul>
                    Restore a backup that still has them, or open the expense and remove the receipt from it. The amounts are not affected.
                  </Notice>)}
            </section>
          </>
        )}
      </div>

      <Dialog
        open={preview !== null && !restarting}
        title="Replace everything with this backup?"
        onClose={cancelRestore}
        wide
        actions={
          <>
            <Button variant="secondary" onClick={cancelRestore} autoFocus>Cancel</Button>
            <Button variant="danger" disabled={!understood || busy === 'restore'} onClick={() => void restore()}>{busy === 'restore' ? 'Restoring…' : 'Replace and restart'}</Button>
          </>
        }
      >
        {preview && (
          <>
            <p>This backup was made on <strong>{when(preview.createdAt)}</strong> and contains <strong>{preview.counts.companies}</strong> {preview.counts.companies === 1 ? 'company' : 'companies'}, <strong>{preview.counts.properties}</strong> {preview.counts.properties === 1 ? 'property' : 'properties'}, <strong>{preview.counts.expenses}</strong> {preview.counts.expenses === 1 ? 'expense' : 'expenses'} and <strong>{preview.counts.receipts}</strong> stored {preview.counts.receipts === 1 ? 'receipt' : 'receipts'}{preview.counts.drafts ? `, plus ${preview.counts.drafts} ${preview.counts.drafts === 1 ? 'receipt' : 'receipts'} waiting for review` : ''}.</p>
            <Notice tone="danger">
              <span><strong>This replaces all of your current data</strong>, including every company, not just one. It is not a merge. Anything you added after this backup was made will be gone from Gable.</span>
            </Notice>
            <p className="muted">Before replacing anything, Gable saves a backup of your current data in the backup folder, so you can undo this. Gable then restarts.{preview.upgradeNeeded ? ' This backup is from an older version; it will be updated, and a safety copy is kept first.' : ''}</p>
            {preview.warnings.map((w) => <Notice key={w} tone="preview">{w}</Notice>)}
            <label className="check"><input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} /><span>I understand this replaces everything in Gable.</span></label>
          </>
        )}
      </Dialog>
      <Dialog open={restarting} title="Restoring…" onClose={() => {}} actions={<span className="muted">Gable is restarting.</span>}>
        <p>Your data has been replaced. Gable will restart in a moment. If it does not, open it again from the Start menu.</p>
      </Dialog>
    </>
  );
}
