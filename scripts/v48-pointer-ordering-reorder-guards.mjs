#!/usr/bin/env node
import fs from "node:fs";

const failures = [];

function read(file) {
  return fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

function assert(value, message) {
  if (!value) failures.push(message);
}

const app = read("src/App.tsx");
const css = read("src/styles.css");

assert(app.includes("function bqV48InstallPointerOrderingDrag"), "V48 pointer drag installer missing");
assert(app.includes("betterquizzes:v48-ordering-reorder"), "V48 custom reorder event missing");
assert(app.includes("bqV48MoveArray"), "V48 array reorder helper missing");
assert(app.includes("updateDraft(current.id, { response: nextOrder })"), "V48 React state update missing");
assert(app.includes("passive: false"), "V48 pointermove must be passive false");
assert(app.includes("MutationObserver"), "V48 DOM enhancer observer missing");
assert(!app.includes("bqV46bInstallOrderingDrag"), "old V46b installer still exists");
assert(!app.includes("bqV47InstallMobileOrderingDrag"), "old V47 installer still exists");

assert(css.includes("V48 pointer ordering reorder"), "V48 CSS block missing");
assert(!css.includes("V46 mobile ordering controls"), "old V46 CSS still exists");
assert(!css.includes("V46b mobile drag ordering"), "old V46b CSS still exists");
assert(!css.includes("V47 real mobile ordering drag"), "old V47 CSS still exists");
assert(css.includes(".bq-v48-order-handle"), "V48 handle CSS missing");
assert(css.includes("touch-action: none !important"), "V48 handle must use touch-action none");
assert(css.includes("radial-gradient(circle, #64748b"), "V48 clean grip icon missing");

if (failures.length) {
  console.error("V48 pointer ordering reorder guards failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("V48 pointer ordering reorder guards passed.");
