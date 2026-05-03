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

assert(remote.includes("BEGIN BETTERQUIZZES V45 LOUD ORDERING AUTHORING GUIDE"), "V45 ordering authoring guide block missing");
assert(remote.includes("ORDERING QUESTIONS ARE THE MOST COMMON SCHEMA FAILURE"), "V45 loud warning missing");
assert(remote.includes("BetterQuizzes V45 ordering authoring rules"), "V45 model instruction block missing");
assert(remote.includes("V45 ORDERING CHECKLIST BEFORE add_question"), "V45 builder checklist missing");
assert(remote.includes("V45 ordering checklist: for type=ordering"), "add_question description missing V45 checklist");
assert(remote.includes("V45 ordering repair"), "repair_question description missing V45 repair instructions");
assert(remote.includes("V45 final ordering check"), "finalize_quiz description missing V45 final check");
assert(remote.includes("V45 ordering reminder"), "start_quiz description missing V45 reminder");
assert(remote.includes("REQUIRED CONSTANT. Must always be exactly top_to_bottom"), "schema direction warning missing");
assert(remote.includes("direction must be exactly \"top_to_bottom\" every single time"), "model instruction top_to_bottom rule missing");
assert(remote.includes("Never use first_to_last"), "forbidden first_to_last guidance missing");
assert(remote.includes("first-to-last"), "forbidden hyphenated first-to-last guidance missing");
assert(remote.includes("chronological"), "forbidden chronological guidance missing");
assert(remote.includes("left_to_right"), "forbidden left_to_right guidance missing");
assert(remote.includes("use items, answer as item ids"), "ordering shape checklist missing");
assert(remote.includes("replace(/[\\s-]+/g, \"_\""), "normalizer should canonicalize spaces/hyphens");
assert(remote.includes("oldest_to_newest"), "extra chronological alias missing");
assert(remote.includes("largest_to_smallest"), "extra ranking alias missing");
assert(remote.includes("smallest_to_largest"), "extra ascending alias missing");

if (failures.length) {
  console.error("V45 louder ordering AI instructions guards failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("V45 louder ordering AI instructions guards passed.");
