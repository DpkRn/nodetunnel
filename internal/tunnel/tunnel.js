import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { Session } from 'yamux-js/lib/session.js';
import {
  addLog,
  newLogId,
  setMaxRequestLogs,
  setTrafficCaptureEnabled,
} from '../inspector/logstore.js';
import { startInspector } from '../inspector/inspector.js';
// import { version } from '../../../package.json' with { type: 'json' };

const defaultMuxConfig = {
  enableKeepAlive: false,
  logger: () => {},
};

/**
 * Read until first LF; returns trimmed line (without \n) and any bytes after it.
 * @param {import('net').Socket} socket
 */
function readPublicUrlLine(socket) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);

    const onError = (err) => {
      socket.off('data', onData);
      reject(err);
    };

    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const nl = buffer.indexOf(0x0a);
      if (nl >= 0) {
        socket.off('data', onData);
        socket.off('error', onError);
        const line = buffer.subarray(0, nl).toString('utf8').trim();
        const remainder = buffer.subarray(nl + 1);
        resolve({ line, remainder });
      }
    };

    socket.on('data', onData);
    socket.on('error', onError);
  });
}

/**
 * Read one line (LF-terminated) from a yamux duplex stream.
 * @param {import('stream').Duplex} stream
 */
function readJsonLine(stream) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);

    const onError = (err) => {
      stream.off('data', onData);
      reject(err);
    };

    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const nl = buffer.indexOf(0x0a);
      if (nl >= 0) {
        stream.off('data', onData);
        stream.off('error', onError);
        const line = buffer.subarray(0, nl).toString('utf8');
        resolve(line);
      }
    };

    stream.on('data', onData);
    stream.on('error', onError);
  });
}

/** @param {unknown} body */
function decodeRequestBody(body) {
  if (body == null || body === '') return Buffer.alloc(0);
  if (typeof body === 'string') return Buffer.from(body, 'base64');
  if (Buffer.isBuffer(body)) return body;
  if (Array.isArray(body)) return Buffer.from(body);
  return Buffer.alloc(0);
}

/** @param {Headers | import('http').IncomingHttpHeaders} h */
function headersToObject(h) {
  const out = {};
  if (h && typeof h.forEach === 'function') {
    h.forEach((value, key) => {
      if (!out[key]) out[key] = [];
      out[key].push(value);
    });
    return out;
  }
  for (const [key, val] of Object.entries(h || {})) {
    if (val == null) continue;
    out[key] = Array.isArray(val) ? val : [val];
  }
  return out;
}

/**
 * @param {import('stream').Duplex} stream
 * @param {string} port
 */
async function handleStream(stream, port) {
  const started = Date.now();
  try {
    const line = await readJsonLine(stream);
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      return;
    }

    const method = req.Method || 'GET';
    const path = req.Path || '/';
    const target = new URL(path, `http://127.0.0.1:${port}`).toString();
    const body = decodeRequestBody(req.Body);

    const headers = new Headers();
    const raw = req.Headers || {};
    for (const [k, vals] of Object.entries(raw)) {
      if (!Array.isArray(vals)) continue;
      for (const v of vals) {
        if (v != null) headers.append(k, String(v));
      }
    }

    /** @type {{ method: string; headers: Headers; body?: Buffer }} */
    const init = { method, headers };
    if (body.length) init.body = body;

    const resp = await fetch(target, init);

    const respBody = Buffer.from(await resp.arrayBuffer());
    const payload = {
      Status: resp.status,
      Headers: headersToObject(resp.headers),
      Body: respBody.toString('base64'),
    };

    stream.end(Buffer.from(`${JSON.stringify(payload)}\n`, 'utf8'));

    addLog({
      id: `req_${newLogId()}`,
      request: {
        method,
        path,
        headers: raw,
        body: body.length ? body.toString('base64') : '',
      },
      response: {
        statusCode: resp.status,
        headers: headersToObject(resp.headers),
        body: respBody.length ? respBody.toString('base64') : '',
      },
      durationMs: Date.now() - started,
    });
  } catch (e) {
    try {
      stream.destroy();
    } catch {
      /* ignore */
    }
  }
}

/**
 * @typedef {Object} TunnelOptions
 * @property {string} [host] tunnel server host (default clickly.cv)
 * @property {number} [serverPort] tunnel server TCP port (default 9000)
 * @property {boolean} [inspector] traffic inspector UI (default false). When false, no inspector server, no in-memory traffic capture, and `logs` / `inspectorAddr` are ignored.
 * @property {number} [logs] max request/response captures in memory for the inspector (default 100). Only used when `inspector` is true.
 * @property {string} [inspectorAddr] inspector listen address (default ":4040"). Only used when `inspector` is true.
 */

function defaultTunnelOptions() {
  return {
    host: 'clickly.cv',
    serverPort: 9000,
    themes: 'terminal',
    inspector: false,
    logs: 100,
    inspectorAddr: '',
  };
}

/**
 * @param {TunnelOptions | undefined} options
 * @returns {TunnelOptions & ReturnType<typeof defaultTunnelOptions>}
 */
function applyTunnelOptions(options) {
  const d = defaultTunnelOptions();
  if (!options || typeof options !== 'object') {
    return /** @type {TunnelOptions & typeof d} */ ({ ...d });
  }
  const inspector =
    options.inspector !== undefined ? !!options.inspector : d.inspector;
  return {
    host: options.host ?? d.host,
    serverPort: options.serverPort ?? d.serverPort,
    inspector,
    logs:
      inspector && options.logs > 0 ? options.logs : d.logs,
    inspectorAddr: inspector ? (options.inspectorAddr ?? d.inspectorAddr) : d.inspectorAddr,
  };
}

class Tunnel {
  /**
   * @param {string} localPort local HTTP port to forward to
   * @param {TunnelOptions} [options] merged options
   */
  constructor(localPort, options = {}) {
    this.localPort = localPort;
    this.options = options;
    this.serverHost = options.host ?? 'clickly.cv';
    this.serverPort = options.serverPort ?? 9000;
    /** @type {import('net').Socket | null} */
    this.socket = null;
    /** @type {InstanceType<typeof Session> | null} */
    this.session = null;
    this.publicUrl = '';
    this._stopped = false;
    /** @type {(() => void) | null} */
    this._stopInspector = null;
  }

  /**
   * Connect, read assigned public URL (plaintext line before yamux), start yamux client.
   * Matches devtunnel server: URL line first, then hashicorp-compatible yamux.
   */
  async connect() {
    const socket = net.createConnection({
      host: this.serverHost,
      port: this.serverPort,
    });

    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });

    // Client hello (JSON line). Match Go json.Marshal(ClientHello) with exported fields (PascalCase).
    socket.write(JSON.stringify({
      tunnel_type: 'nodetunnel',
      Version: "1.0.7",
      tunnel_id: 'fixed_id',
      connection_id: "conn_"+randomUUID(),
    }) + '\n');

    const { line, remainder } = await readPublicUrlLine(socket);
    this.publicUrl = `${line}`;

    const session = new Session(true, defaultMuxConfig, (stream) => {
      handleStream(stream, this.localPort);
    });

    this.socket = socket;
    this.session = session;

    if (remainder.length) {
      session.write(remainder);
    }
    socket.pipe(session);
    session.pipe(socket);

    session.on('error', () => {});
    socket.on('error', () => {});
  }

  getPublicUrl() {
    return this.publicUrl;
  }

  stop() {
    if (this._stopped) return;
    this._stopped = true;
    try {
      if (this._stopInspector) {
        this._stopInspector();
        this._stopInspector = null;
      }
    } catch {
      /* ignore */
    }
    try {
      if (this.session) {
        this.session.close();
        this.session = null;
      }
    } catch {
      /* ignore */
    }
    try {
      if (this.socket) {
        this.socket.destroy();
        this.socket = null;
      }
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {string} localPort
 * @param {TunnelOptions} [options]
 */
async function newTunnel(localPort, options) {
  const opts = applyTunnelOptions(options);
  setTrafficCaptureEnabled(opts.inspector);
  if (opts.inspector) {
    setMaxRequestLogs(opts.logs);
  }
  const t = new Tunnel(localPort, opts);
  await t.connect();
  t._stopInspector = startInspector(opts, localPort);
  return t;
}

export { Tunnel, newTunnel };
