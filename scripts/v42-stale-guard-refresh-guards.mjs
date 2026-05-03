#!/usr/bin/env node
import fs from "node:fs";

const failures = [];

function read(file) {
  return fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

function assert(value, message) {
  if (!value) failures.push(message);
}

const v39 = read("scripts/v39-hide-chatgpt-legal-links-guards.mjs");
const v1 = read("scripts/v1-regression.mjs");

assert(v39.includes("V39/V40 ChatGPT legal-link guards passed."), "V39 guard was not refreshed for V40");
assert(v1.includes("Quiz did not finish loading") || v1.includes("Quiz launch interrupted"), "v1 terminal recovery assertion was not refreshed");

if (failures.length) {
  console.error("V42 stale guard refresh guards failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("V42 stale guard refresh guards passed.");
