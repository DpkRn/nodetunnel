'use strict';

/**
 * Public API: expose a local HTTP server through a gotunnel-compatible tunnel server.
 *
 * @example
 * import http from 'node:http';
 * import { startTunnel } from '@dpkrn/nodetunnel';
 *
 * const server = http.createServer((req, res) => {
 *   res.end('ok');
 * });
 * server.listen(8080, async () => {
 *   const { url, stop } = await startTunnel('8080');
 *   console.log('Public URL:', url);
 *   process.on('SIGINT', () => { stop(); process.exit(0); });
 * });
 */

import { newTunnel } from '../../internal/tunnel/tunnel.js';
import { inspectorHTTPBaseURL } from '../../internal/inspector/inspector.js';

/**
 * Print a formatted success message for the tunnel.
 * @param {string} publicURL
 * @param {string} localURL
 * @param {string} [inspectorURL] when empty, inspector line is omitted
 */
function printSuccess(publicURL, localURL, inspectorURL) {
  console.log();
  console.log('  ╔══════════════════════════════════════════════════╗');
  console.log('  ║  🚇  nodetunnel — tunnel is live                 ║');
  console.log('  ╠══════════════════════════════════════════════════╣');
  console.log(`  ║  🌍  Public   →  ${publicURL.padEnd(32)}║`);
  console.log(`  ║  💻  Local    →  ${localURL.padEnd(32)}║`);
  if (inspectorURL) {
    console.log(`  ║  🔍  Inspector → ${inspectorURL.padEnd(32)}║`);
  }
  console.log(`  ╠══════════════════════════════════════════════════╣`);
  console.log('  ║  ⚡  Forwarding requests...                      ║');
  console.log('  ║  🛑  Press Ctrl+C to stop                        ║');
  console.log('  ╚══════════════════════════════════════════════════╝');
  console.log();
}

/**
 * Connect to the tunnel server and forward public HTTP traffic to localhost:<port>.
 *
 * @param {string} port local port (e.g. "8080")
 * @param {{
 *   host?: string,
 *   serverPort?: number,
 *   inspector?: boolean,
 *   logs?: number,
 *   inspectorAddr?: string,
 * }} [options] Omit or leave defaults for tunnel-only (`inspector` defaults to false).
 * @returns {Promise<{ url: string, stop: () => void }>}
 */
async function startTunnel(port, options) {
  const tunnel = await newTunnel(String(port), options);

  const publicURL = tunnel.getPublicUrl();
  const localURL = `http://localhost:${port}`;
  const insp =
    tunnel.options.inspector === false ? '' : inspectorHTTPBaseURL(tunnel.options);
  printSuccess(publicURL, localURL, insp);

  return {
    url: publicURL,
    stop: () => tunnel.stop(),
  };
}

export { startTunnel };
