#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const requiredFiles = [
  "Dockerfile",
  "deploy/render.yaml",
  "deploy/fly.toml",
  ".env.example",
  "docs/stage-9-host-trial.md",
  "docs/stage-10-official-sdk.md",
  "docs/official-sdk-decision.md",
  "mcp/remote-server.mjs",
  "dist/index.html",
  "scripts/trial-probe.mjs",
  "scripts/local-host-trial.mjs"
];

const checks = requiredFiles.map((file) => [existsSync(file), `${file} exists`]);
const remote = readFileSync("mcp/remote-server.mjs", "utf8");
checks.push([remote.includes("/connector-card.json"), "remote server serves connector-card.json"]);
checks.push([remote.includes("PUBLIC_BASE_URL") || remote.includes("PUBLIC_ORIGIN"), "remote server supports public origin override"]);
checks.push([readFileSync(".env.example", "utf8").includes("PUBLIC_BASE_URL"), ".env.example documents PUBLIC_BASE_URL"]);

for (const [ok, label] of checks) console.log(`${ok ? "✓" : "✗"} ${label}`);
const failures = checks.filter(([ok]) => !ok);
if (failures.length) {
  console.error(`Deploy package check failed: ${failures.length} failed check(s).`);
  process.exit(1);
}
console.log("Stage 12 deploy package check passed.");
