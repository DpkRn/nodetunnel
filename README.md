# @dpkrn/nodetunnel

Give your **local** HTTP server a **public URL** from Node.js — useful for webhooks, demos, sharing a dev server, or testing from another device.

---

## Why use it

- **No separate tunnel process** — call one function from your app.
- **Works with your existing server** — Express, Fastify, or plain `http`.
- **Simple API** — you get a public `url` and a `stop()` when you are done.

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
| `options` | Optional. `{ host?: string, serverPort?: number }` — where to reach your tunnel server (defaults: `localhost` and `9000`). |

**Returns:** `{ url, stop }`

| Field | Description |
|-------|-------------|
| `url` | Public URL people can hit. |
| `stop` | Call to tear down the tunnel. |

Errors **reject** the promise — use `try/catch`.

---

## Troubleshooting

- **Connection / tunnel failed** — Confirm your tunnel server is running and that `host` / `serverPort` match your setup.
- **Nothing loads on the public URL** — Confirm your local server is already listening on the port you passed to `startTunnel`.
- **Port in use** — Pick another port or stop the other process using it.

---

## License

MIT — see [LICENSE](./LICENSE).
