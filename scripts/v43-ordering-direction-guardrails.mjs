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

assert(remote.includes("BEGIN BETTERQUIZZES V43 ORDERING DIRECTION GUARDRAILS"), "V43 ordering guardrail block missing");
assert(remote.includes("orderingBehavior.direction must always be exactly top_to_bottom"), "V43 ordering direction note missing");
assert(remote.includes("Never use first_to_last"), "V43 forbidden alias guidance missing");
assert(remote.includes("function bqV43NormalizeOrderingBehavior"), "ordering behavior normalizer missing");
assert(remote.includes("function bqV43NormalizeOrderingAliasesDeep"), "deep ordering alias normalizer missing");
assert(remote.includes("bqV43NormalizeOrderingQuestion(question);"), "v23 question normalization hook missing");
assert(remote.includes("bqV43NormalizeOrderingAliasesDeep(input);"), "builder tool normalization hook missing");
assert(remote.includes("BetterQuizzes V43 ordering schema guidance"), "model instruction ordering guidance missing");
assert(remote.includes("Renderer layout axis only"), "schema direction description missing");
assert(remote.includes('direction: "top_to_bottom"'), "normalizer must force direction top_to_bottom");
assert(remote.includes("topLabel: \"First\"") || remote.includes('topLabel: "First"'), "First/Last alias labels missing");

if (failures.length) {
  console.error("V43 ordering direction guardrails failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("V43 ordering direction guardrails passed.");
