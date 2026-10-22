import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Combobox, CurrencyField, DateField, Dialog, Disclosure, EmptyState, ErrorState, Notice, SelectField, TextAreaField, TextField, useToast } from '../components';
import { ReceiptDropZone, type PickedFile } from '../components/ReceiptDropZone';
import { AllocationEditor, type AllocLine } from '../components/AllocationEditor';
import { PageHeader } from '../shell/Shell';
import { CATEGORIES, VENDORS } from '../fixtures';

const SWATCHES: [string, string, string][] = [
  ['Ink', '--ink', 'Text, navigation, primary actions'],
  ['Ivory', '--ivory', 'App background'],
  ['Brass', '--brass', 'Accent rules and marks (not small text)'],
  ['Brass text', '--brass-text', 'Brass used as text'],
  ['Divider', '--divider', 'Rules and borders'],
  ['Success', '--success', 'Positive status, with text'],
  ['Danger', '--danger', 'Errors and destructive, with text'],
  ['Warning', '--warning', 'Attention, with text'],
  ['Needs review', '--review', 'Suggested, unconfirmed values'],
];

/** Development-only component gallery. Not included in release builds. */
export function ShowcasePage() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<PickedFile[]>([{ name: 'invoice-page-1.pdf', size: 245_000, file: new File([], 'invoice-page-1.pdf') }]);
  const [lines, setLines] = useState<AllocLine[]>([{ category: 'Materials', amount: '60.00' }, { category: 'Electrical', amount: '25.00' }]);
  const [combo, setCombo] = useState('');
  const [vendor, setVendor] = useState('');

  return (
    <>
      <PageHeader title="Components" context="Development showcase. Fictional data only." />
      <div className="page-body showcase">
        <section className="panel">
          <h2 className="section-title">Color</h2>
          <div className="swatches">
            {SWATCHES.map(([name, v, use]) => (
              <div key={v} className="swatch"><span className="swatch__chip" style={{ background: `var(${v})` }} /><div><strong>{name}</strong><p className="muted">{use}</p></div></div>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2 className="section-title">Type</h2>
          <p className="page-title">Serif page heading</p>
          <p className="panel__title">Panel title in the UI sans</p>
          <p>Body text in the UI sans at 15px with comfortable line height for reading forms and tables.</p>
          <p className="muted">Secondary text for hints and context.</p>
          <p className="num">Tabular figures: $1,234,567.89 · $200,000.00 · $5,000.00 · 03/15/2026</p>
        </section>

        <section className="panel">
          <h2 className="section-title">Buttons</h2>
          <div className="row">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger" icon={<Trash2 size={16} aria-hidden="true" />}>Delete</Button>
            <Button variant="primary" icon={<Plus size={16} aria-hidden="true" />}>With icon</Button>
            <Button variant="primary" disabled>Disabled</Button>
            <Button variant="secondary" size="sm">Small</Button>
          </div>
        </section>

        <section className="panel">
          <h2 className="section-title">Fields</h2>
          <div className="form-grid">
            <TextField label="Text field" placeholder="Placeholder" />
            <TextField label="With hint" hint="Helper text explains the field." />
            <TextField label="Required with error" required error="This field is required." defaultValue="" />
            <TextField label="Read only" readOnly defaultValue="Cannot be edited" />
            <CurrencyField label="Currency" value="1234.5" onChange={() => {}} />
            <CurrencyField label="Currency with error" value="12.345" onChange={() => {}} error="Use at most two decimal places." />
            <DateField label="Date" value="03/15/2026" onChange={() => {}} />
            <DateField label="Date with error" value="02/30/2026" onChange={() => {}} error="That date does not exist." />
            <SelectField label="Select"><option>Held</option><option>Renovating</option></SelectField>
            <Combobox label="Searchable select" options={CATEGORIES.map((c) => ({ value: c, label: c }))} value={combo} onChange={setCombo} placeholder="Type to search" />
            <Combobox label="Free-text suggestions" freeText options={VENDORS.map((v) => ({ value: v, label: v }))} value={vendor} onChange={setVendor} placeholder="Vendor" />
            <Combobox label="Disabled" options={[]} value="" onChange={() => {}} disabled />
            <TextAreaField className="span-2" label="Text area" optional placeholder="Notes" />
          </div>
        </section>

        <section className="panel">
          <h2 className="section-title">Badges</h2>
          <div className="row">
            <Badge>Held</Badge><Badge tone="warning">Renovating</Badge><Badge tone="info">Listed</Badge><Badge tone="success">Sold</Badge>
            <Badge tone="review">Needs review</Badge><Badge tone="success">Reviewed</Badge><Badge tone="danger">Failed</Badge><Badge tone="info">Edited by you</Badge>
          </div>
        </section>

        <section className="panel">
          <h2 className="section-title">Table</h2>
          <div className="panel panel--flush">
            <table className="table">
              <thead><tr><th>Date</th><th>Vendor</th><th className="is-right">Amount</th></tr></thead>
              <tbody>
                <tr><td className="num">09/18/2026</td><td className="table__primary">Harbor Lumber &amp; Supply</td><td className="money num">$1,842.50</td></tr>
                <tr><td className="num">09/12/2026</td><td className="table__primary">Brightline Electric</td><td className="money num">$4,200.00</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <h2 className="section-title">Allocation editor</h2>
          <AllocationEditor lines={lines} onChange={setLines} categories={CATEGORIES} totalCents={10_000} showErrors />
        </section>

        <section className="panel">
          <h2 className="section-title">Receipt drop zone</h2>
          <ReceiptDropZone files={files} onChange={setFiles} note="Preview only." />
        </section>

        <section className="panel">
          <h2 className="section-title">Feedback</h2>
          <div className="row">
            <Button onClick={() => setOpen(true)}>Open dialog</Button>
            <Button onClick={() => toast('Saved. This is a sample message.')}>Show toast</Button>
            <Button onClick={() => toast('Something went wrong. Nothing was changed.', 'error')}>Show error toast</Button>
          </div>
          <div className="stack">
            <Notice>Informational notice.</Notice>
            <Notice tone="preview">Design preview notice.</Notice>
            <Notice tone="danger">Error notice with guidance on what to do next.</Notice>
          </div>
          <Disclosure summary="More details (disclosure)"><p>Optional fields stay out of the way until needed.</p></Disclosure>
        </section>

        <section className="panel"><EmptyState title="Nothing here yet">Empty states say what is missing and what to do next.</EmptyState></section>
        <section className="panel"><ErrorState title="Could not load receipts" action={<Button variant="secondary">Try again</Button>}>Your records are safe. Try again, or restart Gable.</ErrorState></section>

        <Dialog open={open} title="Dialog title" onClose={() => setOpen(false)} actions={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={() => setOpen(false)}>Confirm</Button></>}>
          <p>Dialogs trap focus, close with Escape, and return focus to the button that opened them.</p>
        </Dialog>
      </div>
    </>
  );
}
