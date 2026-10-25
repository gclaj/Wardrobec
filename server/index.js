'use strict';
// Zero-dependency HTTP server: static files from /public plus the JSON API in routes.js.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('./db');
const { routes, HttpError, ensureClosetLoaded } = require('./routes');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json' };
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function readBody(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new HttpError(413, 'body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, payload, headers = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function serveStatic(req, res, urlPath) {
  let p = urlPath === '/' ? '/index.html' : urlPath;
  p = path.normalize(p).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(PUBLIC_DIR, p);
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // SPA fallback
      return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, data) => {
        if (e2) return send(res, 404, { error: 'not found' });
        res.writeHead(200, { 'Content-Type': MIME['.html'] }); res.end(data);
      });
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

function createServer(db) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });
      return serveStatic(req, res, url.pathname);
    }
    try {
      const route = routes.find(r => r.method === req.method && r.re.test(url.pathname));
      if (!route) throw new HttpError(404, `no route for ${req.method} ${url.pathname}`);
      const m = url.pathname.match(route.re);
      const params = {}; route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      const query = Object.fromEntries(url.searchParams.entries());
      const body = (req.method === 'GET' || req.method === 'HEAD' || req.method === 'DELETE') ? {} : await readBody(req);
      const result = await route.handler({ db, params, query, body });
      send(res, 200, result == null ? {} : result);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      send(res, status, { error: err.message || 'error' });
    }
  });
}

if (require.main === module) {
  const dbFile = process.env.WARDROBE_DB || path.join(__dirname, '..', 'data', 'wardrobe.db');
  const db = openDb(dbFile);
  const seeded = ensureClosetLoaded(db);
  if (seeded.loaded) console.log(`Loaded ${seeded.loaded} pieces from the closet file (${seeded.reason}).`);
  const port = Number(process.env.PORT || 3000);
  // Bind to all interfaces when a platform hands us a PORT (Railway, Render, Fly, Docker);
  // stay on localhost for plain `npm start` on a laptop.
  const host = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22) { console.error(`Wardrobec needs Node 22.13 or newer (found ${process.versions.node}).`); process.exit(1); }
  const server = createServer(db).listen(port, host, () => {
    console.log(`Wardrobec running on ${host}:${port}  (db: ${dbFile}, node ${process.versions.node})`);
  });
  // Platforms stop a container with SIGTERM on every redeploy; exit cleanly instead of letting npm report it as an error.
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
    console.log(`${sig} received, shutting down.`);
    server.close(() => { try { db.close(); } catch {} process.exit(0); });
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

module.exports = { createServer };
