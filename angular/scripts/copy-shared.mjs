// Copies files shared with the rest of the repo into public/ before build/serve:
//   ../samples               -> public/samples        (demo images shown on first load)
//   ../public/viewer/vendor  -> public/viewer-vendor  (TIFF decoder, loaded on demand)
// and writes public/samples/samples.json, the list of sample images the app shows.
import { cpSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';

const copies = [
  ['../samples', 'public/samples'],
  ['../public/viewer/vendor', 'public/viewer-vendor'],
];
for (const [from, to] of copies) {
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
}

const IMAGE = /\.(png|apng|jpe?g|jfif|gif|webp|avif|bmp|ico|svg|tiff?|heic|heif|jxl)$/i;
const samples = readdirSync('public/samples')
  .filter((name) => IMAGE.test(name))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  .map((name) => ({ name, size: statSync(`public/samples/${name}`).size }));
writeFileSync('public/samples/samples.json', JSON.stringify(samples, null, 2) + '\n');
