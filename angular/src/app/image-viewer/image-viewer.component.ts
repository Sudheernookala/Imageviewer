import {
  CUSTOM_ELEMENTS_SCHEMA,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  input,
  output,
  untracked,
  viewChild,
} from '@angular/core';
// The framework-free web component shared with the plain HTML app in ../public.
import { ImageViewer, ImageViewerState } from '../../../../public/viewer/image-viewer.js';

// angular.json copies the TIFF decoder next to index.html as viewer-vendor/.
ImageViewer.vendorBase = 'viewer-vendor/';

/**
 * Angular wrapper for <image-viewer>.
 *
 *   <app-image-viewer [source]="fileOrUrl" [filename]="name"
 *                     (loaded)="onLoad($event)" (failed)="onError($event)" />
 *
 * For zoom/rotate from code, grab it with viewChild and use `.viewer`.
 */
@Component({
  selector: 'app-image-viewer',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<image-viewer #el (imageload)="onLoad($event)" (imageerror)="onError($event)"></image-viewer>`,
  styles: `
    :host { display: flex; min-width: 0; min-height: 0; }
    image-viewer { flex: 1; min-width: 0; }
  `,
})
export class ImageViewerComponent {
  /** URL, File/Blob, or null to clear. */
  readonly source = input<string | Blob | null>(null);
  /** Name used to detect the type (needed for TIFF when the URL has no extension). */
  readonly filename = input<string>();

  readonly loaded = output<ImageViewerState>();
  readonly failed = output<string>();

  private readonly el = viewChild.required<ElementRef<ImageViewer>>('el');

  /** The underlying element: zoomIn(), fit(), rotate(), setPage(), state, ... */
  get viewer(): ImageViewer {
    return this.el().nativeElement;
  }

  constructor() {
    afterRenderEffect(() => {
      const source = this.source();
      const filename = this.filename();
      untracked(() => {
        if (source) this.viewer.load(source, { filename });
        else this.viewer.clear();
      });
    });
  }

  protected onLoad(e: Event) {
    this.loaded.emit((e as CustomEvent<ImageViewerState>).detail);
  }

  protected onError(e: Event) {
    this.failed.emit((e as CustomEvent<{ message: string }>).detail.message);
  }
}
