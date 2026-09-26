#!/usr/bin/env node
// Minimal image-browser server. No dependencies: Node built-ins only.
//
//   GET /api/list?path=<dir or file>  -> JSON listing of folders + image files
//   GET /api/file?path=<file>         -> raw image bytes
//   everything else                   -> static files from ./public
//
// Only paths inside ROOT can be read. ROOT defaults to your home folder.

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const IMAGE_TYPES = {
  '.png': 'image/png',
  '.apng': 'image/apng',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jpe': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.pjpeg': 'image/jpeg',
  '.pjp': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.dib': 'image/bmp',
  '.ico': 'image/x-icon',
  '.cur': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.svgz': 'image/svg+xml',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  // Shown in the list, but only some browsers can display them (e.g. Safari).
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.jxl': 'image/jxl',
};

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const PUBLIC_DIR = path.join(__dirname, 'public');

function isImage(name) {
  return Object.prototype.hasOwnProperty.call(IMAGE_TYPES, path.extname(name).toLowerCase());
}

function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Resolve a user-supplied path to a real path inside root (symlinks followed),
// or throw 403/404.
async function resolveSafe(root, input) {
  const requested = path.resolve(root, input || '.');
  let real;
  try {
    real = await fsp.realpath(requested);
  } catch {
    throw new HttpError(404, `Not found: ${requested}`);
  }
  if (!isInside(root, real)) {
    throw new HttpError(403, `Outside the allowed folder (${root}): ${requested}`);
  }
  return real;
}

async function listDirectory(root, input) {
  let target = await resolveSafe(root, input);
  let selected = null;
  const stat = await fsp.stat(target);
  if (stat.isFile()) {
    // A file path was given: list its folder and pre-select the file.
    selected = target;
    target = path.dirname(target);
  }

  const dirents = await fsp.readdir(target, { withFileTypes: true });
  const dirs = [];
  const files = [];
  await Promise.all(
    dirents.map(async (d) => {
      if (d.name.startsWith('.')) return;
      const full = path.join(target, d.name);
      let st;
      try {
        st = await fsp.stat(full); // follows symlinks
      } catch {
        return; // broken link or no permission
      }
      if (d.isSymbolicLink()) {
        // Hide links that point outside the allowed folder.
        const real = await fsp.realpath(full).catch(() => null);
        if (!real || !isInside(root, real)) return;
      }
      if (st.isDirectory()) {
        dirs.push({ name: d.name, path: full });
      } else if (st.isFile() && isImage(d.name)) {
        files.push({
          name: d.name,
          path: full,
          size: st.size,
          modified: st.mtime.toISOString(),
          type: IMAGE_TYPES[path.extname(d.name).toLowerCase()],
        });
      }
    })
  );
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  dirs.sort(byName);
  files.sort(byName);

  return {
    root,
    path: target,
    parent: target === root ? null : path.dirname(target),
    selected,
    dirs,
    files,
  };
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function streamFile(req, res, file, contentType, extraHeaders = {}) {
  const stream = fs.createReadStream(file);
  stream.on('open', () => {
    res.writeHead(200, { 'Content-Type': contentType, ...extraHeaders });
    if (req.method === 'HEAD') {
      stream.destroy();
      res.end();
    } else {
      stream.pipe(res);
    }
  });
  stream.on('error', () => {
    if (!res.headersSent) sendJson(res, 404, { error: 'Not found' });
    else res.destroy();
  });
}

function createServer({ root }) {
  const realRoot = fs.realpathSync(path.resolve(root));

  return http.createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        throw new HttpError(405, 'Method not allowed');
      }
      const url = new URL(req.url, 'http://localhost');

      if (url.pathname === '/api/list') {
        return sendJson(res, 200, await listDirectory(realRoot, url.searchParams.get('path')));
      }

      if (url.pathname === '/api/file') {
        const file = await resolveSafe(realRoot, url.searchParams.get('path'));
        if (!(await fsp.stat(file)).isFile()) throw new HttpError(400, 'Not a file');
        if (!isImage(file)) throw new HttpError(415, 'Not a supported image type');
        const ext = path.extname(file).toLowerCase();
        return streamFile(req, res, file, IMAGE_TYPES[ext], {
          'X-Content-Type-Options': 'nosniff',
          // SVGs can contain scripts. Block them if the file is opened directly.
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
          ...(ext === '.svgz' ? { 'Content-Encoding': 'gzip' } : {}),
          'Cache-Control': 'no-cache',
        });
      }

      if (url.pathname === '/api/config') {
        return sendJson(res, 200, { root: realRoot, sep: path.sep });
      }

      // Static files.
      const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1);
      const file = path.resolve(PUBLIC_DIR, rel);
      if (!isInside(PUBLIC_DIR, file)) throw new HttpError(403, 'Forbidden');
      const type = STATIC_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
      return streamFile(req, res, file, type);
    } catch (err) {
      const status = err.status || (err.code === 'EACCES' || err.code === 'EPERM' ? 403 : 500);
      sendJson(res, status, { error: err.message });
    }
  });
}

function parseArgs(argv) {
  const opts = {
    root: process.env.IMAGE_ROOT || os.homedir(),
    port: Number(process.env.PORT) || 3000,
    host: process.env.HOST || '127.0.0.1',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') opts.root = argv[++i];
    else if (a === '--port') opts.port = Number(argv[++i]);
    else if (a === '--host') opts.host = argv[++i];
    else if (a === '-h' || a === '--help') {
      console.log('Usage: node server.js [--root <folder>] [--port 3000] [--host 127.0.0.1]');
      process.exit(0);
    }
  }
  return opts;
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  const server = createServer(opts);
  server.listen(opts.port, opts.host, () => {
    console.log(`Image viewer: http://${opts.host}:${opts.port}`);
    console.log(`Allowed folder: ${fs.realpathSync(path.resolve(opts.root))}`);
  });
}

module.exports = { createServer, listDirectory, IMAGE_TYPES };
