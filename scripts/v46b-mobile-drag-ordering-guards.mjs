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

assert(app.includes("function bqV46bInstallOrderingDrag"), "V46b drag installer missing");
assert(app.includes("document.addEventListener(\"pointerdown\""), "V46b pointerdown listener missing");
assert(app.includes("document.addEventListener(\"pointermove\""), "V46b pointermove listener missing");
assert(app.includes("passive: false"), "V46b pointermove must be passive:false");
assert(app.includes("bqV46bClickMoveButtons"), "V46b drop-to-reorder click bridge missing");
assert(app.includes("return bqV46bInstallOrderingDrag();"), "V46b installer is not mounted in QuizRunner");
assert(app.includes('aria-label="Drag to reorder"') || app.includes("drag-handle"), "drag handle accessibility wording missing");

assert(css.includes("V46b mobile drag ordering"), "V46b CSS block missing");
assert(!css.includes("V46 mobile ordering controls"), "old V46 hide-handle CSS block should be removed");
assert(css.includes(".drag-handle") && css.includes("display: inline-flex !important"), "drag handle is not visible");
assert(css.includes("touch-action: none !important"), "drag handle touch-action none missing");
assert(css.includes("bq-ordering-drag-source"), "drag source styling missing");
assert(css.includes("bq-ordering-drag-over"), "drag over styling missing");
assert(css.includes("order-controls") && css.includes("display: none !important"), "mobile fallback controls should be hidden to keep drag UI clean");

if (failures.length) {
  console.error("V46b mobile drag ordering guards failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("V46b mobile drag ordering guards passed.");
