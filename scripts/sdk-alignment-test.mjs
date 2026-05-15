#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const requiredDeps = ["@modelcontextprotocol/sdk", "@modelcontextprotocol/ext-apps", "zod"];
const missingDeps = requiredDeps.filter((dep) => !(dep in (pkg.dependencies || {})));
if (missingDeps.length) throw new Error(`Missing SDK dependencies: ${missingDeps.join(", ")}`);

const sdkServerPath = "mcp/sdk-stdio-server.mjs";
if (!existsSync(sdkServerPath)) throw new Error(`${sdkServerPath} missing`);
const sdkServer = readFileSync(sdkServerPath, "utf8");
if (!sdkServer.includes('import "./betterquizzes-app-server.mjs"')) {
  throw new Error("SDK stdio command must route through the canonical BetterQuizzes stdio server to avoid tool-contract drift.");
}

const remoteServer = readFileSync("mcp/remote-server.mjs", "utf8");
const stableServer = readFileSync("mcp/betterquizzes-app-server.mjs", "utf8");
for (const text of [remoteServer, stableServer]) {
  const match = text.match(/const RESOURCE_URI = "([^"]+)";/);
  if (!match) throw new Error("Server resource URI missing.");
  if (!match[1].startsWith("ui://widget/")) throw new Error("Server resource URI must be a widget URI.");
  if (!/betterquiz/i.test(match[1])) throw new Error("Server resource URI must identify BetterQuizzes.");
  if (!text.includes("openai/outputTemplate")) throw new Error("Server missing openai/outputTemplate.");
}

console.log(JSON.stringify({
  ok: true,
  stage: "V1",
  migration: "hard-polish",
  stableHttpTransport: "preserved",
  checked: ["dependencies", "sdk stdio canonical shim", "tool/resource metadata", "V1 resource URI"]
}, null, 2));
