/**
 * Cleans the supplied app-icon artwork (resources/brand/icon-source.png): the file has stray transparent
 * blotches in the dark background. Pixels away from the letter and roof are replaced with the flat background
 * colour; the letter, roof and the rounded outer edge are kept exactly. Writes resources/brand/icon-clean.png.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const dir = path.resolve('resources/brand');
async function main(): Promise<void> {
const img = await loadImage(fs.readFileSync(path.join(dir, 'icon-source.png')));
const { width: w, height: h } = img;
const c = createCanvas(w, h);
const g = c.getContext('2d');
g.drawImage(img, 0, 0);
const data = g.getImageData(0, 0, w, h);
const d = data.data;

const BG = [22, 39, 38];
const isInk = (i: number) => {
  const r = d[i]!, gr = d[i + 1]!, b = d[i + 2]!, a = d[i + 3]!;
  if (a < 200) return false;
  return Math.min(r, gr, b) > 150 || (r > 120 && r - b > 45);
};

// Ink mask, grown by RADIUS pixels (separable box filter) so the anti-aliased glyph edges are kept.
const RADIUS = 8;
const ink = new Uint8Array(w * h);
for (let p = 0; p < w * h; p++) ink[p] = isInk(p * 4) ? 1 : 0;
const spread = (src: Uint8Array, horizontal: boolean) => {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let hit = 0;
      for (let k = -RADIUS; k <= RADIUS && !hit; k++) {
        const xx = horizontal ? x + k : x;
        const yy = horizontal ? y : y + k;
        if (xx >= 0 && xx < w && yy >= 0 && yy < h && src[yy * w + xx]) hit = 1;
      }
      out[y * w + x] = hit;
    }
  }
  return out;
};
const near = spread(spread(ink, true), false);

// "Outside" = transparent pixels connected to the image border (the rounded-corner cut-outs). Transparent
// pixels not connected to it are blotches inside the artwork and get filled.
const outside = new Uint8Array(w * h);
const stack: number[] = [];
const push = (x: number, y: number) => {
  const p = y * w + x;
  if (x < 0 || y < 0 || x >= w || y >= h || outside[p] || d[p * 4 + 3]! >= 128) return;
  outside[p] = 1;
  stack.push(p);
};
for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
while (stack.length) {
  const p = stack.pop()!;
  const x = p % w, y = (p - x) / w;
  push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
}
// Keep the original anti-aliased alpha right at the rounded edge.
const rim = (() => {
  const grow = (src: Uint8Array, horizontal: boolean) => {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let hit = 0;
      for (let k = -3; k <= 3 && !hit; k++) {
        const xx = horizontal ? x + k : x, yy = horizontal ? y : y + k;
        if (xx >= 0 && xx < w && yy >= 0 && yy < h && src[yy * w + xx]) hit = 1;
      }
      out[y * w + x] = hit;
    }
    return out;
  };
  return grow(grow(outside, true), false);
})();

for (let p = 0; p < w * h; p++) {
  if (outside[p]) continue;
  const i = p * 4;
  if (!near[p] || rim[p]) {
    const keepAlpha = rim[p] ? d[i + 3]! : 255;
    d[i] = BG[0]!; d[i + 1] = BG[1]!; d[i + 2] = BG[2]!; d[i + 3] = keepAlpha;
    continue;
  }
  const a = d[i + 3]! / 255; // composite over the background so no hole shows through next to the letter
  d[i] = Math.round(d[i]! * a + BG[0]! * (1 - a));
  d[i + 1] = Math.round(d[i + 1]! * a + BG[1]! * (1 - a));
  d[i + 2] = Math.round(d[i + 2]! * a + BG[2]! * (1 - a));
  d[i + 3] = 255;
}
g.putImageData(data, 0, 0);
fs.writeFileSync(path.join(dir, 'icon-clean.png'), c.toBuffer('image/png'));
console.log(`cleaned icon written (${w}x${h})`);
}

void main();
