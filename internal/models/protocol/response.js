/**
 * Wire format: JSON line from client → tunnel server (per yamux stream).
 * Matches gotunnel / devtunnel Go `TunnelResponse`.
 *
 * @typedef {Object} TunnelResponse
 * @property {number} Status
 * @property {Record<string, string[]>} Headers
 * @property {string} Body base64 (Go encoding/json for []byte)
 */

module.exports = {};
