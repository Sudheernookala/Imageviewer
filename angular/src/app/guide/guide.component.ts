import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewEncapsulation,
  effect,
  output,
  signal,
  viewChild,
} from '@angular/core';

/** Where relative links in the README point (files that are not part of the site). */
const REPO_URL = 'https://github.com/Sudheernookala/Imageviewer';

/**
 * The in-app Guide: shows the repo README (copied to guide/README.md at build time),
 * so the guide and the README can't drift apart.
 */
@Component({
  selector: 'app-guide',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None, // styles must reach the rendered README
  styleUrl: './guide.component.css',
  template: `
    <dialog #dialog class="guide" aria-labelledby="guide-title"
            (close)="closed.emit()" (pointerdown)="pressedOnBackdrop = $event.target === dialog"
            (click)="onClick($event)">
      <header class="guide-bar">
        <h2 id="guide-title">Setup guide</h2>
        <a class="guide-source" [href]="repoUrl + '#readme'" target="_blank" rel="noopener">View on GitHub</a>
        <button type="button" class="close" (click)="close()" aria-label="Close guide" title="Close (Esc)">✕</button>
      </header>
      <div #body class="guide-body" tabindex="-1">
        @if (error()) {
          <p class="status error">{{ error() }}</p>
        } @else if (!html()) {
          <p class="status">Loading the guide…</p>
        }
        <div #content class="guide-content"></div>
      </div>
    </dialog>
  `,
})
export class GuideComponent {
  readonly closed = output<void>();

  protected readonly repoUrl = REPO_URL;
  protected readonly html = signal('');
  protected readonly error = signal('');
  protected pressedOnBackdrop = false;

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly body = viewChild.required<ElementRef<HTMLElement>>('body');
  private readonly content = viewChild.required<ElementRef<HTMLElement>>('content');
  private loading: Promise<void> | null = null;

  constructor() {
    // The README is our own build-time file; it is parsed and cleaned in render().
    effect(() => {
      const html = this.html();
      if (html) this.content().nativeElement.innerHTML = html;
    });
  }

  open() {
    const dialog = this.dialog().nativeElement;
    if (!dialog.open) dialog.showModal();
    this.body().nativeElement.focus();
    this.loading ??= this.load();
  }

  close() {
    this.dialog().nativeElement.close();
  }

  protected onClick(event: MouseEvent) {
    const dialog = this.dialog().nativeElement;
    if (this.pressedOnBackdrop && event.target === dialog) {
      this.close();
      return;
    }
    // Links to a section of the guide scroll inside it instead of changing the page address.
    const link = (event.target as Element).closest?.('a[href^="#"]');
    if (link && this.body().nativeElement.contains(link)) {
      event.preventDefault();
      const id = decodeURIComponent(link.getAttribute('href')!.slice(1));
      this.body().nativeElement.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'start' });
    }
  }

  private async load() {
    try {
      const [res, { marked }] = await Promise.all([fetch('guide/README.md'), import('marked')]);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.html.set(render(await marked.parse(await res.text(), { gfm: true })));
    } catch (err) {
      this.loading = null; // try again next time
      this.error.set(`Could not load the guide (${(err as Error).message}). Read it on GitHub instead.`);
    }
  }
}

/** Same heading ids as GitHub, so README links like #deploy-to-github-pages work in both. */
function slug(text: string): string {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
}

function render(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, iframe, object, embed, form').forEach((el) => el.remove());
  for (const el of Array.from(doc.body.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('on') || /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
    }
  }
  doc.querySelectorAll('h1, h2, h3, h4').forEach((h) => (h.id = slug(h.textContent ?? '')));
  doc.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href')!;
    if (href.startsWith('#')) return;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) a.setAttribute('href', `${REPO_URL}/blob/HEAD/${href.replace(/^\.\//, '')}`);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener');
  });
  doc.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src')!;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(src)) img.setAttribute('src', `guide/${src.replace(/^\.\//, '')}`);
    img.setAttribute('loading', 'lazy');
  });
  // Wide tables scroll sideways on their own instead of widening the guide.
  doc.querySelectorAll('table').forEach((table) => {
    const wrap = doc.createElement('div');
    wrap.className = 'table-wrap';
    table.replaceWith(wrap);
    wrap.appendChild(table);
  });
  return doc.body.innerHTML;
}
