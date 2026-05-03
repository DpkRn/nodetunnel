# @dpkrn/nodetunnel

Package **nodetunnel** exposes a local HTTP server on a public URL by establishing a persistent outbound TCP connection to a tunnel server.

It creates an outbound connection to a tunnel server and forwards incoming requests to your local application (e.g., `localhost:8080`).

From **Node.js**, you get a **public URL** for webhooks, demos, sharing a dev server, or testing from another device — without a separate tunnel daemon.

## Introduction

### Benefits

- Sharing your local server with others
- Testing webhooks (Stripe, GitHub, etc.)
- Remote debugging without deployment
- No port forwarding or firewall configuration needed
- Works behind NAT or private networks
- Simple integration with existing Node.js HTTP servers (Express, Fastify, plain `http`, etc.)
- Optional **traffic inspector**: local dashboard to capture tunneled requests, inspect them, and replay against your app

Incoming traffic reaches the public URL, is forwarded through the tunnel, and is proxied to your local HTTP server (e.g., `localhost:8080`).

This enables exposing local development servers without port forwarding, firewall changes, or public hosting.

### Requirements

- **Node.js 18+**
- A **tunnel server** must be running and reachable (configure `host` / `serverPort` — see **Options** under [API](#api) below).
- The port passed to `startTunnel` must match your local HTTP server port.
- Your local server must be running **before** or **concurrently** with `startTunnel`.

## Overview

**nodetunnel** exposes a local HTTP server on a public URL by connecting to a tunnel server you run separately. Traffic hits the tunnel first, then your app on `localhost`.

---

## Why use it

- **No separate tunnel process** — call one function from your app.
- **Works with your existing server** — Express, Fastify, or plain `http`.
- **Simple API** — you get a public `url` and a `stop()` when you are done.
- **Optional traffic inspector** — pass `inspector: true` to start a local HTTP UI on loopback (captures, replay, headers/bodies). By default the inspector is **off**. Themes are chosen **inside the inspector UI** (not via `startTunnel` options).

---

## Install

```bash
npm install @dpkrn/nodetunnel
```

This package is **ESM** (`import` / `export`).

---

## Quick Example

```js
import express from "express";
import { startTunnel } from "@dpkrn/nodetunnel";

const app = express();
const PORT = 8080;

app.get("/", (req, res) => res.send("OK"));

app.listen(PORT, async () => {
  const { url, stop } = await startTunnel(String(PORT));
  // `url` — public URL for your server
  // `stop()` — closes the tunnel connection
});
```

---

## Easiest example

```js
import http from "node:http";
import { startTunnel } from "@dpkrn/nodetunnel";

const PORT = 8080;

const server = http.createServer((req, res) => {
  res.end("Hello\n");
});

server.listen(PORT, async () => {
  try {
    const { url, stop } = await startTunnel(String(PORT));
    console.log("Public URL:", url);

    process.on("SIGINT", () => {
      stop();
      server.close(() => process.exit(0));
    });
  } catch (e) {
    console.error("Tunnel failed:", e.message);
  }
});
```

Run with `node app.js`. Open the printed URL in a browser or share it for webhooks.

---

## Traffic inspector (optional local dashboard)

**Default:** `inspector` is **`false`** if you omit options or do not set `inspector`. No inspector server, no capture buffer, no extra listen port.

When **`inspector: true`**:

1. Starts a small **HTTP server on your machine** (default listen **`http://127.0.0.1:4040`**) that serves the inspector UI (override with `inspectorAddr`).
2. **Captures** each tunneled request/response in memory (up to **`logs`** entries) so the UI can list them and push updates over WebSocket.

When **`inspector` stays false** (the default):

- No inspector process runs — nothing listens on the inspector port.
- No traffic is stored for inspection (`logs` and `inspectorAddr` are ignored).
- The startup banner omits the **Inspector →** line.

### What you get with the inspector enabled

- **Live traffic** — tunneled requests appear in the UI (WebSocket updates).
- **History** — recent captures in memory (size limited by `logs`).
- **Inspect** — request/response headers and bodies (when captured).
- **Replay** — send a capture again to your local app, or edit method/path/headers/body and replay.

### Themes (inspector UI only)

Postman-style and Terminal-style palettes are available from the **Theme** dropdown in the inspector page; the choice is stored in the browser (localStorage). You do **not** configure themes on `startTunnel`.

### Example: inspector enabled with custom port and log limit

```js
import http from "node:http";
import { startTunnel } from "@dpkrn/nodetunnel";

const PORT = 3000;

const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "text/plain");
  res.end("hello\n");
});

server.listen(PORT, async () => {
  const { url, stop } = await startTunnel(String(PORT), {
    inspector: true,
    inspectorAddr: ":4040",
    logs: 100,
  });

  process.once("SIGINT", () => {
    stop();
    server.close(() => process.exit(0));
  });
});
```

Open the **Inspector →** URL printed on startup (e.g. `http://127.0.0.1:4040`).

### Example: tunnel only (default — same as omitting options)

`startTunnel(port)` / `startTunnel(port, {})` already keeps the inspector off. You only need `inspector: false` if you merge options from elsewhere and want to force it off:

```js
const { url, stop } = await startTunnel("8080"); // no inspector
```

---

## Express (same idea)

```js
import express from "express";
import { startTunnel } from "@dpkrn/nodetunnel";

const app = express();
const PORT = 8080;

app.get("/", (req, res) => res.send("OK"));

app.listen(PORT, async () => {
  try {
    const { url, stop } = await startTunnel(String(PORT));
    console.log("Public:", url);
    process.once("SIGINT", () => {
      stop();
      process.exit(0);
    });
  } catch (e) {
    console.error(e.message);
  }
});
```

---

## API

### `await startTunnel(port, options?)`

| Argument | Description |
|----------|-------------|
| `port` | String, e.g. `"8080"` — must match the port your HTTP server uses. |
| `options` | Optional. See **Options** below. |

**Returns:** `{ url, stop }`

| Field | Description |
|-------|-------------|
| `url` | Public URL people can hit. |
| `stop` | Call to tear down the tunnel (and the inspector, if it was started). |

Errors **reject** the promise — use `try/catch`.

### Options (`startTunnel` second argument)

| Field | Type | Default | Applies when |
|-------|------|---------|----------------|
| `host` | `string` | `'clickly.cv'` | Always — tunnel control server hostname. |
| `serverPort` | `number` | `9000` | Always — TCP port of the tunnel server. |
| `inspector` | `boolean` | `false` | Always — if `false` (default), no inspector UI, no capture store, and inspector-only options below are ignored. Set `true` to enable the local inspector. |
| `logs` | `number` | `100` | **`inspector: true` only** — max request/response captures kept in memory. |
| `inspectorAddr` | `string` | `':4040'` | **`inspector: true` only** — listen address for the inspector (e.g. `':4040'`, `'localhost:9090'`). |

---

## Troubleshooting

- **Connection / tunnel failed** — Confirm your tunnel server is running and that `host` / `serverPort` match your setup.
- **Nothing loads on the public URL** — Confirm your local server is already listening on the port you passed to `startTunnel`.
- **Port in use** — Pick another port or stop the other process using it.

---

## License

MIT — see [LICENSE](./LICENSE).
