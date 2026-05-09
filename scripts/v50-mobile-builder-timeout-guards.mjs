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

assert(remote.includes("BEGIN BETTERQUIZZES V50 MOBILE BUILDER TIMEOUT FIX"), "V50 guidance block missing");
assert(remote.includes("BetterQuizzes V50 mobile builder rules"), "V50 model instructions missing");
assert(remote.includes("Optional mobile-safe preload for large smoke tests"), "start_quiz questions preload schema missing");
assert(remote.includes("const preloadedQuestions = Array.isArray(input.questions)"), "start_quiz preload logic missing");
assert(remote.includes("questionCount: draft.questions.length"), "start_quiz tiny response missing questionCount");
assert(remote.includes("Questions are preloaded. Call finalize_quiz with this draftId."), "start_quiz preload next-step missing");
assert(!remote.includes("draft,\n    instructions: V2_BUILDER_INSTRUCTIONS"), "start_quiz still echoes full draft/instructions");
assert(!remote.includes("draft: existingDraft"), "add_question still echoes full growing draft");
assert(remote.includes("Required input shape: { draftId, question }"), "add_question description still unclear");
assert(remote.includes("For large mobile smoke tests, you may pass a questions array"), "start_quiz description missing large mobile guidance");
assert(remote.includes("Do not use 20+ sequential add_question calls for mobile smoke tests."), "model mobile timeout rule missing");

if (failures.length) {
  console.error("V50 mobile builder timeout guards failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("V50 mobile builder timeout guards passed.");
