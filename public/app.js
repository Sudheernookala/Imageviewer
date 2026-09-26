// Demo app: browse folders through the server API and show images in <image-viewer>.

const $ = (id) => document.getElementById(id);
const pathInput = $('path');
const list = $('list');
const status = $('status');
const filter = $('filter');
const viewer = $('viewer');

let current = null; // last /api/list response
let selectedPath = null;

const fileUrl = (p) => `/api/file?path=${encodeURIComponent(p)}`;

function formatSize(bytes) {
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

function setStatus(text, isError = false) {
  status.textContent = text;
  status.classList.toggle('error', isError);
}

async function openPath(p) {
  setStatus('Loading…');
  let data;
  try {
    const res = await fetch(`/api/list?path=${encodeURIComponent(p || '')}`);
    data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  } catch (err) {
    setStatus(err.message, true);
    return;
  }
  current = data;
  pathInput.value = data.path;
  filter.value = '';
  try {
    localStorage.setItem('imageviewer.path', data.path);
  } catch {
    /* storage unavailable */
  }
  renderList();
  if (data.selected) selectFile(data.selected);
  else if (!data.files.some((f) => f.path === selectedPath)) {
    selectedPath = null;
    viewer.clear();
  }
}

function renderList() {
  if (!current) return;
  const q = filter.value.trim().toLowerCase();
  const match = (e) => !q || e.name.toLowerCase().includes(q);
  const dirs = current.dirs.filter(match);
  const files = current.files.filter(match);

  list.replaceChildren(
    ...dirs.map((d) => item('📁', d.name, '', () => openPath(d.path), d.path, 'dir')),
    ...files.map((f) => item('🖼️', f.name, formatSize(f.size), () => selectFile(f.path), f.path, 'file'))
  );
  $('up').disabled = !current.parent;
  const n = current.files.length;
  setStatus(`${n} image${n === 1 ? '' : 's'}, ${current.dirs.length} folder${current.dirs.length === 1 ? '' : 's'}`);
  markSelected();
}

function item(icon, name, meta, onActivate, path, kind) {
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.path = path;
  btn.dataset.kind = kind;
  btn.title = name;
  btn.innerHTML = '<span class="ico"></span><span class="name"></span><span class="meta"></span>';
  btn.querySelector('.ico').textContent = icon;
  btn.querySelector('.name').textContent = name;
  btn.querySelector('.meta').textContent = meta;
  btn.addEventListener('click', onActivate);
  li.appendChild(btn);
  return li;
}

function selectFile(p) {
  selectedPath = p;
  const file = current?.files.find((f) => f.path === p);
  viewer.load(fileUrl(p), { filename: file ? file.name : p });
  markSelected();
}

function markSelected() {
  for (const btn of list.querySelectorAll('button')) {
    const on = btn.dataset.path === selectedPath;
    btn.setAttribute('aria-current', on ? 'true' : 'false');
    if (on) btn.scrollIntoView({ block: 'nearest' });
  }
}

// Arrow keys move through the list; images open as you go.
list.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const buttons = [...list.querySelectorAll('button')];
  const i = buttons.indexOf(document.activeElement);
  const next = buttons[i + (e.key === 'ArrowDown' ? 1 : -1)];
  if (!next) return;
  e.preventDefault();
  next.focus();
  if (next.dataset.kind === 'file') selectFile(next.dataset.path);
});

$('path-form').addEventListener('submit', (e) => {
  e.preventDefault();
  openPath(pathInput.value.trim());
});
$('up').addEventListener('click', () => current?.parent && openPath(current.parent));
filter.addEventListener('input', renderList);
viewer.addEventListener('imageerror', (e) => setStatus(e.detail.message, true));

// Start from ?path=..., the last folder used, or the server's root folder.
let start = new URLSearchParams(location.search).get('path');
if (!start) {
  try {
    start = localStorage.getItem('imageviewer.path');
  } catch {
    /* storage unavailable */
  }
}
openPath(start || '').then(() => {
  // The saved folder may no longer exist: fall back to the root.
  if (!current && start) openPath('');
});
