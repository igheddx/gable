import { useId, useRef, useState } from 'react';
import { FileText, UploadCloud, X } from 'lucide-react';
import { Button } from './Button';

export interface PickedFile { name: string; size: number; file: File }

const OK = /\.(jpe?g|png|pdf)$/i;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

function sizeLabel(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

interface Props {
  files: PickedFile[];
  onChange: (files: PickedFile[]) => void;
  /** What the user can expect to happen to the files. */
  note?: string;
}

/** Drop zone with a real button so keyboard users are never blocked by drag and drop. */
export function ReceiptDropZone({ files, onChange, note }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const hintId = useId();

  const add = (list: FileList | File[]) => {
    const accepted: PickedFile[] = [];
    const bad: string[] = [];
    for (const f of Array.from(list)) {
      if (/\.heic$/i.test(f.name)) bad.push(`${f.name}: HEIC photos are not supported yet. Save or export the photo as JPG, then add it again.`);
      else if (!OK.test(f.name)) bad.push(`${f.name}: only JPG, PNG and PDF files can be added.`);
      else if (f.size > MAX_FILE_BYTES) bad.push(`${f.name}: this file is larger than 25 MB.`);
      else accepted.push({ name: f.name, size: f.size, file: f });
    }
    setProblems(bad);
    if (accepted.length) onChange([...files, ...accepted]);
  };

  return (
    <div>
      <div
        className={`dropzone${over ? ' dropzone--over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          add(e.dataTransfer.files);
        }}
      >
        <UploadCloud size={28} aria-hidden="true" className="dropzone__icon" />
        <p className="dropzone__title">Drop receipts here</p>
        <p className="muted" id={hintId}>JPG, PNG or PDF, up to 25 MB each. {note}</p>
        <Button variant="secondary" size="sm" onClick={() => input.current?.click()} aria-describedby={hintId}>Choose files</Button>
        <input ref={input} type="file" hidden multiple accept=".jpg,.jpeg,.png,.pdf" onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ''; }} />
      </div>
      {problems.length > 0 && (
        <ul className="file-problems" role="alert">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
      {files.length > 0 && (
        <ul className="files" aria-label="Attached receipts">
          {files.map((f, i) => (
            <li key={`${f.name}${i}`} className="files__item">
              <FileText size={18} aria-hidden="true" />
              <span className="files__name">{f.name}</span>
              <span className="muted num">{sizeLabel(f.size)}</span>
              <Button variant="ghost" size="sm" iconOnly aria-label={`Remove ${f.name}`} onClick={() => onChange(files.filter((_, j) => j !== i))} icon={<X size={16} aria-hidden="true" />} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
