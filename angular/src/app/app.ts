import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { ImageViewerState } from '../../../public/viewer/image-viewer.js';
import { FileSourceService, ScanResult } from './file-source.service';
import { ImageEntry, formatSize } from './image-files';
import { ImageViewerComponent } from './image-viewer/image-viewer.component';

/** Rendering tens of thousands of rows freezes the page; the filter narrows it down. */
const MAX_ROWS = 1000;

/** "Open image from a web address" is hidden for now. Set to true to bring it back. */
const SHOW_URL_INPUT = false;

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
  protected readonly showUrlInput = SHOW_URL_INPUT;

  protected readonly label = signal('');
  protected readonly entries = signal<ImageEntry[]>([]);
  protected readonly truncated = signal(false);
  protected readonly filter = signal('');
  protected readonly status = signal('');
  protected readonly error = signal('');
  protected readonly busy = signal(false);

  // Popup viewer state
  protected readonly current = signal<ImageEntry | null>(null);
  protected readonly source = signal<string | Blob | null>(null);
  protected readonly filename = signal<string | undefined>(undefined);
  protected readonly imageInfo = signal('');
  protected readonly viewerError = signal('');

  protected readonly filtered = computed(() => {
    const q = this.filter().trim().toLowerCase();
    const all = this.entries();
    return q ? all.filter((e) => e.path.toLowerCase().includes(q)) : all;
  });
  protected readonly rows = computed(() => this.filtered().slice(0, MAX_ROWS));
  /** Position of the open image in the (filtered) list, for "3 / 7" and prev/next. */
  protected readonly position = computed(() => {
    const cur = this.current();
    return cur ? this.filtered().indexOf(cur) : -1;
  });

  private readonly folderInput = viewChild.required<ElementRef<HTMLInputElement>>('folderInput');
  private readonly filesInput = viewChild.required<ElementRef<HTMLInputElement>>('filesInput');
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');
  private openToken = 0;

  constructor() {
    // Show something straight away: the bundled samples.
    this.showSamples();
  }

  protected async openFolder() {
    if (!this.canPickDirectory) {
      this.folderInput().nativeElement.click();
      return;
    }
    this.busy.set(true);
    this.status.set('Reading folder…');
    try {
      const result = await this.files.pickDirectory((n) => this.status.set(`Reading folder… ${n} images found`));
      if (result) this.show(result);
      else this.status.set(this.summary());
    } catch (err) {
      this.error.set(`Could not read the folder: ${(err as Error).message}`);
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

  protected async showSamples() {
    try {
      this.show(await this.files.samples());
    } catch (err) {
      this.error.set((err as Error).message);
    }
  }

  protected openUrl(event: Event, url: string) {
    event.preventDefault();
    url = url.trim();
    if (!url) return;
    const name = decodeURIComponent(new URL(url, document.baseURI).pathname.split('/').pop() || url);
    const entry: ImageEntry = { name, path: url, open: async () => url };
    this.show({ label: 'Web address', entries: [entry], truncated: false });
    this.openViewer(entry);
  }

  /** Open an image in the popup viewer. */
  protected async openViewer(entry: ImageEntry) {
    const token = ++this.openToken;
    this.current.set(entry);
    this.imageInfo.set('');
    this.viewerError.set('');
    const dialog = this.dialog().nativeElement;
    if (!dialog.open) dialog.showModal();
    try {
      const source = await entry.open();
      if (token !== this.openToken) return;
      this.filename.set(entry.name);
      this.source.set(source);
    } catch (err) {
      if (token === this.openToken) this.viewerError.set(`Could not open ${entry.name}: ${(err as Error).message}`);
    }
  }

  protected step(delta: number) {
    const list = this.filtered();
    const next = list[this.position() + delta];
    if (next) this.openViewer(next);
  }

  protected closeViewer() {
    this.dialog().nativeElement.close();
  }

  /** Runs however the popup closes (button, Esc, backdrop click). */
  protected onDialogClosed() {
    this.openToken++;
    const last = this.current();
    this.source.set(null); // free the image
    this.current.set(null);
    // Put keyboard focus back on the row that was open.
    if (last) {
      queueMicrotask(() =>
        this.list()?.nativeElement.querySelector<HTMLElement>(`[data-path="${CSS.escape(last.path)}"]`)?.focus()
      );
    }
  }

  protected onDialogKey(event: KeyboardEvent) {
    // The viewer keeps arrow keys for panning when the image has focus; elsewhere they switch images.
    if (event.key === 'ArrowRight') this.step(1);
    else if (event.key === 'ArrowLeft') this.step(-1);
    else return;
    event.preventDefault();
  }

  /**
   * Clicking the dark area around the popup closes it. The press must start there too,
   * so dragging the image and releasing outside the popup does not close it.
   */
  private pressedOnBackdrop = false;
  protected onDialogPointerDown(event: PointerEvent) {
    this.pressedOnBackdrop = event.target === this.dialog().nativeElement;
  }
  protected onDialogClick(event: MouseEvent) {
    if (this.pressedOnBackdrop && event.target === this.dialog().nativeElement) this.closeViewer();
    this.pressedOnBackdrop = false;
  }

  protected onLoaded(state: ImageViewerState) {
    const pages = state.pages > 1 ? ` · ${state.pages} pages` : '';
    this.imageInfo.set(`${state.width} × ${state.height} · ${state.format.toUpperCase()}${pages}`);
  }

  protected onFailed(message: string) {
    this.viewerError.set(message);
  }

  /** Up/Down arrows move through the list; Enter opens the image. */
  protected onListKey(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = Array.from(this.list()?.nativeElement.querySelectorAll<HTMLElement>('button') ?? []);
    const i = buttons.indexOf(document.activeElement as HTMLElement);
    const next = buttons[i + (event.key === 'ArrowDown' ? 1 : -1)];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  }

  protected folderOf(entry: ImageEntry): string {
    const i = entry.path.lastIndexOf('/');
    return i > 0 ? entry.path.slice(0, i) : '';
  }

  protected typeOf(entry: ImageEntry): string {
    const dot = entry.name.lastIndexOf('.');
    return dot > 0 ? entry.name.slice(dot + 1).toUpperCase() : '';
  }

  private show(result: ScanResult) {
    this.label.set(result.label);
    this.entries.set(result.entries);
    this.truncated.set(result.truncated);
    this.filter.set('');
    this.error.set('');
    this.status.set(this.summary());
  }

  private summary(): string {
    const n = this.entries().length;
    const more = this.truncated() ? ' (stopped at the limit — open a smaller folder)' : '';
    return n ? `${n} image${n === 1 ? '' : 's'}${more}` : 'No images found in this folder';
  }
}
