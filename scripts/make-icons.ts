/**
 * Builds the app icon files the packagers need (resources/icon.png, icon.ico with PNG images and, on a Mac,
 * icon.icns) from the supplied artwork, resources/brand/icon-clean.png (made by scripts/clean-icon.ts),
 * plus the small copy shown in the app's sidebar.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage, type Image } from '@napi-rs/canvas';

const out = path.resolve('resources');
fs.mkdirSync(out, { recursive: true });

function makeDraw(img: Image) {
  return (size: number): Buffer => {
    const c = createCanvas(size, size);
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, size, size);
    return c.toBuffer('image/png');
  };
}

async function main(): Promise<void> {
  const draw = makeDraw(await loadImage(fs.readFileSync(path.join(out, 'brand', 'icon-clean.png'))));
  fs.writeFileSync(path.join(out, 'icon.png'), draw(1024));
  fs.mkdirSync('src/renderer/assets', { recursive: true });
  fs.writeFileSync('src/renderer/assets/gable-mark.png', draw(128));

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
}

void main();
