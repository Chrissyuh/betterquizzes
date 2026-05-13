#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";

const port = process.env.LOCAL_TRIAL_PORT || "8799";
const baseUrl = `http://127.0.0.1:${port}`;
const env = { ...process.env, HOST: "127.0.0.1", PORT: port, PUBLIC_BASE_URL: baseUrl, TRIAL_BASE_URL: baseUrl };
const probeArgs = process.argv.slice(2);

const server = spawn(process.execPath, ["mcp/remote-server.mjs"], { env, stdio: ["ignore", "pipe", "pipe"] });
server.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
server.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));

try {
  await waitForHealth(baseUrl);
  const result = spawnSync(process.execPath, ["scripts/trial-probe.mjs", ...probeArgs], { env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
} finally {
  server.kill();
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 8000;
  let lastError = "server not ready";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for local Stage 12.1 server at ${baseUrl}: ${lastError}`);
}
