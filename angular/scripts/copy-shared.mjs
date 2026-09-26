// Copies files shared with the rest of the repo into public/ before build/serve:
//   ../samples               -> public/samples        (demo images shown on first load)
//   ../public/viewer/vendor  -> public/viewer-vendor  (TIFF decoder, loaded on demand)
import { cpSync, rmSync } from 'node:fs';

const copies = [
  ['../samples', 'public/samples'],
  ['../public/viewer/vendor', 'public/viewer-vendor'],
];
for (const [from, to] of copies) {
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
}
