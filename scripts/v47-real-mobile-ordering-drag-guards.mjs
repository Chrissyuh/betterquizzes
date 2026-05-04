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

assert(app.includes("function bqV47InstallMobileOrderingDrag"), "V47 drag installer missing");
assert(app.includes("bqV47DispatchDesktopDragSequence"), "V47 must simulate desktop drag/drop events");
assert(app.includes("new DragEvent"), "V47 DragEvent simulation missing");
assert(app.includes("passive: false"), "V47 pointermove must be passive:false");
assert(app.includes("MutationObserver"), "V47 DOM enhancer observer missing");
assert(app.includes("return bqV47InstallMobileOrderingDrag();"), "V47 installer is not mounted");
assert(!app.includes("bqV46bInstallOrderingDrag"), "old V46b drag installer still exists");

assert(css.includes("V47 real mobile ordering drag"), "V47 CSS block missing");
assert(!css.includes("V46 mobile ordering controls"), "old V46 controls CSS still exists");
assert(!css.includes("V46b mobile drag ordering"), "old V46b CSS still exists");
assert(css.includes(".bq-v47-drag-handle"), "V47 handle class missing");
assert(css.includes("radial-gradient(circle, #64748b"), "V47 clean grip icon missing");
assert(css.includes("touch-action: none !important"), "V47 handle touch-action missing");
assert(css.includes(".bq-v47-drag-over"), "V47 drop target styling missing");

if (failures.length) {
  console.error("V47 real mobile ordering drag guards failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("V47 real mobile ordering drag guards passed.");
