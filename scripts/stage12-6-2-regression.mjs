#!/usr/bin/env node
import { readFileSync } from "node:fs";

function read(path) { return readFileSync(path, "utf8"); }
function assert(condition, message) { if (!condition) throw new Error(message); }
const app = read("src/App.tsx");
const submission = read("src/shared/submission.ts");
const remote = read("mcp/remote-server.mjs");
const css = read("src/styles.css");

assert(app.includes("safeElapsedMs"), "time tracking must use safeElapsedMs clamps");
assert(app.includes("clampDraftFirstSeenAt"), "draft timestamps must be clamped to current session");
assert(app.includes("sanitizeDraftForQuestion"), "restored drafts must be sanitized by question type");
assert(app.includes("sanitizeMatchingPairs"), "matching drafts must be sanitized");
assert(app.includes("targetIdFromPointer"), "ordering touch drag must track pointer target");
assert(app.includes("Use the drag handle to reorder"), "ordering copy should be explicit and user-facing");
assert(app.includes("Question ${index + 1}"), "submit validation should map question IDs to labels");
assert(submission.includes("answerHasResponseForQuestion"), "shared completion must validate answers by question type");
assert(submission.includes('question.type === "matching"'), "shared completion must validate matching answers");
assert(remote.includes('stage: "12.7.0"'), "manifest stage must be 12.7.0");
assert(remote.includes("betterquizzer-stage12-7-0-build-bq1270.html"), "widget URI must cache-bust for 12.7.0");
assert(css.includes("Stage 12.7.0 pre-freeze hardening"), "CSS hardening block must be present");
console.log("Stage 12.7.0 pre-freeze hardening checks passed.");
