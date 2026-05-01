#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const requiredDeps = ["@modelcontextprotocol/sdk", "@modelcontextprotocol/ext-apps", "zod"];
const missingDeps = requiredDeps.filter((dep) => !(dep in (pkg.dependencies || {})));
if (missingDeps.length) throw new Error(`Missing SDK dependencies: ${missingDeps.join(", ")}`);

const sdkServerPath = "mcp/sdk-stdio-server.mjs";
if (!existsSync(sdkServerPath)) throw new Error(`${sdkServerPath} missing`);
const sdkServer = readFileSync(sdkServerPath, "utf8");
for (const required of [
  "@modelcontextprotocol/sdk/server/mcp.js",
  "@modelcontextprotocol/sdk/server/stdio.js",
  "server.registerTool",
  "server.registerResource",
  "ui://widget/betterquizzes-v1-build-bqv1p1.html",
  "openai/outputTemplate",
  "openai/widgetAccessible",
  "betterquizzer.submission"
]) {
  if (!sdkServer.includes(required)) throw new Error(`SDK server missing expected pattern: ${required}`);
}

const remoteServer = readFileSync("mcp/remote-server.mjs", "utf8");
const stableServer = readFileSync("mcp/betterquizzer-app-server.mjs", "utf8");
for (const text of [remoteServer, stableServer]) {
  if (!text.includes("ui://widget/betterquizzes-v1-build-bqv1p1.html")) throw new Error("Server resource URI not updated to stage12.");
}

console.log(JSON.stringify({
  ok: true,
  stage: "V1",
  migration: "hard-polish",
  stableHttpTransport: "preserved",
  checked: ["dependencies", "sdk stdio entrypoint", "tool/resource metadata", "V1 resource URI"]
}, null, 2));
