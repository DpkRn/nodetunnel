import express from "express";
import { startTunnel } from "@dpkrn/nodetunnel";


const app = express();
app.set("etag", false);
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

app.listen(PORT, async () => {
  console.log(`listening on http://127.0.0.1:${PORT}`);
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
