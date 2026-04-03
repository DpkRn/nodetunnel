import net from 'node:net';
import { Session } from 'yamux-js/lib/session.js';

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
 * @property {string} [host] tunnel server host (default localhost)
 * @property {number} [serverPort] tunnel server TCP port (default 9000)
 */

class Tunnel {
  /**
   * @param {string} localPort local HTTP port to forward to
   * @param {TunnelOptions} [options]
   */
  constructor(localPort, options = {}) {
    this.localPort = localPort;
    this.serverHost = options.host ?? 'localhost';
    this.serverPort = options.serverPort ?? 9000;
    /** @type {import('net').Socket | null} */
    this.socket = null;
    /** @type {InstanceType<typeof Session> | null} */
    this.session = null;
    this.publicUrl = '';
    this._stopped = false;
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

    const { line, remainder } = await readPublicUrlLine(socket);
    this.publicUrl = `http://${line}`;

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
  const t = new Tunnel(localPort, options);
  await t.connect();
  return t;
}

export { Tunnel, newTunnel };
