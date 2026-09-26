'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');

let server;
let base;
let root;

test.before(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'iv-')));
  fs.mkdirSync(path.join(root, 'sub'));
  fs.mkdirSync(path.join(root, '.hidden'));
  fs.writeFileSync(path.join(root, 'b.png'), 'png');
  fs.writeFileSync(path.join(root, 'a10.JPG'), 'jpg');
  fs.writeFileSync(path.join(root, 'a2.tif'), 'tif');
  fs.writeFileSync(path.join(root, 'logo.svg'), '<svg/>');
  fs.writeFileSync(path.join(root, 'notes.txt'), 'text');
  fs.writeFileSync(path.join(os.tmpdir(), 'iv-outside.png'), 'x');
  fs.symlinkSync(os.tmpdir(), path.join(root, 'escape'));

  server = createServer({ root });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const get = (p) => fetch(base + p);
const list = (p) => get(`/api/list?path=${encodeURIComponent(p)}`);

test('lists folders and images only, sorted naturally', async () => {
  const res = await list(root);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.deepStrictEqual(body.dirs.map((d) => d.name), ['sub']); // hidden and escaping link left out
  assert.deepStrictEqual(body.files.map((f) => f.name), ['a2.tif', 'a10.JPG', 'b.png', 'logo.svg']);
  assert.strictEqual(body.parent, null);
  assert.strictEqual(body.files[0].type, 'image/tiff');
});

test('empty path lists the root; relative paths resolve against it', async () => {
  assert.strictEqual((await (await list('')).json()).path, root);
  const sub = await (await list('sub')).json();
  assert.strictEqual(sub.path, path.join(root, 'sub'));
  assert.strictEqual(sub.parent, root);
});

test('a file path lists its folder and selects the file', async () => {
  const body = await (await list(path.join(root, 'b.png'))).json();
  assert.strictEqual(body.path, root);
  assert.strictEqual(body.selected, path.join(root, 'b.png'));
});

test('refuses paths outside the root, including via .. and symlinks', async () => {
  assert.strictEqual((await list(path.join(root, '..'))).status, 403);
  assert.strictEqual((await list('/')).status, 403);
  assert.strictEqual((await list(path.join(root, 'escape'))).status, 403);
  assert.strictEqual((await get(`/api/file?path=${encodeURIComponent(path.join(root, 'escape', 'iv-outside.png'))}`)).status, 403);
});

test('missing path gives 404', async () => {
  assert.strictEqual((await list(path.join(root, 'nope'))).status, 404);
});

test('serves image bytes with the right type and safe headers', async () => {
  const res = await get(`/api/file?path=${encodeURIComponent(path.join(root, 'logo.svg'))}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('content-type'), 'image/svg+xml');
  assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
  assert.strictEqual(await res.text(), '<svg/>');
});

test('does not serve non-image files', async () => {
  const res = await get(`/api/file?path=${encodeURIComponent(path.join(root, 'notes.txt'))}`);
  assert.strictEqual(res.status, 415);
});

test('serves the app and blocks static path traversal', async () => {
  const res = await get('/');
  assert.strictEqual(res.status, 200);
  assert.match(await res.text(), /<image-viewer/);
  assert.strictEqual((await get('/..%2fserver.js')).status, 403);
});
