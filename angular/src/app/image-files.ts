/** Extensions listed as images. Browser support for heic/heif/jxl varies (Safari only). */
export const IMAGE_EXTENSIONS = new Set([
  'png', 'apng', 'jpg', 'jpeg', 'jpe', 'jfif', 'pjpeg', 'pjp', 'gif', 'webp', 'avif',
  'bmp', 'dib', 'ico', 'cur', 'svg', 'tif', 'tiff', 'heic', 'heif', 'jxl',
]);

/** Shown to users when a file is not supported. */
export const SUPPORTED_FORMATS_TEXT = 'PNG, JPG/JPEG, GIF, WebP, AVIF, BMP, ICO, SVG, TIFF/TIF (HEIC and JPEG XL in Safari only)';

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

/** Files that were left out because they are not supported images. */
export class SkippedFiles {
  count = 0;
  /** The first few names, for the message. */
  readonly examples: string[] = [];

  add(path: string) {
    this.count++;
    if (this.examples.length < 5) this.examples.push(path);
  }
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
