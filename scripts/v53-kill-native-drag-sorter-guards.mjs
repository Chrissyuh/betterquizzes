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

assert(app.includes("function bqV53InstallSortInteraction"), "V53 installer missing");
assert(app.includes("window.addEventListener(\"touchstart\""), "V53 touchstart capture missing");
assert(app.includes("window.addEventListener(\"pointerdown\""), "V53 pointerdown capture missing");
assert(app.includes("capture: true, passive: false"), "V53 must use capture passive:false");
assert(app.includes("bqV53ClickMoveSequence"), "V53 move-button reorder bridge missing");
assert(app.includes("draggable={false}"), "V53 JSX draggable=false patch missing");
assert(app.includes("return bqV53InstallSortInteraction();"), "V53 installer not mounted");
assert(!app.includes("bqV52InstallDomOrderingDrag"), "old V52 installer still mounted");
assert(!app.includes("bqV51InstallPointerOrderingReorder"), "old V51 installer still mounted");

assert(css.includes("V53 kill native drag sorter"), "V53 CSS block missing");
assert(css.includes(".drag-handle,"), "V53 must style existing drag-handle directly");
assert(css.includes("touch-action: none !important"), "V53 handle touch-action missing");
assert(css.includes("-webkit-user-drag: none !important"), "V53 webkit drag disabling missing");
assert(css.includes(".bq-v53-slot-before") && css.includes(".bq-v53-slot-after"), "V53 insertion slot preview missing");

if (failures.length) {
  console.error("V53 kill native drag sorter guards failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("V53 kill native drag sorter guards passed.");
