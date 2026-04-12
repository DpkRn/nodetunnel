# @dpkrn/nodetunnel

Give your **local** HTTP server a **public URL** from Node.js — useful for webhooks, demos, sharing a dev server, or testing from another device.

---

## Why use it

- **No separate tunnel process** — call one function from your app.
- **Works with your existing server** — Express, Fastify, or plain `http`.
- **Simple API** — you get a public `url` and a `stop()` when you are done.
- **Optional traffic inspector** — local dashboard on loopback to browse captures, replay requests, modify and pick a theme (see below).

---

## Requirements

- **Node.js 18+**
- Your app listening on a port (e.g. `8080`)
- A **tunnel server** reachable from your machine (default: `localhost:9000`)

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
  //url is your public url using you can access publicly your server
  //stop() is method that will close your connection on error
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

## Traffic inspector (local dashboard)

When enabled (default), nodetunnel starts a small **HTTP server on your machine** (default `http://localhost:4040`) with:

- **Live traffic** — requests proxied through the tunnel appear in the UI (WebSocket updates).
- **History** — recent captures kept in memory (configurable count); reload the page to fetch `/logs`.
- **Inspect** — request/response headers and bodies for each capture.
- **Modify** — modify request header/path and can replay.
- **Replay** — send a capture again to your local app, or edit method/path/headers/body and replay (aligned with the **gotunnel** inspector behavior).

The startup banner prints **Inspector →** with that URL. Set `inspector: false` if you do not want the UI or an extra listen port.

### Themes

The UI supports three built-in palettes via `themes` in `startTunnel` options:

| Value | Appearance |
|--------|----------------|
| **`"dark"`** (default) | Dark panels, blue accents — similar to GitHub-dark style. |
| **`"terminal"`** | Green-on-black “CRT” / terminal aesthetic, monospace UI font. |
| **`"light"`** | Light gray/white background, high-contrast text for bright environments. |

### Example: themes and inspector options

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
    // Inspector (defaults: enabled, :4040, dark theme, 100 logs)
    inspector: true,
    inspectorAddr: ":4040",
    themes: "terminal", // try: "dark" | "terminal" | "light"
    logs: 100,
  });

  // console.log("Public:", url);
  // Open the Inspector URL from stderr in a browser (e.g. http://127.0.0.1:4040)

  process.once("SIGINT", () => {
    stop();
    server.close(() => process.exit(0));
  });
});
```

### Example: tunnel only (no inspector)

```js
import { startTunnel } from "@dpkrn/nodetunnel";

const { url, stop } = await startTunnel("8080", {
  inspector: false,
});
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
| `options` | Optional. Object — see **Options** below (tunnel server address, inspector, themes, etc.). |

**Returns:** `{ url, stop }`

| Field | Description |
|-------|-------------|
| `url` | Public URL people can hit. |
| `stop` | Call to tear down the tunnel. |

Errors **reject** the promise — use `try/catch`.

### Options (`startTunnel` second argument)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `host` | `string` | `'clickly.cv'` | Hostname of the tunnel **control** server. |
| `serverPort` | `number` | `9000` | TCP port of the tunnel server. |
| `inspector` | `boolean` | `true` | If `true`, start the local traffic inspector UI (see [Traffic inspector](#traffic-inspector-local-dashboard)). If `false`, no extra HTTP server and no Inspector line in the banner. |
| `themes` | `string` | `'dark'` | Inspector palette: `'dark'`, `'terminal'`, or `'light'`. |
| `logs` | `number` | `100` | Maximum number of request/response captures kept in memory for the inspector. |
| `inspectorAddr` | `string` | `':4040'` | Listen address for the inspector (e.g. `':4040'`, `'127.0.0.1:9090'`). Display URL follows the same rules as the public banner. |

---

## Troubleshooting

- **Connection / tunnel failed** — Confirm your tunnel server is running and that `host` / `serverPort` match your setup.
- **Nothing loads on the public URL** — Confirm your local server is already listening on the port you passed to `startTunnel`.
- **Port in use** — Pick another port or stop the other process using it.

---

## License

MIT — see [LICENSE](./LICENSE).
