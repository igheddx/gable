import { useRef, useState } from 'react';
import { FileText, FolderOpen, Layers, Unlink } from 'lucide-react';
import { Button, Dialog, Notice, SelectField } from '.';
import { ReceiptDropZone, type PickedFile } from './ReceiptDropZone';
import { api, errorMessage, unwrap, useLoad } from '../api';
import { useApp } from '../shell/AppContext';
import type { StagedFile } from '../../shared/types';

interface Group { key: number; files: StagedFile[] }

interface Props {
  open: boolean;
  onClose: () => void;
  /** Receipts keep the property they were added from. */
  presetPropertyId?: number | null;
  onImported: (count: number) => void;
}

const sizeLabel = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Add receipts to the review queue: choose or drop files, optionally combine images into one receipt. */
export function ReceiptImport({ open, onClose, presetPropertyId = null, onImported }: Props) {
  const { scope, companies, companyName } = useApp();
  const [companyId, setCompanyId] = useState<number>(scope === 'all' ? 0 : scope);
  const [propertyId, setPropertyId] = useState<string>(presetPropertyId ? String(presetPropertyId) : '');
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [problems, setProblems] = useState<{ name: string; reason: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextKey = useRef(1);
  const lockedCompany = scope !== 'all' || presetPropertyId !== null;

  const { data: props } = useLoad(() => (companyId ? unwrap(api().listProperties({ scope: companyId, pageSize: 100, sort: 'address' })) : Promise.resolve(null)), [companyId]);

  const addStaged = (staged: StagedFile[]) => setGroups((g) => [...g, ...staged.map((f) => ({ key: nextKey.current++, files: [f] }))]);

  const pick = async () => {
    setError(null);
    try {
      const r = await unwrap(api().pickReceiptFiles());
      addStaged(r.staged);
      setProblems((p) => [...p, ...r.rejected]);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  /** Dropped files arrive as bytes; the main process validates and stores a private copy of each. */
  const dropped = async (files: PickedFile[]) => {
    setError(null);
    const staged: StagedFile[] = [];
    const bad: { name: string; reason: string }[] = [];
    for (const f of files) {
      try {
        staged.push(await unwrap(api().stageReceiptFile(f.name, new Uint8Array(await f.file.arrayBuffer()))));
      } catch (e) {
        bad.push({ name: f.name, reason: errorMessage(e).replace(`${f.name}: `, '') });
      }
    }
    addStaged(staged);
    setProblems((p) => [...p, ...bad]);
  };

  const isPdf = (f: StagedFile) => /\.pdf$/i.test(f.name);
  const selectedGroups = groups.filter((g) => selected.has(g.key));
  const canCombine = selectedGroups.length >= 2 && selectedGroups.every((g) => g.files.every((f) => !isPdf(f)));

  const combine = () => {
    const keys = new Set(selectedGroups.map((g) => g.key));
    const merged: Group = { key: nextKey.current++, files: selectedGroups.flatMap((g) => g.files) };
    const first = groups.findIndex((g) => keys.has(g.key));
    const rest = groups.filter((g) => !keys.has(g.key));
    rest.splice(first, 0, merged);
    setGroups(rest);
    setSelected(new Set());
  };
  const split = (g: Group) => setGroups((all) => all.flatMap((x) => (x.key === g.key ? x.files.map((f) => ({ key: nextKey.current++, files: [f] })) : [x])));

  const submit = async () => {
    if (!companyId || groups.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await unwrap(api().importReceipts(companyId, propertyId ? Number(propertyId) : null, groups.map((g) => g.files.map((f) => f.stagedId))));
      const rejectedNames = new Set(r.rejected.flatMap((x) => x.names));
      setProblems((p) => [...p, ...r.rejected.map((x) => ({ name: x.names.join(', '), reason: x.reason }))]);
      setGroups((all) => all.filter((g) => g.files.some((f) => rejectedNames.has(f.name))));
      onImported(r.created.length);
      if (r.rejected.length === 0) { reset(); onClose(); }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => { setGroups([]); setSelected(new Set()); setProblems([]); setError(null); };

  return (
    <Dialog
      open={open}
      title="Add receipts"
      onClose={() => { reset(); onClose(); }}
      wide
      actions={
        <>
          <Button variant="ghost" onClick={() => { reset(); onClose(); }}>{problems.length > 0 ? 'Close' : 'Cancel'}</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!companyId || groups.length === 0 || busy}>
            {busy ? 'Adding…' : groups.length === 0 ? 'Add to review queue' : `Add ${groups.length} ${groups.length === 1 ? 'receipt' : 'receipts'} to review queue`}
          </Button>
        </>
      }
    >
      <p className="muted">Receipts are read on this computer and wait for your review. Nothing counts as an expense until you save it.</p>
      <div className="form-grid">
        {lockedCompany ? (
          <div className="field"><span className="field__label">Company</span><p className="static-value">{companyId ? companyName(companyId) : '—'}</p></div>
        ) : (
          <SelectField label="Company" required value={companyId || ''} onChange={(e) => { setCompanyId(Number(e.target.value)); setPropertyId(''); }} hint="Viewing All Companies. Choose the company these receipts belong to.">
            <option value="">Choose a company…</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
          </SelectField>
        )}
        <SelectField label="Asset" optional value={propertyId} onChange={(e) => setPropertyId(e.target.value)} disabled={!companyId || presetPropertyId !== null}>
          <option value="">General company expense</option>
          {(props?.rows ?? []).map((p) => <option key={p.id} value={p.id}>{p.address1}</option>)}
        </SelectField>
      </div>

      {problems.length > 0 && (
        <Notice tone="danger">
          <strong>Some files were not added:</strong>
          <ul className="problem-list">{problems.map((p, i) => <li key={i}>{p.name}: {p.reason}</li>)}</ul>
        </Notice>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="import-actions">
        <Button variant="secondary" icon={<FolderOpen size={16} aria-hidden="true" />} onClick={() => void pick()}>Choose files…</Button>
        <span className="muted">JPG, PNG or PDF. Up to 25 MB each. PDFs up to 30 pages (scanned PDFs read the first 10).</span>
      </div>
      <ReceiptDropZone files={[]} onChange={(f) => void dropped(f)} note="Or drop them here." />

      {groups.length > 0 && (
        <div className="import-list" role="group" aria-label="Receipts to add">
          <div className="import-list__head">
            <span className="muted">{groups.length} {groups.length === 1 ? 'receipt' : 'receipts'}. Select images and combine them if they are pages of one receipt.</span>
            <Button size="sm" variant="secondary" icon={<Layers size={14} aria-hidden="true" />} disabled={!canCombine} onClick={combine}>Combine selected</Button>
          </div>
          <ul className="files">
            {groups.map((g) => (
              <li key={g.key} className="files__item import-item">
                {g.files.length === 1 && !isPdf(g.files[0]!) ? (
                  <input type="checkbox" aria-label={`Select ${g.files[0]!.name}`} checked={selected.has(g.key)} onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(g.key); else n.delete(g.key); return n; })} />
                ) : <span className="import-item__spacer" />}
                <FileText size={18} aria-hidden="true" />
                <span className="files__name">{g.files.map((f) => f.name).join(' + ')}</span>
                <span className="muted num">{g.files.length > 1 ? `${g.files.length} pages` : sizeLabel(g.files[0]!.sizeBytes)}</span>
                {g.files.length > 1 && <Button size="sm" variant="ghost" icon={<Unlink size={14} aria-hidden="true" />} onClick={() => split(g)}>Separate</Button>}
                <Button size="sm" variant="ghost" aria-label={`Remove ${g.files.map((f) => f.name).join(', ')}`} onClick={() => setGroups((all) => all.filter((x) => x.key !== g.key))}>Remove</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}
