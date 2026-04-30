#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const checks = [];
checks.push([pkg.name === "betterquizzes-v1", "package name is betterquizzes-v1"]);
checks.push([pkg.version === "1.0.0", "package version is 1.0.0"]);
checks.push([Number(process.versions.node.split(".")[0]) >= 18, `Node ${process.versions.node} supports fetch and modern ESM`]);
checks.push([existsSync("mcp/remote-server.mjs"), "remote HTTP MCP server exists"]);
checks.push([existsSync("mcp/betterquizzes-app-server.mjs"), "BetterQuizzes stdio MCP server exists"]);
checks.push([existsSync("scripts/trial-probe.mjs"), "V1 trial probe exists"]);
checks.push([existsSync("scripts/local-host-trial.mjs"), "local host trial runner exists"]);
checks.push([existsSync("docs/stage-9-host-trial.md"), "Stage 9 host-trial docs preserved"]);
checks.push([existsSync("docs/stage-10-official-sdk.md"), "official SDK docs exist"]);
checks.push([existsSync("dist/index.html"), "production dist exists; run npm run build if this fails"]);

const publicBase = (process.env.PUBLIC_BASE_URL || process.env.PUBLIC_ORIGIN || "").replace(/\/$/, "");
if (publicBase) {
  checks.push([publicBase.startsWith("https://"), "PUBLIC_BASE_URL/PUBLIC_ORIGIN is HTTPS"]);
} else {
  checks.push([true, "PUBLIC_BASE_URL not set; public trial will be skipped until deployment"]);
}

const failed = checks.filter(([ok]) => !ok);
for (const [ok, label] of checks) console.log(`${ok ? "✅" : "❌"} ${label}`);
if (failed.length) process.exit(1);
console.log("V1 host trial doctor passed.");
