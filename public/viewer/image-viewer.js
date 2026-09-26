// <image-viewer> — a drop-in image viewer web component. No framework needed.
//
//   <script type="module" src="viewer/image-viewer.js"></script>
//   <image-viewer src="photo.tif"></image-viewer>
//
// Formats: everything the browser can show natively (PNG, JPEG, GIF, WebP,
// AVIF, BMP, ICO, SVG, ...) plus TIFF, which is decoded in the browser with
// UTIF.js (loaded on demand from ./vendor/ next to this file).
//
// Attributes:  src, filename (type hint when the URL has no extension), no-toolbar
// Methods:     load(source, {filename}), clear(), zoomIn(), zoomOut(), zoomTo(scale),
//              fit(), actualSize(), rotate(deg), setPage(index)
// Events:      imageload  (detail: {width, height, pages, page, format})
//              imageerror (detail: {message})

const TIFF_EXT = /\.(tiff?)(?:$|[?#])/i;
const VENDOR_BASE = new URL('./vendor/', import.meta.url);
const MIN_SCALE = 0.02;
const MAX_SCALE = 64;

let tiffLibPromise = null;

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${url}`));
    document.head.appendChild(s);
  });
}

function loadTiffLib() {
  if (!tiffLibPromise) {
    tiffLibPromise = (async () => {
      if (!window.pako) await loadScript(new URL('pako_inflate.min.js', VENDOR_BASE));
      if (!window.UTIF) await loadScript(new URL('UTIF.js', VENDOR_BASE));
      return window.UTIF;
    })().catch((err) => {
      tiffLibPromise = null;
      throw err;
    });
  }
  return tiffLibPromise;
}

function isTiffBytes(buf) {
  const b = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  return (
    b.length === 4 &&
    ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) || // II*\0
      (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a)) // MM\0*
  );
}

function extOf(name) {
  const m = /\.([a-z0-9]+)(?:$|[?#])/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

const ICONS = {
  zoomOut: '<path d="M5 12h14"/>',
  zoomIn: '<path d="M5 12h14M12 5v14"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  actual: '<text x="12" y="16" text-anchor="middle" font-size="10" font-family="system-ui,sans-serif" stroke="none" fill="currentColor">1:1</text>',
  rotL: '<path d="M4 4v6h6"/><path d="M4.5 10A8 8 0 1 1 6 16.5"/>',
  rotR: '<path d="M20 4v6h-6"/><path d="M19.5 10A8 8 0 1 0 18 16.5"/>',
  prev: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
};
const icon = (k) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`;

const TEMPLATE = `
<style>
  :host {
    --iv-bg: #1e1f22;
    --iv-fg: #e8e8ea;
    --iv-muted: #9a9ba1;
    --iv-toolbar-bg: #2a2b2f;
    --iv-border: #3a3b40;
    --iv-accent: #5b9dff;
    --iv-checker: #2a2b2f;
    display: flex;
    flex-direction: column;
    position: relative;
    min-height: 200px;
    background: var(--iv-bg);
    color: var(--iv-fg);
    font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
    overflow: hidden;
    contain: strict;
  }
  @media (prefers-color-scheme: light) {
    :host {
      --iv-bg: #f3f3f5;
      --iv-fg: #1d1d20;
      --iv-muted: #6a6b70;
      --iv-toolbar-bg: #ffffff;
      --iv-border: #d9d9de;
      --iv-checker: #e4e4e8;
    }
  }
  .toolbar {
    display: flex; align-items: center; gap: 2px; flex-wrap: wrap;
    padding: 4px 6px;
    background: var(--iv-toolbar-bg);
    border-bottom: 1px solid var(--iv-border);
  }
  :host([no-toolbar]) .toolbar { display: none; }
  button {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 30px; height: 30px; padding: 0 6px;
    border: 0; border-radius: 6px; background: transparent; color: inherit; cursor: pointer;
  }
  button:hover:not(:disabled) { background: var(--iv-border); }
  button:focus-visible { outline: 2px solid var(--iv-accent); outline-offset: -2px; }
  button:disabled { opacity: .35; cursor: default; }
  .zoom { min-width: 52px; font-variant-numeric: tabular-nums; }
  .sep { width: 1px; height: 18px; background: var(--iv-border); margin: 0 4px; }
  .pages { display: none; align-items: center; gap: 2px; }
  .pages.show { display: inline-flex; }
  .info { margin-left: auto; color: var(--iv-muted); padding: 0 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .stage {
    position: relative; flex: 1; overflow: hidden; cursor: grab; touch-action: none; outline: none;
    background-color: var(--iv-bg);
    background-image:
      linear-gradient(45deg, var(--iv-checker) 25%, transparent 25%, transparent 75%, var(--iv-checker) 75%),
      linear-gradient(45deg, var(--iv-checker) 25%, transparent 25%, transparent 75%, var(--iv-checker) 75%);
    background-size: 20px 20px; background-position: 0 0, 10px 10px;
  }
  .stage.dragging { cursor: grabbing; }
  img {
    position: absolute; left: 50%; top: 50%;
    max-width: none; user-select: none; -webkit-user-drag: none;
    transform-origin: 50% 50%;
    visibility: hidden;
  }
  img.shown { visibility: visible; }
  img.pixelated { image-rendering: pixelated; }
  .message {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    padding: 24px; text-align: center; color: var(--iv-muted); pointer-events: none;
    background: var(--iv-bg);
  }
  .message[hidden] { display: none; }
  .message.error { color: #e5484d; }
</style>
<div class="toolbar" part="toolbar">
  <button data-act="zoomOut" title="Zoom out (-)" aria-label="Zoom out">${icon('zoomOut')}</button>
  <button data-act="zoomReset" class="zoom" title="Zoom level" aria-label="Zoom level">–</button>
  <button data-act="zoomIn" title="Zoom in (+)" aria-label="Zoom in">${icon('zoomIn')}</button>
  <span class="sep"></span>
  <button data-act="fit" title="Fit to window (0)" aria-label="Fit to window">${icon('fit')}</button>
  <button data-act="actualSize" title="Actual size (1)" aria-label="Actual size">${icon('actual')}</button>
  <span class="sep"></span>
  <button data-act="rotL" title="Rotate left (Shift+R)" aria-label="Rotate left">${icon('rotL')}</button>
  <button data-act="rotR" title="Rotate right (R)" aria-label="Rotate right">${icon('rotR')}</button>
  <span class="pages">
    <span class="sep"></span>
    <button data-act="prevPage" title="Previous page" aria-label="Previous page">${icon('prev')}</button>
    <span class="page-label"></span>
    <button data-act="nextPage" title="Next page" aria-label="Next page">${icon('next')}</button>
  </span>
  <span class="info"></span>
</div>
<div class="stage" part="stage" tabindex="0">
  <img alt="" draggable="false" part="image">
  <div class="message">No image selected</div>
</div>
`;

export class ImageViewer extends HTMLElement {
  static get observedAttributes() {
    return ['src', 'filename'];
  }

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = TEMPLATE;
    this._stage = root.querySelector('.stage');
    this._img = root.querySelector('img');
    this._msg = root.querySelector('.message');
    this._zoomLabel = root.querySelector('.zoom');
    this._info = root.querySelector('.info');
    this._pagesBox = root.querySelector('.pages');
    this._pageLabel = root.querySelector('.page-label');
    this._buttons = root.querySelectorAll('.toolbar button');

    this._token = 0; // increments on every load; stale loads are ignored
    this._objectUrls = [];
    this._reset();

    root.querySelector('.toolbar').addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (!act) return;
      const actions = {
        zoomOut: () => this.zoomOut(),
        zoomIn: () => this.zoomIn(),
        zoomReset: () => (this._mode === 'fit' ? this.actualSize() : this.fit()),
        fit: () => this.fit(),
        actualSize: () => this.actualSize(),
        rotL: () => this.rotate(-90),
        rotR: () => this.rotate(90),
        prevPage: () => this.setPage(this._page - 1),
        nextPage: () => this.setPage(this._page + 1),
      };
      actions[act]?.();
    });

    this._bindPointer();
    this._stage.addEventListener('keydown', (e) => this._onKey(e));
    this._resizeObserver = new ResizeObserver(() => {
      if (this._mode === 'fit') this.fit();
      else this._render();
    });
  }

  connectedCallback() {
    this._resizeObserver.observe(this._stage);
    this._updateControls();
  }

  disconnectedCallback() {
    this._resizeObserver.disconnect();
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (oldVal === newVal) return;
    if (name === 'src') {
      if (newVal) this.load(newVal, { filename: this.getAttribute('filename') || undefined });
      else this.clear();
    }
  }

  get src() {
    return this.getAttribute('src') || '';
  }
  set src(v) {
    if (v) this.setAttribute('src', v);
    else this.removeAttribute('src');
  }

  /** Current state, handy for integrations. */
  get state() {
    return {
      width: this._w,
      height: this._h,
      scale: this._scale,
      rotation: this._rot,
      page: this._page,
      pages: this._pages.length || (this._w ? 1 : 0),
      format: this._format,
    };
  }

  /**
   * Show an image.
   * @param {string|Blob|ArrayBuffer} source  URL, File/Blob, or raw bytes
   * @param {{filename?: string}} [opts]      name used to detect the type
   */
  async load(source, opts = {}) {
    const token = ++this._token;
    this._reset();
    this._showMessage('Loading…');
    const filename = opts.filename || (source instanceof File ? source.name : typeof source === 'string' ? source : '');
    this._format = extOf(filename);

    try {
      let bytes = null;
      let url = null;
      if (source instanceof ArrayBuffer) bytes = source;
      else if (source instanceof Blob) {
        if (TIFF_EXT.test(filename) || source.type === 'image/tiff') bytes = await source.arrayBuffer();
        else url = this._track(URL.createObjectURL(source));
      } else if (typeof source === 'string') {
        if (TIFF_EXT.test(filename)) bytes = await this._fetchBytes(source);
        else url = source;
      } else {
        throw new Error('Unsupported source');
      }
      if (token !== this._token) return;

      if (url) {
        try {
          await this._showUrl(url, token);
          return;
        } catch (err) {
          if (token !== this._token) return;
          // The browser could not decode it. Maybe it is a TIFF with a wrong extension.
          bytes = source instanceof Blob ? await source.arrayBuffer() : await this._fetchBytes(url);
          if (token !== this._token) return;
          if (!isTiffBytes(bytes)) throw err;
        }
      }

      if (!isTiffBytes(bytes)) {
        // Not a TIFF after all: let the browser try.
        const blobUrl = this._track(URL.createObjectURL(new Blob([bytes])));
        await this._showUrl(blobUrl, token);
        return;
      }
      await this._openTiff(bytes, token);
    } catch (err) {
      if (token !== this._token) return;
      const ext = this._format ? `.${this._format}` : 'this file';
      const message =
        err && err.message && !/^decode|^Image load failed/i.test(err.message)
          ? err.message
          : `This browser cannot display ${ext}.`;
      this._showMessage(message, true);
      this._emit('imageerror', { message });
    }
  }

  clear() {
    this._token++;
    this._reset();
    this._showMessage('No image selected');
  }

  zoomIn() {
    this.zoomTo(this._scale * 1.25);
  }
  zoomOut() {
    this.zoomTo(this._scale / 1.25);
  }

  /** Zoom to a scale (1 = 100%), keeping the point (x, y) in the stage fixed. */
  zoomTo(scale, x, y) {
    if (!this._w) return;
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
    const rect = this._stage.getBoundingClientRect();
    // Point relative to stage centre; defaults to the centre.
    const px = x === undefined ? 0 : x - rect.width / 2;
    const py = y === undefined ? 0 : y - rect.height / 2;
    const k = next / this._scale;
    this._tx = px - k * (px - this._tx);
    this._ty = py - k * (py - this._ty);
    this._scale = next;
    this._mode = 'free';
    this._render();
  }

  fit() {
    if (!this._w) return;
    const { width, height } = this._stage.getBoundingClientRect();
    if (!width || !height) return;
    const [w, h] = this._rotatedSize();
    const pad = 16;
    this._scale = Math.max(MIN_SCALE, Math.min(1, (width - pad) / w, (height - pad) / h));
    this._tx = 0;
    this._ty = 0;
    this._mode = 'fit';
    this._render();
  }

  actualSize() {
    if (!this._w) return;
    this._scale = 1;
    this._tx = 0;
    this._ty = 0;
    this._mode = 'free';
    this._render();
  }

  rotate(deg = 90) {
    if (!this._w) return;
    this._rot = (((this._rot + deg) % 360) + 360) % 360;
    if (this._mode === 'fit') this.fit();
    else this._render();
  }

  /** Multi-page TIFF: show page `index` (0-based). */
  async setPage(index) {
    if (!this._pages.length || index < 0 || index >= this._pages.length || index === this._page) return;
    const token = this._token;
    try {
      await this._showTiffPage(index, token);
    } catch (err) {
      if (token === this._token) this._emit('imageerror', { message: err.message });
    }
  }

  // ---------- internals ----------

  _reset() {
    for (const u of this._objectUrls) URL.revokeObjectURL(u);
    this._objectUrls = [];
    this._w = 0;
    this._h = 0;
    this._scale = 1;
    this._tx = 0;
    this._ty = 0;
    this._rot = 0;
    this._mode = 'fit';
    this._format = '';
    this._tiff = null;
    this._pages = [];
    this._pageUrls = [];
    this._page = 0;
    this._img.classList.remove('shown');
    this._img.removeAttribute('src');
    if (this._info) this._updateControls();
  }

  _track(url) {
    this._objectUrls.push(url);
    return url;
  }

  async _fetchBytes(url) {
    const res = await fetch(url);
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.json()).error;
      } catch {
        /* not JSON */
      }
      throw new Error(detail || `Could not load image (HTTP ${res.status})`);
    }
    return res.arrayBuffer();
  }

  async _showUrl(url, token) {
    const img = this._img;
    const done = new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('Image load failed'));
    });
    img.src = url;
    await done;
    if (token !== this._token) return;
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (!w || !h) {
      // SVG without width/height: fall back to a sensible size.
      w = 800;
      h = 600;
    }
    this._displayed(w, h);
  }

  async _openTiff(bytes, token) {
    const UTIF = await loadTiffLib();
    if (token !== this._token) return;
    const ifds = UTIF.decode(bytes);
    const pages = ifds.filter((ifd) => ifd.t256 && ifd.t257); // must have width + height
    if (!pages.length) throw new Error('TIFF file has no readable images.');
    this._tiff = { UTIF, bytes };
    this._pages = pages;
    this._pageUrls = new Array(pages.length);
    if (!/^tiff?$/.test(this._format)) this._format = 'tiff';
    this._page = -1;
    await this._showTiffPage(0, token);
  }

  async _showTiffPage(index, token) {
    const { UTIF, bytes } = this._tiff;
    let url = this._pageUrls[index];
    if (!url) {
      const ifd = this._pages[index];
      UTIF.decodeImage(bytes, ifd);
      const rgba = UTIF.toRGBA8(ifd);
      const canvas = document.createElement('canvas');
      canvas.width = ifd.width;
      canvas.height = ifd.height;
      canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, 0, ifd.width * ifd.height * 4), ifd.width, ifd.height), 0, 0);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      if (token !== this._token) return;
      if (!blob) throw new Error('Could not render TIFF page.');
      url = this._pageUrls[index] = this._track(URL.createObjectURL(blob));
    }
    const keepView = this._page >= 0;
    this._page = index;
    const img = this._img;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('Could not render TIFF page.'));
      img.src = url;
    });
    if (token !== this._token) return;
    this._displayed(img.naturalWidth, img.naturalHeight, keepView);
  }

  _displayed(w, h, keepView = false) {
    this._w = w;
    this._h = h;
    this._msg.hidden = true;
    this._img.classList.add('shown');
    if (!keepView) this._rot = 0;
    this.fit();
    this._updateControls();
    this._emit('imageload', { ...this.state });
  }

  _rotatedSize() {
    return this._rot % 180 === 0 ? [this._w, this._h] : [this._h, this._w];
  }

  _render() {
    if (!this._w) return;
    const w = this._w * this._scale;
    const h = this._h * this._scale;
    const s = this._img.style;
    // Size the element itself (not a CSS scale) so SVGs stay sharp at any zoom.
    s.width = `${w}px`;
    s.height = `${h}px`;
    s.marginLeft = `${-w / 2}px`;
    s.marginTop = `${-h / 2}px`;
    s.transform = `translate(${this._tx}px, ${this._ty}px) rotate(${this._rot}deg)`;
    this._img.classList.toggle('pixelated', this._scale >= 3 && this._format !== 'svg');
    this._updateControls();
  }

  _updateControls() {
    const has = this._w > 0;
    for (const b of this._buttons) b.disabled = !has;
    this._zoomLabel.textContent = has ? `${Math.round(this._scale * 100)}%` : '–';
    this._info.textContent = has ? `${this._w} × ${this._h}${this._format ? ` · ${this._format.toUpperCase()}` : ''}` : '';
    const multi = this._pages.length > 1;
    this._pagesBox.classList.toggle('show', multi);
    if (multi) {
      this._pageLabel.textContent = `${this._page + 1} / ${this._pages.length}`;
      this._pagesBox.querySelector('[data-act=prevPage]').disabled = this._page <= 0;
      this._pagesBox.querySelector('[data-act=nextPage]').disabled = this._page >= this._pages.length - 1;
    }
  }

  _showMessage(text, isError = false) {
    this._msg.textContent = text;
    this._msg.classList.toggle('error', isError);
    this._msg.hidden = false;
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  _bindPointer() {
    const stage = this._stage;
    const pointers = new Map();
    let pinchStart = null;

    stage.addEventListener(
      'wheel',
      (e) => {
        if (!this._w) return;
        e.preventDefault();
        const rect = stage.getBoundingClientRect();
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
        this.zoomTo(this._scale * factor, e.clientX - rect.left, e.clientY - rect.top);
      },
      { passive: false }
    );

    stage.addEventListener('pointerdown', (e) => {
      if (!this._w || e.button !== 0) return;
      stage.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      stage.classList.add('dragging');
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: this._scale };
      }
    });

    stage.addEventListener('pointermove', (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, cur);
      if (pointers.size === 2 && pinchStart) {
        const [a, b] = [...pointers.values()];
        const rect = stage.getBoundingClientRect();
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        this.zoomTo(pinchStart.scale * (dist / pinchStart.dist), (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
      } else if (pointers.size === 1) {
        this._tx += cur.x - prev.x;
        this._ty += cur.y - prev.y;
        this._mode = 'free';
        this._render();
      }
    });

    const end = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchStart = null;
      if (!pointers.size) stage.classList.remove('dragging');
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);

    stage.addEventListener('dblclick', (e) => {
      if (!this._w) return;
      if (this._mode === 'fit') {
        const rect = stage.getBoundingClientRect();
        this.zoomTo(Math.max(1, this._scale * 2), e.clientX - rect.left, e.clientY - rect.top);
      } else {
        this.fit();
      }
    });
  }

  _onKey(e) {
    if (!this._w || e.ctrlKey || e.metaKey || e.altKey) return;
    const step = 40;
    const keys = {
      '+': () => this.zoomIn(),
      '=': () => this.zoomIn(),
      '-': () => this.zoomOut(),
      '0': () => this.fit(),
      '1': () => this.actualSize(),
      r: () => this.rotate(90),
      R: () => this.rotate(-90),
      PageUp: () => this.setPage(this._page - 1),
      PageDown: () => this.setPage(this._page + 1),
      ArrowLeft: () => this._pan(step, 0),
      ArrowRight: () => this._pan(-step, 0),
      ArrowUp: () => this._pan(0, step),
      ArrowDown: () => this._pan(0, -step),
    };
    const fn = keys[e.key];
    if (fn) {
      e.preventDefault();
      e.stopPropagation();
      fn();
    }
  }

  _pan(dx, dy) {
    this._tx += dx;
    this._ty += dy;
    this._mode = 'free';
    this._render();
  }
}

if (!customElements.get('image-viewer')) {
  customElements.define('image-viewer', ImageViewer);
}
