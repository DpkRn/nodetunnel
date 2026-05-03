import http from 'node:http';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { request } from 'undici';
import { WebSocketServer } from 'ws';
import { getLogs, getLogById, setInspectorSubscriber, addLog } from './logstore.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const inspectorHTML = readFileSync(join(__dirname, 'inspector.html'), 'utf8');
const inspectorCSS = readFileSync(join(__dirname, 'inspector.css'), 'utf8');
const themePostmanCSS = readFileSync(join(__dirname, 'theme-postman.css'), 'utf8');
const themeTerminalCSS = readFileSync(join(__dirname, 'theme-terminal.css'), 'utf8');
const indexJS = readFileSync(join(__dirname, 'index.js'), 'utf8');

const defaultInspectorAddr = ':4040';

/** Same header as gotunnel inspector. */
const HeaderLogReplay = 'X-Inspector-Log-Replay';

/** Dropped on replay so upstream length matches the body we send (stale Content-Length breaks POST JSON). */
const replayHeaderBlocklist = new Set([
  'connection',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
]);

/** @param {{ inspectorAddr?: string }} opts */
export function inspectorHTTPBaseURL(opts) {
  let addr = String(opts.inspectorAddr ?? '').trim();
  if (!addr) addr = defaultInspectorAddr;
  if (addr.startsWith('http://') || addr.startsWith('https://')) return addr;
  if (addr.startsWith(':')) return `http://127.0.0.1${addr}`;
  return `http://${addr}`;
}

/** @param {string | undefined} themes */
function themeSeedFromOpts(themes) {
  const t = String(themes ?? '')
    .trim()
    .toLowerCase();
  if (t === 'terminal') return 'terminal';
  return 'postman';
}

/** @param {string} host */
function isLoopbackHost(host) {
  const h = String(host)
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .trim();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

/** @param {URL} u */
function allowReplayURL(u) {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  return isLoopbackHost(u.hostname);
}

/** @param {import('http').IncomingMessage} req */
function logReplayRequested(req) {
  const v = String(req.headers['x-inspector-log-replay'] ?? '')
    .trim()
    .toLowerCase();
  if (!v) return false;
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/** @param {Record<string, unknown> | null | undefined} h */
function cloneHeaderMap(h) {
  if (!h || typeof h !== 'object') return {};
  const out = {};
  for (const [k, vals] of Object.entries(h)) {
    out[k] = Array.isArray(vals) ? vals.map((v) => String(v)) : [String(vals)];
  }
  return out;
}

/** @param {URL} u */
function pathForReplayLog(u) {
  let p = u.pathname || '/';
  if (!p) p = '/';
  return u.search ? `${p}${u.search}` : p;
}

/** @param {import('undici').IncomingHttpHeaders} h */
function headersObjectFromUndici(h) {
  /** @type {Record<string, string[]>} */
  const out = {};
  if (!h || typeof h !== 'object') return out;
  for (const [k, v] of Object.entries(h)) {
    if (v == null) continue;
    if (Array.isArray(v)) out[k] = v.map((x) => String(x));
    else out[k] = [String(v)];
  }
  return out;
}

/** @param {unknown} body */
function normalizeReplayBody(body) {
  if (body == null || body === '') return '';
  if (typeof body === 'string') return body;
  if (typeof body === 'object' && body !== null && !Buffer.isBuffer(body)) {
    try {
      return JSON.stringify(body);
    } catch {
      return String(body);
    }
  }
  return String(body);
}

/**
 * Headers for the upstream fetch (no hop-by-hop / wrong length).
 * @param {Record<string, unknown>} h from replay JSON
 */
function buildUpstreamHeaders(h) {
  /** @type {Record<string, string | string[]>} */
  const out = {};
  const src = h && typeof h === 'object' ? h : {};
  for (const [k, vals] of Object.entries(src)) {
    if (replayHeaderBlocklist.has(k.toLowerCase())) continue;
    const arr = Array.isArray(vals) ? vals : [vals];
    const strs = arr.filter((v) => v != null).map((v) => String(v));
    if (!strs.length) continue;
    out[k] = strs.length === 1 ? strs[0] : strs;
  }
  return out;
}

/**
 * Express (and many servers) only parse JSON bodies when Content-Type is JSON.
 * Captured replays often omit Content-Type or keep a wrong type (e.g. GET capture).
 * @param {Record<string, string | string[]>} headers
 * @param {string} method
 * @param {string} bodyStr
 */
function finalizeUpstreamContentType(headers, method, bodyStr) {
  if (!bodyStr.length || method === 'GET' || method === 'HEAD') return headers;

  const trimmed = bodyStr.trim();
  const looksJson =
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'));

  /** @type {Record<string, string | string[]>} */
  const out = { ...headers };
  let ctKey = null;
  for (const k of Object.keys(out)) {
    if (k.toLowerCase() === 'content-type') {
      ctKey = k;
      break;
    }
  }

  if (!ctKey) {
    out['Content-Type'] = looksJson
      ? 'application/json; charset=utf-8'
      : 'text/plain; charset=utf-8';
    return out;
  }

  const raw = out[ctKey];
  const ctVal = Array.isArray(raw) ? String(raw[0]) : String(raw);
  if (looksJson && !ctVal.toLowerCase().includes('json')) {
    delete out[ctKey];
    out['Content-Type'] = 'application/json; charset=utf-8';
  }
  return out;
}

/** @param {import('stream').Readable} stream */
async function readStreamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * @param {boolean} logReplay
 * @param {string} method
 * @param {URL} u
 * @param {Record<string, string[]>} headers
 * @param {string} bodyStr
 * @param {number} statusCode
 * @param {Record<string, string[]>} respHeaders
 * @param {Buffer} respBody
 * @param {number} durationMs
 */
function recordReplay(
  logReplay,
  method,
  u,
  headers,
  bodyStr,
  statusCode,
  respHeaders,
  respBody,
  durationMs,
) {
  if (!logReplay) return;
  addLog({
    id: `req_${randomUUID()}`,
    source: 'replay',
    request: {
      method,
      path: pathForReplayLog(u),
      body: Buffer.from(bodyStr, 'utf8').toString('base64'),
      headers: cloneHeaderMap(headers),
    },
    response: {
      statusCode,
      headers: cloneHeaderMap(respHeaders),
      body: respBody.length ? respBody.toString('base64') : '',
    },
    durationMs,
  });
}

/**
 * @returns {(req: import('http').IncomingMessage, res: import('http').ServerResponse) => Promise<void>}
 */
function createReplayHandler() {
  return async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', `Content-Type, ${HeaderLogReplay}`);
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== 'POST') {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(405);
      res.end(JSON.stringify({ error: 'method not allowed' }));
      return;
    }

    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    if (raw.length > 10 << 20) {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'body too large' }));
      return;
    }

    /** @type {{ method?: string; url?: string; headers?: Record<string, unknown>; body?: string }} */
    let p;
    try {
      p = JSON.parse(raw.toString('utf8'));
      console.log("p",p);
    } catch (e) {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(400);
      res.end(
        JSON.stringify({
          error: `invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
        }),
      );
      return;
    }

    const logReplay = logReplayRequested(req);
    let method = String(p.method ?? 'GET')
      .trim()
      .toUpperCase();
    if (!method) method = 'GET';

    const localhostUrl = String(p.url ?? '').trim();
    console.log("localhostUrl",localhostUrl);
    let u;
    try {
      u = new URL(localhostUrl);
    } catch {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'invalid url' }));
      return;
    }
    if (!u.host) {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'invalid url' }));
      return;
    }
    if (!allowReplayURL(u)) {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(403);
      res.end(JSON.stringify({ error: 'only http(s) URLs on localhost are allowed' }));
      return;
    }

    const h = p.headers && typeof p.headers === 'object' ? p.headers : {};
    const bodyStr = normalizeReplayBody(p.body);
    const upstreamHeaders = finalizeUpstreamContentType(
      buildUpstreamHeaders(h),
      method,
      bodyStr,
    );

    const start = Date.now();
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 120_000);

    res.setHeader('Content-Type', 'application/json');

    /** @type {import('undici').RequestOptions} */
    const reqOpts = {
      method,
      headers: upstreamHeaders,
      signal: ac.signal,
    };
    if (bodyStr.length > 0 && method !== 'GET' && method !== 'HEAD') {
      reqOpts.body = bodyStr;
    }

    try {
      const { statusCode, headers: respHdrs, body: respStream } = await request(
        localhostUrl,
        reqOpts,
      );
      clearTimeout(to);
      const dur = Date.now() - start;
      const b = await readStreamToBuffer(respStream);
      const slice = b.length > 10 << 20 ? b.subarray(0, 10 << 20) : b;
      const headersOut = headersObjectFromUndici(respHdrs);
      recordReplay(
        logReplay,
        method,
        u,
        cloneHeaderMap(h),
        bodyStr,
        statusCode,
        headersOut,
        slice,
        dur,
      );
      res.writeHead(200);
      res.end(
        JSON.stringify({
          statusCode,
          headers: headersOut,
          body: slice.toString('base64'),
          durationMs: dur,
        }),
      );
    } catch (e) {
      clearTimeout(to);
      const dur = Date.now() - start;
      const errText = e instanceof Error ? e.message : String(e);
      const hdrs = /** @type {Record<string, string[]>} */ ({});
      recordReplay(
        logReplay,
        method,
        u,
        cloneHeaderMap(h),
        bodyStr,
        502,
        hdrs,
        Buffer.from(errText, 'utf8'),
        dur,
      );
      res.writeHead(502);
      res.end(JSON.stringify({ error: errText, durationMs: dur }));
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
 * @param {string} localPort digits — forwarded app port for default replay base in UI
 * @returns {() => void}
 */
export function startInspector(opts, localPort) {
  if (opts.inspector === false) {
    return () => {};
  }

  const themeSeed = themeSeedFromOpts(opts.themes);
  let addr = String(opts.inspectorAddr ?? '').trim();
  if (!addr) addr = defaultInspectorAddr;

  const localAppPort = String(localPort ?? '')
    .trim()
    .replace(/^:/, '') || '8080';

  /** @type {Set<import('ws').WebSocket>} */
  const viewers = new Set();

  function broadcast(entry) {
    const msg = JSON.stringify({
      eventType: 'request',
      payload: entry,
    });
    for (const ws of viewers) {
      try {
        ws.send(msg);
      } catch {
        viewers.delete(ws);
      }
    }
  }

  setInspectorSubscriber(broadcast);

  const replay = createReplayHandler();

  function serveText(pathname, body, contentType) {
    return (req, res) => {
      if (req.method !== 'GET' || new URL(req.url || '/', 'http://localhost').pathname !== pathname) {
        return false;
      }
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-cache');
      res.end(body);
      return true;
    };
  }

  const tryInspectorCSS = serveText('/inspector.css', inspectorCSS, 'text/css; charset=utf-8');
  const tryThemePostman = serveText(
    '/theme-postman.css',
    themePostmanCSS,
    'text/css; charset=utf-8',
  );
  const tryThemeTerminal = serveText(
    '/theme-terminal.css',
    themeTerminalCSS,
    'text/css; charset=utf-8',
  );
  const tryIndexJS = serveText('/index.js', indexJS, 'application/javascript; charset=utf-8');

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = url.pathname;

    if (tryInspectorCSS(req, res)) return;
    if (tryThemePostman(req, res)) return;
    if (tryThemeTerminal(req, res)) return;
    if (tryIndexJS(req, res)) return;

    if (req.method === 'GET' && pathname === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      const page = inspectorHTML
        .replace(/__NT_PORT_VALUE__/g, localAppPort)
        .replace(/__THEME_SEED__/g, themeSeed);
      res.end(page);
      return;
    }
    if (req.method === 'GET' && pathname === '/logs') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(getLogs()));
      return;
    }
    if (req.method === 'GET' && pathname === '/log') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'application/json');
      const id = url.searchParams.get('id');
      if (!id) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'missing id' }));
        return;
      }
      const log = getLogById(id);
      if (!log) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'log not found' }));
        return;
      }
      res.end(JSON.stringify(log));
      return;
    }
    if (pathname === '/replay') {
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
    viewers.add(ws);
    ws.on('close', () => viewers.delete(ws));
    ws.on('error', () => viewers.delete(ws));
    ws.on('message', () => {});
  });

  const ingestWss = new WebSocketServer({ noServer: true });
  ingestWss.on('connection', (ws) => {
    ws.on('message', (data) => {
      try {
        const text = typeof data === 'string' ? data : data.toString('utf8');
        const ev = JSON.parse(text);
        addLog(ev);
      } catch {
        /* ignore */
      }
    });
  });

  server.on('upgrade', (request, socket, head) => {
    const path = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    if (path === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else if (path === '/ingest') {
      ingestWss.handleUpgrade(request, socket, head, (ws) => {
        ingestWss.emit('connection', ws, request);
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
    for (const ws of viewers) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    viewers.clear();
    try {
      wss.close();
    } catch {
      /* ignore */
    }
    try {
      ingestWss.close();
    } catch {
      /* ignore */
    }
    server.close();
  };
}
