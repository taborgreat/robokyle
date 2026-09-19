import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC_DIR = path.join(ROOT, 'public');
// 'three' resolves to <package>/build/three.module.js.
const THREE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.resolve('three'))));

const HISTORY_SIZE = 200;
const PING_MS = 25_000;
const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
};

// Serves the viewer under /ui (and / itself) and streams hand state plus the API
// request log to it over server-sent events. Everything else is left to the hand API.
export function createUi(hand) {
  const clients = new Set();
  const history = [];

  const write = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const broadcast = (event, data) => clients.forEach((res) => write(res, event, data));

  hand.on('state', () => broadcast('state', hand.snapshot()));

  function logRequest(entry) {
    history.push(entry);
    if (history.length > HISTORY_SIZE) history.shift();
    broadcast('request', entry);
  }

  // X-Accel-Buffering tells a proxy (nginx) to pass events through as they happen
  // instead of batching them, which otherwise shows up as the hand moving late.
  // The comment ping keeps idle streams alive through proxy read timeouts.
  function openStream(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    write(res, 'history', history);
    write(res, 'state', hand.snapshot());
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), PING_MS);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(res);
    });
  }

  function sendFile(res, dir, relative) {
    const file = path.join(dir, relative);
    if (!file.startsWith(dir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return void res.writeHead(404).end();
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }

  // Returns true when the request was for the viewer.
  function handle(req, res) {
    // Leading slashes are collapsed: '//' parses as a host-less URL and throws.
    const { pathname } = new URL(req.url.replace(/^\/+/, '/'), 'http://hand');
    if (req.method !== 'GET' || (pathname !== '/' && !pathname.startsWith('/ui/'))) return false;

    if (pathname === '/') sendFile(res, PUBLIC_DIR, 'index.html');
    else if (pathname === '/ui/events') openStream(req, res);
    else if (pathname.startsWith('/ui/three/')) sendFile(res, THREE_DIR, pathname.slice('/ui/three/'.length));
    else sendFile(res, PUBLIC_DIR, pathname.slice('/ui/'.length));
    return true;
  }

  return { handle, logRequest };
}
