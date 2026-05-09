#!/usr/bin/env node
import fs from "node:fs";

const quiz = JSON.parse(fs.readFileSync("public/examples/v49-ordering-smoke-test.json", "utf8"));

const failures = [];

function assert(value, message) {
  if (!value) failures.push(message);
}

assert(quiz.schema === "betterquizzer.quiz", "quiz schema missing");
assert(quiz.version === 2, "quiz version must be 2");
assert(Array.isArray(quiz.questions), "questions missing");
assert(quiz.questions.length >= 16, "smoke test should overflow the question numbering rail");

const requiredTags = [
  "alphabetical_az",
  "alphabetical_za",
  "numeric_ascending",
  "numeric_descending",
  "geometry_small_to_large",
  "geometry_large_to_small",
  "chronological",
  "reverse_chronological",
  "custom_sequence"
];

for (const tag of requiredTags) {
  assert(quiz.questions.some((question) => Array.isArray(question.tags) && question.tags.includes(tag)), "missing ordering coverage: " + tag);
}

for (const question of quiz.questions) {
  assert(question.type === "ordering", question.id + " must be ordering");
  assert(Array.isArray(question.items), question.id + " items missing");
  assert(Array.isArray(question.answer), question.id + " answer missing");
  assert(question.answer.length === question.items.length, question.id + " answer length mismatch");
  assert(question.orderingBehavior?.direction === "top_to_bottom", question.id + " direction must be top_to_bottom");
  const ids = new Set(question.items.map((item) => item.id));
  for (const id of question.answer) assert(ids.has(id), question.id + " answer references missing item id " + id);
}

if (failures.length) {
  console.error("V49 ordering smoke test failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("V49 ordering smoke test passed.");
