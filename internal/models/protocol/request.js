/**
 * Wire format: JSON line from tunnel server → client (per yamux stream).
 * Matches gotunnel / devtunnel Go `TunnelRequest`.
 *
 * @typedef {Object} TunnelRequest
 * @property {string} Method
 * @property {string} Path
 * @property {Record<string, string[]>} [Headers]
 * @property {string} [Body] base64 (Go encoding/json for []byte)
 */

module.exports = {};
