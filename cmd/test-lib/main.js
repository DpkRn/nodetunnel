import express from "express";
import { startTunnel } from "../../pkg/tunnel/tunnel.js";


const app = express();
app.set("etag", false);
app.use(express.json());
const PORT = process.env.PORT || 8080;
/** Random id per process — if this doesn’t match your terminal on each restart, another process is bound to the port. */
const INSTANCE = Math.random().toString(36).slice(2, 10);

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    uptime: process.uptime(),
    timestamp: Date.now(),
    message: "Server is healthy 🚀",
  });
});

const ROOT_DELAY_MS = 10_000;

// Return a Promise so Express 5’s router waits (see router Layer.handleRequest).
app.get("/", async (req, res) => {
  
  await new Promise((resolve) => setTimeout(resolve, ROOT_DELAY_MS));
  res.send("Backend is running");
});

/**
 * POST echo: path params (`:category`, `:itemId`), query string, and JSON body.
 * Example: POST /test/widgets/42?verbose=1&tag=a with body `{"name":"x"}`
 */
app.post("/test/:category/:itemId", (req, res) => {
  res.status(200).json({
    pathParams: req.params,
    query: req.query,
    body: req.body,
  });
});

app.listen(PORT, async () => {
  console.log(`listening on http://localhost:${PORT}`);
  try {
    const { url, stop } = await startTunnel(String(PORT));
    process.once("SIGINT", () => {
      stop();
      process.exit(0);
    });
  } catch (e) {
    console.error("Tunnel failed (is devtunnel server on :9000?):", e.message);
  }
});
