#!/usr/bin/env node
import fs from "node:fs";

const failures = [];

function read(file) {
  return fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function hasTool(source, tool) {
  return source.includes("name: " + JSON.stringify(tool)) || source.includes('"name": ' + JSON.stringify(tool));
}

const remote = read("mcp/remote-server.mjs");
const app = read("src/App.tsx");
const types = read("src/shared/types.ts");
const sdk = read("mcp/sdk-stdio-server.mjs");

for (const tool of [
  "start_quiz",
  "add_question",
  "repair_question",
  "finalize_quiz",
  "record_grade",
  "get_grade"
]) {
  assert(hasTool(remote, tool), "remote-server.mjs missing tool definition for " + tool);
}

for (const token of [
  "START_QUIZ_INPUT_SCHEMA",
  "ADD_QUESTION_INPUT_SCHEMA",
  "FINALIZE_QUIZ_INPUT_SCHEMA",
  "V2_BUILDER_INSTRUCTIONS",
  "function startQuiz",
  "function addQuestion",
  "function finalizeQuiz"
]) {
  assert(remote.includes(token), "remote-server.mjs missing " + token);
}

const toolsIndex = remote.indexOf("const tools = [");
const spreadIndex = remote.indexOf("...V23_BUILDER_TOOL_DEFS");

assert(toolsIndex >= 0, "remote-server.mjs missing live tools array");
assert(spreadIndex > toolsIndex, "V23 builder tools are not spread into the live tools array");
assert(remote.includes("return handleV23BuilderTool"), "builder tool dispatch is not wired");

for (const token of [
  "requireConfidence?: boolean",
  "confidenceRequired?: boolean",
  "disableConfidence?: boolean",
  "selections?: number[]"
]) {
  assert(types.includes(token), "types.ts missing " + token);
}

assert(
  types.includes('confidence?: boolean | "required" | "optional" | "disabled"'),
  "types.ts missing confidence union"
);

if (sdk.includes("#!/usr/bin/env node")) {
  assert(sdk.startsWith("#!/usr/bin/env node"), "sdk-stdio-server shebang must be first line");
}

assert(
  app.includes("getInitialOrderingOrder(question, items)") ||
    app.includes("getInitialOrderingOrder(currentQuestion, items)") ||
    app.includes("bqV26AvoidAlreadyCorrectOrdering"),
  "ordering initialOrder definition is missing"
);

assert(
  app.includes("bqV27OrderingInitialOrder") ||
    app.includes("bqV27OrderingDisplayOrder") ||
    app.includes("bqV27OrderingInitialOrder") ||
    app.includes("bqV27OrderingDisplayOrder") ||
    app.includes("response.length ? response : initialOrder"),
  "ordering initialOrder fallback is missing"
);

if (fs.existsSync("scripts/v1-regression.mjs")) {
  const regression = read("scripts/v1-regression.mjs");
  assert(!regression.includes("remoteServer"), "v1-regression still references remoteServer");
}

if (failures.length) {
  console.error("V23 regression guards failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("V23 regression guards passed.");
