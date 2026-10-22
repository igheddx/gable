/**
 * Clearly synthetic receipt files for tests. Every document says SAMPLE and uses invented
 * names and amounts. Generated at test time so no binary files live in the repository.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument, StandardFonts } from 'pdf-lib';

type Line = [string, string];

function drawReceipt(lines: Line[], opts: { width?: number; font?: string; noise?: number; rotate?: number; blur?: boolean; vendor?: string } = {}) {
  const width = opts.width ?? 640;
  const rowH = Math.round(width / 12);
  const height = 120 + (lines.length + 3) * rowH;
  const c = createCanvas(width, height);
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, width, height);
  g.fillStyle = '#111111';
  const fs0 = Math.round(width / 22);
  g.font = `bold ${Math.round(fs0 * 1.2)}px ${opts.font ?? 'sans-serif'}`;
  g.fillText(opts.vendor ?? 'HARBOR LUMBER & SUPPLY', 30, 50);
  g.font = `${Math.round(fs0 * 0.6)}px ${opts.font ?? 'sans-serif'}`;
  g.fillText('SAMPLE RECEIPT - FICTIONAL', 30, 80);
  g.font = `${fs0}px ${opts.font ?? 'sans-serif'}`;
  lines.forEach(([k, v], i) => {
    const y = 130 + i * rowH;
    g.fillText(k, 30, y);
    if (v) g.fillText(v, width - 30 - g.measureText(v).width, y);
  });
  if (opts.noise) {
    const d = g.getImageData(0, 0, width, height);
    let seed = 7;
    for (let i = 0; i < d.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const n = ((seed % 100) / 100 - 0.5) * opts.noise;
      d.data[i] = Math.max(0, Math.min(255, d.data[i]! + n));
      d.data[i + 1] = Math.max(0, Math.min(255, d.data[i + 1]! + n));
      d.data[i + 2] = Math.max(0, Math.min(255, d.data[i + 2]! + n));
    }
    g.putImageData(d, 0, 0);
  }
  if (!opts.rotate) return c;
  const swap = opts.rotate % 180 !== 0;
  const r = createCanvas(swap ? height : width, swap ? width : height);
  const rg = r.getContext('2d');
  rg.fillStyle = '#fff';
  rg.fillRect(0, 0, r.width, r.height);
  rg.translate(r.width / 2, r.height / 2);
  rg.rotate((opts.rotate * Math.PI) / 180);
  rg.drawImage(c, -width / 2, -height / 2);
  return r;
}

export const CLEAN: Line[] = [
  ['09/18/2026', ''], ['2x4x8 Stud', '62.40'], ['Drywall 1/2 in', '71.10'], ['Screws 5lb', '18.95'],
  ['SUBTOTAL', '152.45'], ['TAX', '12.80'], ['TOTAL', '165.25'], ['CASH TENDERED', '184.25'], ['CHANGE', '19.00'],
];

export interface ReceiptFixtures {
  dir: string;
  clean: string;
  rotated: string;
  poor: string;
  ambiguous: string;
  page1: string;
  page2: string;
  digitalPdf: string;
  scannedPdf: string;
  longPdf: string;
  corrupt: string;
  encryptedPdf: string;
  heic: string;
  duplicateOfClean: string;
}

export async function buildReceiptFixtures(dir: string): Promise<ReceiptFixtures> {
  fs.mkdirSync(dir, { recursive: true });
  const out = (name: string, data: Buffer | Uint8Array) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, data);
    return p;
  };
  const png = (c: ReturnType<typeof drawReceipt>) => c.toBuffer('image/png');

  const clean = out('clean-receipt.png', png(drawReceipt(CLEAN)));
  const rotated = out('rotated-receipt.png', png(drawReceipt(CLEAN, { rotate: 90 })));
  // Small, noisy and compressed: a bad phone photo.
  const poorCanvas = drawReceipt(CLEAN, { width: 420, noise: 90 });
  const poor = out('poor-quality.jpg', poorCanvas.toBuffer('image/jpeg', 25));
  const ambiguous = out('ambiguous-total.png', png(drawReceipt([
    ['Invoice date 09/12/2026', ''], ['Panel upgrade', '120.00'], ['TOTAL', '120.00'], ['Late fee', '15.00'], ['TOTAL DUE', '135.00'],
  ], { vendor: 'BRIGHTLINE ELECTRIC' })));
  const page1 = out('multi-page-1.png', png(drawReceipt([['Invoice date 09/12/2026', ''], ['Labor', '2,800.00'], ['Wire and breakers', '1,100.00'], ['Continued on next page', '']], { vendor: 'BRIGHTLINE ELECTRIC' })));
  const page2 = out('multi-page-2.png', png(drawReceipt([['Permit pass-through', '300.00'], ['AMOUNT DUE', '4,200.00']], { vendor: 'BRIGHTLINE ELECTRIC' })));

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([612, 792]);
  p1.drawText('BRIGHTLINE ELECTRIC', { x: 50, y: 720, size: 20, font });
  p1.drawText('SAMPLE INVOICE - FICTIONAL', { x: 50, y: 696, size: 10, font });
  p1.drawText('Invoice date 09/12/2026', { x: 50, y: 660, size: 14, font });
  p1.drawText('Panel upgrade labor 2,800.00', { x: 50, y: 630, size: 14, font });
  const p2 = doc.addPage([612, 792]);
  p2.drawText('Wire and breakers 1,100.00', { x: 50, y: 700, size: 14, font });
  p2.drawText('AMOUNT DUE 4,200.00', { x: 50, y: 660, size: 14, font });
  const digitalPdf = out('digital-invoice.pdf', await doc.save());

  const scanned = await PDFDocument.create();
  const img = await scanned.embedPng(fs.readFileSync(clean));
  const sp = scanned.addPage([img.width, img.height]);
  sp.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  const scannedPdf = out('scanned-receipt.pdf', await scanned.save());

  const long = await PDFDocument.create();
  for (let i = 0; i < 31; i++) long.addPage([300, 300]);
  const longPdf = out('thirty-one-pages.pdf', await long.save());

  const corrupt = out('corrupt.png', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('this is not really image data')]));
  const encryptedPdf = out('encrypted.pdf', Buffer.from(ENCRYPTED_PDF, 'latin1'));
  const heic = out('IMG_0001.HEIC', Buffer.from('ftypheic fake'));
  const duplicateOfClean = out('clean-receipt-copy.png', fs.readFileSync(clean));
  return { dir, clean, rotated, poor, ambiguous, page1, page2, digitalPdf, scannedPdf, longPdf, corrupt, encryptedPdf, heic, duplicateOfClean };
}

// A minimal PDF whose Standard security handler needs a password we do not supply.
const ENCRYPTED_PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj
4 0 obj<</Filter/Standard/V 1/R 2/O(${'A'.repeat(32)})/U(${'B'.repeat(32)})/P -4>>endobj
trailer<</Size 5/Root 1 0 R/Encrypt 4 0 R/ID[<00112233445566778899aabbccddeeff><00112233445566778899aabbccddeeff>]>>
%%EOF
`;
