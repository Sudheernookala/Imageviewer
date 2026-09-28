import { Injectable } from '@angular/core';
import { ImageEntry, byPath, isImageName } from './image-files';

// Chromium-only API, not in TypeScript's DOM types yet.
declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { mode?: 'read' }) => Promise<FileSystemDirectoryHandle>;
  }
  interface FileSystemDirectoryHandle {
    values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
  }
}

export interface ScanResult {
  label: string;
  entries: ImageEntry[];
  truncated: boolean;
}

/**
 * One line of samples/samples.json (generated from ../samples at build time).
 * `data` (base64) is optional: it lets a host that can't serve a file type (e.g. .tif) ship it inline.
 */
interface SampleInfo {
  name: string;
  size?: number;
  data?: string;
}

const MAX_IMAGES = 20000;
const SKIP_DIRS = new Set(['node_modules', '$RECYCLE.BIN', 'System Volume Information']);

/**
 * Reads images from the user's computer. A static site (GitLab Pages) cannot read
 * a typed path like C:\Photos — the browser only allows folders/files the user picks.
 * Nothing is uploaded: files are read inside the browser tab.
 */
@Injectable({ providedIn: 'root' })
export class FileSourceService {
  /**
   * True in Chrome/Edge/Opera: the nicer folder picker that reads files on demand.
   * Browsers block it inside embedded frames, so there we use the file-input fallback.
   */
  readonly canPickDirectory = typeof window !== 'undefined' && !!window.showDirectoryPicker && window.self === window.top;

  async samples(): Promise<ScanResult> {
    const res = await fetch('samples/samples.json');
    if (!res.ok) throw new Error(`Could not load the sample list (HTTP ${res.status})`);
    const list = (await res.json()) as SampleInfo[];
    const entries = list.map<ImageEntry>((s) => ({
      name: s.name,
      path: s.name,
      size: s.size,
      open: async () => (s.data ? base64ToBlob(s.data) : `samples/${encodeURIComponent(s.name)}`),
    }));
    return { label: 'Sample images', entries, truncated: false };
  }

  /** Chromium folder picker. Resolves null if the user cancels. */
  async pickDirectory(onProgress?: (found: number) => void): Promise<ScanResult | null> {
    let root: FileSystemDirectoryHandle;
    try {
      root = await window.showDirectoryPicker!({ mode: 'read' });
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return null;
      throw err;
    }
    const entries: ImageEntry[] = [];
    let truncated = false;

    const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
      for await (const handle of dir.values()) {
        if (entries.length >= MAX_IMAGES) {
          truncated = true;
          return;
        }
        if (handle.name.startsWith('.')) continue;
        const path = prefix + handle.name;
        if (handle.kind === 'directory') {
          if (!SKIP_DIRS.has(handle.name)) await walk(handle as FileSystemDirectoryHandle, path + '/');
        } else if (isImageName(handle.name)) {
          const fileHandle = handle as FileSystemFileHandle;
          entries.push({ name: handle.name, path, open: () => fileHandle.getFile() });
          if (entries.length % 200 === 0) onProgress?.(entries.length);
        }
      }
    };
    await walk(root, '');
    entries.sort(byPath);
    return { label: root.name, entries, truncated };
  }

  /** Files from <input type="file"> (single files, or a whole folder via webkitdirectory). */
  fromFileList(files: FileList, label: string): ScanResult {
    const entries: ImageEntry[] = [];
    for (const file of Array.from(files)) {
      const path = file.webkitRelativePath || file.name;
      // Drop the top folder name ("Pictures/a/b.jpg" -> "a/b.jpg") and hidden folders.
      const rel = file.webkitRelativePath ? path.split('/').slice(1).join('/') : path;
      if (rel.split('/').some((part) => part.startsWith('.'))) continue;
      if (!isImageName(file.name) && !file.type.startsWith('image/')) continue;
      entries.push({ name: file.name, path: rel, size: file.size, open: async () => file });
      if (entries.length >= MAX_IMAGES) break;
    }
    entries.sort(byPath);
    const top = files[0]?.webkitRelativePath?.split('/')[0];
    return { label: top || label, entries, truncated: entries.length >= MAX_IMAGES };
  }
}

function base64ToBlob(data: string): Blob {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes]);
}
