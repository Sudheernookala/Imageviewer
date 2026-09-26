// Type declarations for image-viewer.js (for TypeScript / Angular users).

export interface ImageViewerState {
  width: number;
  height: number;
  scale: number;
  rotation: number;
  page: number;
  pages: number;
  format: string;
}

export type ImageSource = string | Blob | ArrayBuffer;

export declare class ImageViewer extends HTMLElement {
  /** Folder holding UTIF.js + pako_inflate.min.js. Default: ./vendor/ next to image-viewer.js. */
  static vendorBase: string;
  src: string;
  readonly state: ImageViewerState;
  load(source: ImageSource, opts?: { filename?: string }): Promise<void>;
  clear(): void;
  zoomIn(): void;
  zoomOut(): void;
  zoomTo(scale: number, x?: number, y?: number): void;
  fit(): void;
  actualSize(): void;
  rotate(deg?: number): void;
  setPage(index: number): Promise<void>;
}

declare global {
  interface HTMLElementTagNameMap {
    'image-viewer': ImageViewer;
  }
  interface HTMLElementEventMap {
    imageload: CustomEvent<ImageViewerState>;
    imageerror: CustomEvent<{ message: string }>;
  }
}
