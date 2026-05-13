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

assert(remote.includes("BEGIN BETTERQUIZZES V45 LOUD ORDERING AUTHORING GUIDE"), "V45 ordering authoring guide block missing");
assert(remote.includes("ORDERING QUESTIONS ARE THE MOST COMMON SCHEMA FAILURE"), "V45 loud warning missing");
assert(remote.includes("BetterQuizzes V45 ordering authoring rules"), "V45 model instruction block missing");
assert(guidanceSurface.includes("V45 ORDERING CHECKLIST BEFORE add_question"), "V45 builder checklist missing");
assert(remote.includes("For ordering: type=ordering, use items, answer item ids, orderingBehavior.direction=top_to_bottom"), "add_question description missing ordering checklist");
assert(remote.includes("V45 ordering repair"), "repair_question description missing V45 repair instructions");
assert(guidanceSurface.includes("V45 ORDERING WARNING: orderingBehavior.direction is never conceptual"), "start_quiz builder instructions missing V45 warning");
assert(remote.includes("Best value is top_to_bottom"), "schema direction warning missing");
assert(remote.includes("direction must be exactly \"top_to_bottom\" every single time"), "model instruction top_to_bottom rule missing");
assert(remote.includes("Never use first_to_last"), "forbidden first_to_last guidance missing");
assert(remote.includes("first-to-last"), "forbidden hyphenated first-to-last guidance missing");
assert(remote.includes("chronological"), "forbidden chronological guidance missing");
assert(remote.includes("left_to_right"), "forbidden left_to_right guidance missing");
assert(remote.includes("use items, answer item ids"), "ordering shape checklist missing");
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
