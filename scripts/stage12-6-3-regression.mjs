#!/usr/bin/env node
import { readFileSync } from "node:fs";

function read(path) { return readFileSync(path, "utf8"); }
function assert(condition, message) { if (!condition) throw new Error(message); }

const app = read("src/App.tsx");
const dist = read("dist/assets/index-DfQnKSgH.js");
const submission = read("src/shared/submission.ts");
const remote = read("mcp/remote-server.mjs");
const appServer = read("mcp/betterquizzer-app-server.mjs");
const css = read("src/styles.css");

assert(remote.includes('stage: "12.7.0"'), "manifest/debug stage must be 12.7.0");
assert(remote.includes("betterquizzer-stage12-7-0-build-bq1270.html"), "current widget URI must cache-bust for 12.7.0");
assert(remote.includes("betterquizzer-stage12-6-2-build-bq1262.html"), "12.6.2 widget URI must stay as a compatibility alias");
assert(remote.includes('uri: RESOURCE_URI'), "resource reads should return the canonical current URI even for alias requests");
assert(remote.includes('betterquizzer/requestedResourceUri'), "alias resource reads should expose requested URI diagnostics");
assert(appServer.includes('uri: RESOURCE_URI'), "app server resource reads should return the canonical current URI");
assert(app.includes("safeElapsedMs"), "time tracking must keep safeElapsedMs clamps");
assert(app.includes("sanitizeDraftForQuestion"), "restored drafts must still be sanitized by question type");
assert(submission.includes("answerHasResponseForQuestion"), "shared completion must validate answers by question type");
assert(!app.includes("drag-handle"), "source ordering UI should not show the rough drag handle in 12.7.0");
assert(!app.includes("Use the drag handle to reorder"), "source ordering copy should not reference drag handles in 12.7.0");
assert(!dist.includes("drag-handle"), "built ordering UI should not show the rough drag handle in 12.7.0");
assert(!dist.includes("Use the drag handle to reorder"), "built ordering copy should not reference drag handles in 12.7.0");
assert(css.includes("Stage 12.7.0 hotfix: revert ordering"), "CSS must include the 12.7.0 ordering revert block");
console.log("Stage 12.7.0 alias metadata + ordering revert checks passed.");
