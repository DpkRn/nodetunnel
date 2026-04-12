import { randomUUID } from 'node:crypto';

const defaultMaxRequestLogs = 100;

/** @type {number} */
let maxRequestLogs = defaultMaxRequestLogs;
/** @type {Array<Record<string, unknown>>} */
let requestLogs = [];

/** @type {((entry: Record<string, unknown>) => void) | null} */
let inspectorSubscriber = null;

/**
 * Wire live inspector WebSocket broadcast (optional).
 * @param {((entry: Record<string, unknown>) => void) | null} fn
 */
export function setInspectorSubscriber(fn) {
  inspectorSubscriber = fn;
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
 * @returns {string}
 */
export function newLogId() {
  return randomUUID();
}
