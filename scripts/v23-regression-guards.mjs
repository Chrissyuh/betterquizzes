#!/usr/bin/env node
import fs from "node:fs";

const failures = [];

function read(file) {
  return fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

const remote = read("mcp/remote-server.mjs");
for (const tool of [
  "start_quiz",
  "add_question",
  "repair_question",
  "finalize_quiz",
  "record_grade",
  "get_grade"
]) {
  assert(
    new RegExp('name\\s*:\\s*["\\']' + tool + '["\\']').test(remote),
    "mcp/remote-server.mjs does not expose " + tool
  );
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
  assert(remote.includes(token), "mcp/remote-server.mjs missing " + token);
}

const types = read("src/shared/types.ts");
for (const token of [
  "requireConfidence?: boolean",
  "confidenceRequired?: boolean",
  "disableConfidence?: boolean",
  "confidence?: boolean | \"required\" | \"optional\" | \"disabled\"",
  "selections?: number[]"
]) {
  assert(types.includes(token), "src/shared/types.ts missing " + token);
}

const sdk = read("mcp/sdk-stdio-server.mjs");
if (sdk.includes("#!/usr/bin/env node")) {
  assert(
    sdk.startsWith("#!/usr/bin/env node"),
    "mcp/sdk-stdio-server.mjs shebang must be the first line"
  );
}

const srcFiles = [
  ...fs.readdirSync("src", { recursive: true })
    .filter((file) => /\\.(tsx|ts|jsx|js)$/.test(String(file)))
    .map((file) => "src/" + String(file).replaceAll("\\\\", "/"))
    .filter((file) => fs.existsSync(file))
];

let sawOrdering = false;

for (const file of srcFiles) {
  const text = read(file);

  if (!text.includes("getInitialOrderingOrder") && !text.includes("OrderingList")) continue;

  sawOrdering = true;

  if (text.includes("initialOrder")) {
    const firstUse = text.indexOf("initialOrder");
    const definition = text.indexOf("const initialOrder");
    assert(
      definition >= 0 && definition <= firstUse,
      file + " uses initialOrder before defining it"
    );
  }

  if (text.includes("getInitialOrderingOrder")) {
    assert(
      text.includes("bqV23AvoidAlreadyCorrectOrdering") ||
        text.includes("response.length ? response : initialOrder") ||
        text.includes("Array.isArray(response) && response.length ? response : initialOrder"),
      file + " does not guard ordering initial display"
    );
  }
}

assert(sawOrdering, "No OrderingInput/OrderingList/getInitialOrderingOrder file found under src");

if (fs.existsSync("scripts/v1-regression.mjs")) {
  const regression = read("scripts/v1-regression.mjs");
  assert(!regression.includes("remoteServer"), "scripts/v1-regression.mjs still references remoteServer");
}

if (failures.length) {
  console.error("V23 regression guards failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("V23 regression guards passed.");
