#!/usr/bin/env node
import fs from "node:fs";

const failures = [];

function read(file) {
  return fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

function assert(value, message) {
  if (!value) failures.push(message);
}

const remote = read("mcp/remote-server.mjs");
const sharedGuidance = read("mcp/shared-authoring-guidance.mjs");
const guidanceSurface = remote + "\n" + sharedGuidance;

assert(guidanceSurface.includes("call add_question exactly once for the first question") && guidanceSurface.includes("once per remaining question"), "one-at-a-time builder guidance missing");
assert(guidanceSurface.includes("Do not send question batches in start_quiz"), "start_quiz batch rejection guidance missing");
assert(guidanceSurface.includes("Do not send chat progress/check-in messages while authoring"), "quiet model instructions missing");
assert(!remote.includes("Optional bulk question list"), "start_quiz must not advertise bulk preload schema");
assert(!remote.includes("const rawQuestions = Array.isArray(input.questions)"), "start_quiz must not process bulk preload logic");
assert(remote.includes("questionCount: 0"), "start_quiz response should start empty");
assert(remote.includes("then immediately call open_quiz before adding question 2"), "start_quiz next-step missing first-question open_quiz guidance");
assert(!remote.includes("draft,"), "builder tools should not echo full growing draft objects");
assert(!remote.includes("draft: existingDraft"), "add_question still echoes full growing draft");
assert(remote.includes("Required input shape: { draftId, question }"), "add_question description still unclear");
assert(!remote.includes('"openai/toolInvocation/invoking": "Adding question..."'), "add_question must not carry widget launch metadata");
assert(remote.includes("accepted questions are stored continuously"), "model staged update rule missing");

if (failures.length) {
  console.error("V50 mobile builder timeout guards failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("V50 mobile builder timeout guards passed.");
