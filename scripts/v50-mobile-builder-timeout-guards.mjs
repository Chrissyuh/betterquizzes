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

assert(remote.includes("Bulk questions in start_quiz are available for reliability or smoke tests"), "bulk-builder guidance missing");
assert(remote.includes("Do not send chat progress/check-in messages while authoring"), "quiet model instructions missing");
assert(remote.includes("Optional bulk question list"), "start_quiz questions preload schema missing");
assert(remote.includes("const rawQuestions = Array.isArray(input.questions)"), "start_quiz preload logic missing");
assert(remote.includes("questionCount: questions.length"), "start_quiz tiny response missing questionCount");
assert(remote.includes("Call open_quiz once to launch the stored quiz"), "start_quiz preload next-step missing");
assert(!remote.includes("draft,"), "builder tools should not echo full growing draft objects");
assert(!remote.includes("draft: existingDraft"), "add_question still echoes full growing draft");
assert(remote.includes("Required input shape: { draftId, question }"), "add_question description still unclear");
assert(remote.includes("Bulk questions are supported for smoke tests and reliability fallbacks"), "start_quiz description missing bulk reliability guidance");
assert(remote.includes("accepted questions are stored continuously"), "model staged update rule missing");

if (failures.length) {
  console.error("V50 mobile builder timeout guards failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("V50 mobile builder timeout guards passed.");
