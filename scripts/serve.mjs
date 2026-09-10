import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('dist/client'),
  base = process.env.NEXT_PUBLIC_BASE_PATH || '',
  port = Number(process.env.PORT || 4173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};
const server = http.createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405);
      res.end();
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    let requested = decodeURIComponent(url.pathname);
    if (base && requested !== base && !requested.startsWith(`${base}/`)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    requested = requested.slice(base.length);
    if (requested.includes('\\') || requested.includes('\0')) {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }
    let file = path.resolve(root, `.${requested || '/'}`);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const info = await stat(file);
    if (info.isDirectory()) {
      if (!url.pathname.endsWith('/')) {
        res.writeHead(308, { Location: `${url.pathname}/${url.search}` });
        res.end();
        return;
      }
      file = path.join(file, 'index.html');
    }
    const content = await readFile(file);
    res.writeHead(200, {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch {
    // A client can disconnect while the asynchronous file lookup is in
    // flight.  In that case the response may already be closed (or headers
    // may have been sent), so attempting the fallback 404 would throw
    // ERR_HTTP_HEADERS_SENT and bring down the preview server. Keep the
    // static server alive for the remaining browser workers.
    if (res.writableEnded || res.destroyed) return;
    try {
      if (res.headersSent) {
        res.end();
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(await readFile(path.join(root, '404.html')));
    } catch {
      if (res.writableEnded || res.destroyed) return;
      if (res.headersSent) {
        res.end();
        return;
      }
      res.writeHead(404);
      res.end('Build the site first with npm run build.');
    }
  }
});
server.listen(port, '127.0.0.1', () =>
  console.log(`Static preview: http://127.0.0.1:${port}${base}/`),
);
