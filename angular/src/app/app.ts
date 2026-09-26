import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { FileSourceService, ScanResult } from './file-source.service';
import { ImageEntry, formatSize } from './image-files';
import { ImageViewerComponent } from './image-viewer/image-viewer.component';

/** Rendering tens of thousands of rows freezes the page; the filter narrows it down. */
const MAX_ROWS = 1000;

@Component({
  selector: 'app-root',
  imports: [ImageViewerComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly files = inject(FileSourceService);
  protected readonly canPickDirectory = this.files.canPickDirectory;
  protected readonly formatSize = formatSize;

  protected readonly label = signal('');
  protected readonly entries = signal<ImageEntry[]>([]);
  protected readonly truncated = signal(false);
  protected readonly filter = signal('');
  protected readonly selected = signal<ImageEntry | null>(null);
  protected readonly source = signal<string | Blob | null>(null);
  protected readonly filename = signal<string | undefined>(undefined);
  protected readonly status = signal('');
  protected readonly error = signal('');
  protected readonly busy = signal(false);

  protected readonly filtered = computed(() => {
    const q = this.filter().trim().toLowerCase();
    const all = this.entries();
    return q ? all.filter((e) => e.path.toLowerCase().includes(q)) : all;
  });
  protected readonly rows = computed(() => this.filtered().slice(0, MAX_ROWS));

  private readonly folderInput = viewChild.required<ElementRef<HTMLInputElement>>('folderInput');
  private readonly filesInput = viewChild.required<ElementRef<HTMLInputElement>>('filesInput');
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');
  private openToken = 0;

  constructor() {
    // Show something straight away: the bundled samples.
    this.show(this.files.samples());
  }

  protected async openFolder() {
    if (!this.canPickDirectory) {
      this.folderInput().nativeElement.click();
      return;
    }
    this.busy.set(true);
    this.setStatus('Reading folder…');
    try {
      const result = await this.files.pickDirectory((n) => this.setStatus(`Reading folder… ${n} images found`));
      if (result) this.show(result);
      else this.setStatus(this.summary());
    } catch (err) {
      this.setError(`Could not read the folder: ${(err as Error).message}`);
    } finally {
      this.busy.set(false);
    }
  }

  protected openFiles() {
    this.filesInput().nativeElement.click();
  }

  protected onInputChange(event: Event, label: string) {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) this.show(this.files.fromFileList(input.files, label));
    input.value = ''; // allow picking the same folder again
  }

  protected showSamples() {
    this.show(this.files.samples());
  }

  protected openUrl(event: Event, url: string) {
    event.preventDefault();
    url = url.trim();
    if (!url) return;
    const name = decodeURIComponent(new URL(url, document.baseURI).pathname.split('/').pop() || url);
    const entry: ImageEntry = { name, path: url, open: async () => url };
    this.label.set('Web address');
    this.entries.set([entry]);
    this.truncated.set(false);
    this.filter.set('');
    this.select(entry);
  }

  protected async select(entry: ImageEntry) {
    const token = ++this.openToken;
    this.selected.set(entry);
    this.error.set('');
    try {
      const source = await entry.open();
      if (token !== this.openToken) return;
      this.filename.set(entry.name);
      this.source.set(source);
    } catch (err) {
      if (token === this.openToken) this.setError(`Could not open ${entry.name}: ${(err as Error).message}`);
    }
  }

  protected onLoaded() {
    this.error.set('');
    this.setStatus(this.summary());
  }

  protected onFailed(message: string) {
    this.setError(message);
  }

  /** Up/Down arrows move through the list and open the image. */
  protected onListKey(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const rows = this.rows();
    const current = this.selected();
    const i = current ? rows.indexOf(current) : -1;
    const next = rows[Math.min(rows.length - 1, Math.max(0, i + (event.key === 'ArrowDown' ? 1 : -1)))];
    if (next && next !== current) {
      this.select(next);
      queueMicrotask(() =>
        this.list()?.nativeElement.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' })
      );
    }
  }

  protected folderOf(entry: ImageEntry): string {
    const i = entry.path.lastIndexOf('/');
    return i > 0 ? entry.path.slice(0, i) : '';
  }

  private show(result: ScanResult) {
    this.openToken++;
    this.label.set(result.label);
    this.entries.set(result.entries);
    this.truncated.set(result.truncated);
    this.filter.set('');
    this.error.set('');
    this.setStatus(this.summary());
    if (result.entries.length) this.select(result.entries[0]);
    else {
      this.selected.set(null);
      this.source.set(null);
    }
  }

  private summary(): string {
    const n = this.entries().length;
    const more = this.truncated() ? ' (stopped at the limit — open a smaller folder)' : '';
    return n ? `${n} image${n === 1 ? '' : 's'}${more}` : 'No images found in this folder';
  }

  private setStatus(text: string) {
    this.status.set(text);
  }

  private setError(text: string) {
    this.error.set(text);
  }
}
