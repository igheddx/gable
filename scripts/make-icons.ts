/**
 * Draws Gable's app icon (an original vector: a brass roofline on deep ink) and writes the files the
 * packagers need: resources/icon.png, icon.ico (PNG-compressed) and, on a Mac, icon.icns.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';

const out = path.resolve('resources');
fs.mkdirSync(out, { recursive: true });

function draw(size: number): Buffer {
  const c = createCanvas(size, size);
  const g = c.getContext('2d');
  const r = size * 0.22;
  g.fillStyle = '#182724';
  g.beginPath();
  g.roundRect(size * 0.04, size * 0.04, size * 0.92, size * 0.92, r);
  g.fill();
  g.strokeStyle = '#d4b97f';
  g.lineWidth = size * 0.075;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(size * 0.2, size * 0.68);
  g.lineTo(size * 0.5, size * 0.3);
  g.lineTo(size * 0.8, size * 0.68);
  g.stroke();
  g.beginPath();
  g.moveTo(size * 0.36, size * 0.68);
  g.lineTo(size * 0.64, size * 0.68);
  g.stroke();
  return c.toBuffer('image/png');
}

fs.writeFileSync(path.join(out, 'icon.png'), draw(1024));

// Windows .ico with PNG images (supported since Windows Vista).
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map((s) => draw(s));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const e = 6 + i * 16;
  header.writeUInt8(s === 256 ? 0 : s, e); header.writeUInt8(s === 256 ? 0 : s, e + 1);
  header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(images[i]!.length, e + 8); header.writeUInt32LE(offset, e + 12);
  offset += images[i]!.length;
});
fs.writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([header, ...images]));

if (process.platform === 'darwin') {
  const set = path.join(out, 'icon.iconset');
  fs.rmSync(set, { recursive: true, force: true });
  fs.mkdirSync(set);
  for (const s of [16, 32, 128, 256, 512]) {
    fs.writeFileSync(path.join(set, `icon_${s}x${s}.png`), draw(s));
    fs.writeFileSync(path.join(set, `icon_${s}x${s}@2x.png`), draw(s * 2));
  }
  execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(out, 'icon.icns')]);
  fs.rmSync(set, { recursive: true, force: true });
}
console.log('icons written to resources/');
