/** Extensions listed as images. Browser support for heic/heif/jxl varies (Safari only). */
export const IMAGE_EXTENSIONS = new Set([
  'png', 'apng', 'jpg', 'jpeg', 'jpe', 'jfif', 'pjpeg', 'pjp', 'gif', 'webp', 'avif',
  'bmp', 'dib', 'ico', 'cur', 'svg', 'tif', 'tiff', 'heic', 'heif', 'jxl',
]);

export function isImageName(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot > 0 && IMAGE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/** One image in the list. `open()` returns what <image-viewer> can load. */
export interface ImageEntry {
  name: string;
  /** Path relative to the opened folder, e.g. "holiday/2024/beach.jpg". */
  path: string;
  size?: number;
  open(): Promise<string | Blob>;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export const byPath = (a: ImageEntry, b: ImageEntry) => collator.compare(a.path, b.path);

export function formatSize(bytes?: number): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}
