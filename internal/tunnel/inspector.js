import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WebSocketServer } from 'ws';
import { getLogs, setInspectorSubscriber } from './logstore.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INSPECTOR_PAGE_HTML = readFileSync(join(__dirname, 'inspector-page.html'), 'utf8');

const defaultInspectorAddr = ':4040';

/** @param {{ inspectorAddr?: string }} opts */
export function inspectorHTTPBaseURL(opts) {
  let addr = String(opts.inspectorAddr ?? '').trim();
  if (!addr) addr = defaultInspectorAddr;
  if (addr.startsWith('http://') || addr.startsWith('https://')) return addr;
  if (addr.startsWith(':')) return `http://127.0.0.1${addr}`;
  return `http://${addr}`;
}

/** @param {string | undefined} s */
function normalizeInspectorTheme(s) {
  const t = String(s ?? '')
    .trim()
    .toLowerCase();
  if (t === 'terminal') return 'theme-terminal';
  if (t === 'light') return 'theme-light';
  if (t === 'dark' || t === '') return 'theme-dark';
  return 'theme-dark';
}

const replayHeaderBlocklist = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
]);

/**
 * @param {string} localPort
 * @returns {(req: import('http').IncomingMessage, res: import('http').ServerResponse) => Promise<void>}
 */
function createReplayHandler(localPort) {
  return async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end(JSON.stringify({ error: 'use POST' }));
      return;
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    if (raw.length > 10 << 20) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'body too large' }));
      return;
    }
    let payload;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: `invalid JSON: ${e instanceof Error ? e.message : String(e)}` }));
      return;
    }
    let method = String(payload.method ?? 'GET')
      .trim()
      .toUpperCase();
    if (!method) method = 'GET';
    let path = String(payload.path ?? '/').trim();
    if (!path) path = '/';
    if (!path.startsWith('/')) path = `/${path}`;
    const target = `http://127.0.0.1:${localPort}${path}`;
    const headers = new Headers();
    const h = payload.headers && typeof payload.headers === 'object' ? payload.headers : {};
    for (const [k, vals] of Object.entries(h)) {
      if (replayHeaderBlocklist.has(k.toLowerCase())) continue;
      const arr = Array.isArray(vals) ? vals : [vals];
      for (const v of arr) {
        if (v != null) headers.append(k, String(v));
      }
    }
    /** @type {{ method: string; headers: Headers; body?: string; signal?: AbortSignal }} */
    const init = { method, headers };
    const bodyStr = payload.body != null ? String(payload.body) : '';
    // Forward any non-empty body for arbitrary methods (DELETE, PUT, PATCH, POST, etc.).
    // The Fetch API rejects a body on GET and HEAD only — match that so replay works for the rest.
    if (bodyStr.length > 0 && method !== 'GET' && method !== 'HEAD') {
      init.body = bodyStr;
    }
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 60_000);
    try {
      const resp = await fetch(target, { ...init, signal: ac.signal });
      clearTimeout(to);
      const b = Buffer.from(await resp.arrayBuffer());
      const slice = b.length > 10 << 20 ? b.subarray(0, 10 << 20) : b;
      const bodyOut = slice.toString('utf8');
      /** @type {Record<string, string[]>} */
      const headersOut = {};
      resp.headers.forEach((value, key) => {
        const canon = key;
        if (!headersOut[canon]) headersOut[canon] = [];
        headersOut[canon].push(value);
      });
      res.writeHead(200);
      res.end(
        JSON.stringify({
          status: resp.status,
          headers: headersOut,
          body: bodyOut,
        }),
      );
    } catch (e) {
      clearTimeout(to);
      res.writeHead(502);
      res.end(JSON.stringify({ error: String(e instanceof Error ? e.message : e) }));
    }
  };
}

/**
 * @param {string} addr
 * @returns {{ host?: string; port: number }}
 */
function parseListenAddr(addr) {
  const s = String(addr).trim();
  if (!s) return { port: 4040 };
  if (s.startsWith('http://') || s.startsWith('https://')) {
    const u = new URL(s);
    const port = Number(u.port);
    return {
      host: u.hostname || 'localhost',
      port: Number.isFinite(port) && port > 0 ? port : u.protocol === 'https:' ? 443 : 80,
    };
  }
  if (s.startsWith(':')) {
    const port = Number(s.slice(1));
    return { port: Number.isFinite(port) ? port : 4040 };
  }
  const lastColon = s.lastIndexOf(':');
  if (lastColon > 0) {
    const host = s.slice(0, lastColon);
    const port = Number(s.slice(lastColon + 1));
    if (Number.isFinite(port)) return { host, port };
  }
  if (/^\d+$/.test(s)) return { port: Number(s) };
  return { port: 4040 };
}

/**
 * @param {{ inspector?: boolean; themes?: string; inspectorAddr?: string }} opts
 * @param {string} localPort
 * @returns {() => void}
 */
export function startInspector(opts, localPort) {
  if (opts.inspector === false) {
    return () => {};
  }

  const themeClass = normalizeInspectorTheme(opts.themes);
  let addr = String(opts.inspectorAddr ?? '').trim();
  if (!addr) addr = defaultInspectorAddr;

  /** @type {Set<import('ws').WebSocket>} */
  const clients = new Set();

  function broadcast(entry) {
    const msg = JSON.stringify(entry);
    for (const ws of clients) {
      try {
        ws.send(msg);
      } catch {
        clients.delete(ws);
      }
    }
  }

  setInspectorSubscriber(broadcast);

  const replay = createReplayHandler(localPort);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = url.pathname;
    if (req.method === 'GET' && pathname === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      const page = INSPECTOR_PAGE_HTML.replace('__THEME_CLASS__', themeClass);
      res.end(page);
      return;
    }
    if (req.method === 'GET' && pathname === '/logs') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(getLogs(), null, 2));
      return;
    }
    if (req.method === 'POST' && pathname === '/replay') {
      replay(req, res).catch(() => {
        try {
          if (!res.headersSent) res.writeHead(500);
          res.end(JSON.stringify({ error: 'replay failed' }));
        } catch {
          /* ignore */
        }
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.maxHeadersCount = 2000;

  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
    ws.on('message', () => {});
  });

  server.on('upgrade', (request, socket, head) => {
    const path = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    if (path === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  const listenOpts = parseListenAddr(addr);
  server.listen(listenOpts, () => {
    console.error(`nodetunnel: traffic inspector → ${inspectorHTTPBaseURL(opts)}`);
  });

  server.on('error', (err) => {
    console.error(`nodetunnel: inspector stopped: ${err.message}`);
  });

  return () => {
    setInspectorSubscriber(null);
    for (const ws of clients) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    clients.clear();
    try {
      wss.close();
    } catch {
      /* ignore */
    }
    server.close();
  };
}
