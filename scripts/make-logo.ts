/**
 * Turns the supplied logo (resources/brand/logo.png, dark ink and brass on cream) into a transparent PNG
 * cropped to the artwork, so it sits cleanly on any panel. Writes src/renderer/assets/gable-logo.png.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const INK = [24, 39, 36];
const BRASS = [167, 131, 72];

async function main(): Promise<void> {
  const img = await loadImage(fs.readFileSync(path.resolve('resources/brand/logo.png')));
  const { width: w, height: h } = img;
  const c = createCanvas(w, h);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, w, h);
  const d = data.data;
  const bg = [d[0]!, d[1]!, d[2]!]; // top-left corner is plain background
  const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const px = [d[i]!, d[i + 1]!, d[i + 2]!];
      const color = px[0]! - px[2]! > 40 ? BRASS : INK;
      const alpha = Math.max(0, Math.min(1, dist(px, bg) / dist(color, bg)));
      d[i] = color[0]!; d[i + 1] = color[1]!; d[i + 2] = color[2]!; d[i + 3] = Math.round(alpha * 255);
      if (alpha > 0.15) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
  }
  g.putImageData(data, 0, 0);
  const pad = 12, cw = maxX - minX + 1 + pad * 2, ch = maxY - minY + 1 + pad * 2;
  const scale = Math.min(1, 900 / cw);
  const out = createCanvas(Math.round(cw * scale), Math.round(ch * scale));
  const og = out.getContext('2d');
  og.imageSmoothingQuality = 'high';
  og.drawImage(c, minX - pad, minY - pad, cw, ch, 0, 0, out.width, out.height);
  fs.mkdirSync('src/renderer/assets', { recursive: true });
  fs.writeFileSync('src/renderer/assets/gable-logo.png', out.toBuffer('image/png'));
  console.log(`logo written (${out.width}x${out.height})`);
}

void main();
