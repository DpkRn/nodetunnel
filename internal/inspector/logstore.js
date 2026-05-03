import { randomUUID } from 'node:crypto';

const defaultMaxRequestLogs = 100;

/** @type {number} */
let maxRequestLogs = defaultMaxRequestLogs;
/** @type {Array<Record<string, unknown>>} */
let requestLogs = [];

/** @type {((entry: Record<string, unknown>) => void) | null} */
let inspectorSubscriber = null;

/** When false (tunnel started with `inspector: false`), captures are not stored. */
let trafficCaptureEnabled = true;

/**
 * Wire live inspector WebSocket broadcast (optional).
 * @param {((entry: Record<string, unknown>) => void) | null} fn
 */
export function setInspectorSubscriber(fn) {
  inspectorSubscriber = fn;
}

/**
 * @param {boolean} enabled
 */
export function setTrafficCaptureEnabled(enabled) {
  trafficCaptureEnabled = !!enabled;
}

/**
 * @param {number} n
 */
export function setMaxRequestLogs(n) {
  if (n < 1) n = defaultMaxRequestLogs;
  maxRequestLogs = n;
  if (requestLogs.length > maxRequestLogs) {
    requestLogs = requestLogs.slice(requestLogs.length - maxRequestLogs);
  }
}

/**
 * @param {Record<string, unknown>} entry
 */
export function addLog(entry) {
  if (!trafficCaptureEnabled) return;
  requestLogs.push(entry);
  if (requestLogs.length > maxRequestLogs) {
    requestLogs = requestLogs.slice(requestLogs.length - maxRequestLogs);
  }
  const sub = inspectorSubscriber;
  if (sub) {
    setImmediate(() => {
      try {
        sub(entry);
      } catch {
        /* ignore */
      }
    });
  }
}

/**
 * Newest entries are last (matches gotunnel GetLogs).
 * @returns {Record<string, unknown>[]}
 */
export function getLogs() {
  return requestLogs.slice();
}

/**
 * @param {string} id
 * @returns {Record<string, unknown> | null}
 */
export function getLogById(id) {
  const want = String(id);
  for (let i = requestLogs.length - 1; i >= 0; i--) {
    const e = requestLogs[i];
    if (e && String(/** @type {{ id?: string }} */ (e).id) === want) return e;
  }
  return null;
}

/**
 * @returns {string}
 */
export function newLogId() {
  return randomUUID();
}
