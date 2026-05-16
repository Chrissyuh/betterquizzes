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
  "scripts/local-host-trial.mjs",
  "scripts/submission-readiness.mjs"
];

const checks = requiredFiles.map((file) => [existsSync(file), `${file} exists`]);
const remote = readFileSync("mcp/remote-server.mjs", "utf8");
const dockerfile = readFileSync("Dockerfile", "utf8");
const renderYaml = readFileSync("deploy/render.yaml", "utf8");
const flyToml = readFileSync("deploy/fly.toml", "utf8");
const envExample = readFileSync(".env.example", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
checks.push([remote.includes("/connector-card.json"), "remote server serves connector-card.json"]);
checks.push([remote.includes("PUBLIC_BASE_URL") || remote.includes("PUBLIC_ORIGIN"), "remote server supports public origin override"]);
checks.push([envExample.includes("PUBLIC_BASE_URL"), ".env.example documents PUBLIC_BASE_URL"]);
checks.push([envExample.includes("WIDGET_DOMAIN"), ".env.example documents WIDGET_DOMAIN"]);
checks.push([remote.includes('"openai/widgetDomain": domain') && remote.includes("DEFAULT_WIDGET_DOMAIN"), "remote server advertises widget domain metadata"]);
checks.push([renderYaml.includes("WIDGET_DOMAIN") && renderYaml.includes("https://app.betterquizzes.com"), "Render env config sets submission widget domain"]);
checks.push([flyToml.includes("WIDGET_DOMAIN") && flyToml.includes("https://app.betterquizzes.com"), "Fly env config sets submission widget domain"]);
checks.push([dockerfile.includes("package-lock.json") && dockerfile.includes("npm ci"), "Docker build uses package-lock.json with npm ci"]);
checks.push([renderYaml.includes("npm ci --no-audit --no-fund && npm run build"), "Render build uses package-lock.json with npm ci"]);
checks.push([pkg.scripts?.["submission:readiness"], "package scripts include submission:readiness"]);

for (const [ok, label] of checks) console.log(`${ok ? "✓" : "✗"} ${label}`);
const failures = checks.filter(([ok]) => !ok);
if (failures.length) {
  console.error(`Deploy package check failed: ${failures.length} failed check(s).`);
  process.exit(1);
}
console.log("Stage 12 deploy package check passed.");
