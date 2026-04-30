#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const checks = [];
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
checks.push([pkg.name === "betterquizzes-v1", "package name is BetterQuizzes V1 brand fix"]);
checks.push([pkg.version === "1.0.0", "package version is 1.0.0"]);
checks.push([!JSON.stringify(pkg).includes("workspace:"), "no workspace protocol dependencies"]);
checks.push([existsSync("dist/index.html"), "production web build exists"]);
checks.push([existsSync("mcp/remote-server.mjs"), "remote MCP HTTP server exists"]);
checks.push([existsSync("mcp/betterquizzes-app-server.mjs"), "BetterQuizzes stdio MCP server exists"]);
checks.push([existsSync("docs/stage-9-host-trial.md"), "Stage 9 host-trial docs preserved"]);
checks.push([existsSync("docs/stage-10-official-sdk.md"), "Stage 10 official SDK docs preserved"]);
checks.push([existsSync("docs/connect-chatgpt-local.md"), "local connection guide exists"]);
checks.push([existsSync("docs/official-sdk-decision.md"), "official SDK decision doc exists"]);
checks.push([existsSync(".env.example"), "environment example exists"]);

const remote = readFileSync("mcp/remote-server.mjs", "utf8");
for (const needle of [
  "openai/outputTemplate",
  "openai/widgetAccessible",
  "text/html;profile=mcp-app",
  "structuredContent",
  "SubmissionCapsule",
  "notifications/initialized",
  "ping",
  "streamable-http",
  "PUBLIC_ORIGIN",
  "connectorCard",
  "Permissions-Policy"
]) {
  checks.push([remote.includes(needle), `remote server includes ${needle}`]);
}

const pkgText = JSON.stringify(pkg);
for (const needle of ["host:public", "host:public:strict", "connect:chatgpt", "tunnel:help", "deploy:package", "trial:local", "trial:public", "trial:doctor"]) {
  checks.push([pkgText.includes(needle), `package scripts include ${needle}`]);
}

const widget = readFileSync("src/host/openaiBridge.ts", "utf8");
checks.push([widget.includes("window.openai") || widget.includes("OpenAI"), "widget bridge includes ChatGPT host bridge support"]);

const failures = checks.filter(([ok]) => !ok);
for (const [ok, label] of checks) console.log(`${ok ? "✓" : "✗"} ${label}`);
if (failures.length) {
  console.error(`Host readiness failed: ${failures.length} failed check(s).`);
  process.exit(1);
}
console.log("V1 host readiness checks passed.");
