// Zero-dependency static file server for the OHIF production build.
// Exists because `serve`'s SPA fallback (-s flag and custom rewrites alike)
// crashes with this repo's installed path-to-regexp version. Uses only
// Node's built-in http/fs modules, so it can't hit that bug.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3005);
const DIST_DIR = path.join(__dirname, 'platform', 'app', 'dist');

// ── Socket / connection tuning ─────────────────────────────────────────────
// ERR_NO_BUFFER_SPACE is caused by Windows running out of TCP socket buffers
// when connections are not released quickly enough.
// These settings keep the server stable under many concurrent doctors.
const KEEP_ALIVE_TIMEOUT_MS = 10000;   // close idle connections after 10 s
const HEADERS_TIMEOUT_MS    = 15000;   // max time to receive full request headers
const MAX_CONNECTIONS       = 1000;    // refuse connections above this limit

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'font/otf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.map': 'application/json',
  '.dcm': 'application/dicom',
};

// Never cache the SPA shell, runtime config, or the service worker script
// itself; cache hashed assets forever. sw.js is NOT content-hashed (it's
// always named sw.js), so unlike app.bundle.<hash>.js it can't rely on the
// URL changing to bust a stale cache entry - and the service worker's own
// self-update mechanism (skipWaiting/clientsClaim in service-worker.js)
// only runs once the browser actually re-fetches a changed sw.js, so
// caching it long-term silently defeats every future deployment for
// already-visited browsers until that cache entry expires.
function setCacheHeaders(res, filePath) {
  const base = path.basename(filePath);
  if (base === 'index.html' || base === 'app-config.js' || base === 'sw.js') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
}

const server = http.createServer((req, res) => {
  // Disable Nagle algorithm — flush small TCP packets immediately
  req.socket.setNoDelay(true);

  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let filePath = path.join(DIST_DIR, urlPath);

  // Block path traversal outside dist.
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (!err && stats.isFile()) {
      serveFile(filePath, res);
      return;
    }
    // SPA fallback: any unmatched path (e.g. /viewer?StudyInstanceUIDs=...)
    // returns index.html so the client-side router can take over.
    serveFile(path.join(DIST_DIR, 'index.html'), res);
  });
});

function serveFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
  
  // Crucial for SharedArrayBuffer / Cornerstone3D MPR & Volume rendering
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');

  setCacheHeaders(res, filePath);
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    res.writeHead(404);
    res.end('Not found');
  });
  stream.pipe(res);
}

// ── Apply server-level socket tuning ──────────────────────────────────────
// keepAliveTimeout: close idle keep-alive connections promptly to free OS
// socket buffers (ERR_NO_BUFFER_SPACE fix).
server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
server.headersTimeout   = HEADERS_TIMEOUT_MS;
server.maxConnections   = MAX_CONNECTIONS;

// Ensure sockets are destroyed once the response is finished to prevent
// lingering TIME_WAIT state from exhausting Windows socket buffer space.
server.on('connection', (socket) => {
  socket.setKeepAlive(true, 5000);  // TCP keep-alive probe every 5 s
  socket.setNoDelay(true);           // No Nagle buffering
  socket.setTimeout(30000, () => {   // Hard close after 30 s of total inactivity
    socket.destroy();
  });
});

server.listen(PORT, () => {
  console.log(`OHIF static server listening on http://0.0.0.0:${PORT}`);
  console.log(`Serving: ${DIST_DIR}`);
  console.log(`Keep-alive timeout: ${KEEP_ALIVE_TIMEOUT_MS}ms | Max connections: ${MAX_CONNECTIONS}`);
});

// Graceful shutdown
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT',  () => server.close(() => process.exit(0)));
