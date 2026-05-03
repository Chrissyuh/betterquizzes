#!/usr/bin/env node
import fs from "node:fs";

const failures = [];

function read(file) {
  return fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

function assert(value, message) {
  if (!value) failures.push(message);
}

const css = read("src/styles.css");

assert(css.includes("V41 question nav overflow containment"), "V41 CSS block missing");
assert(css.includes("overflow-x: hidden !important"), "global horizontal overflow containment missing");
assert(css.includes(".question-dots"), "question-dots selector missing");
assert(css.includes("overflow-x: auto !important"), "question-dots horizontal scroll missing");
assert(css.includes("flex-wrap: nowrap !important"), "question-dots nowrap missing");
assert(css.includes("overscroll-behavior-x: contain"), "question-dots overscroll containment missing");
assert(css.includes(".nav-card") && css.includes("overflow: hidden !important"), "nav-card overflow containment missing");
assert(css.includes("flex: 0 0 auto !important"), "dot fixed flex sizing missing");

if (failures.length) {
  console.error("V41 question nav overflow guards failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("V41 question nav overflow guards passed.");
