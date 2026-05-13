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
  "openai/outputTemplate",
  "openai/widgetAccessible",
  "betterquizzer.submission",
  "launchId: z.string().optional()",
  "quizRevision: z.number().int().min(0).optional()"
]) {
  if (!sdkServer.includes(required)) throw new Error(`SDK server missing expected pattern: ${required}`);
}
if (!sdkServer.includes('...(typeof args.launchId === "string"') || !sdkServer.includes("Number.isInteger(args.quizRevision)")) {
  throw new Error("SDK submit path must preserve launchId and quizRevision in SubmissionCapsule output.");
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
  checked: ["dependencies", "sdk stdio entrypoint", "tool/resource metadata", "V1 resource URI"]
}, null, 2));
