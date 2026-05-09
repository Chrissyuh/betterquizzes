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

assert(app.includes("function bqV51InstallPointerOrderingReorder"), "V51 pointer installer missing");
assert(app.includes("bqV51EnsureOrderingHandle"), "V51 direct handle injection missing");
assert(app.includes("document.createElement(\"button\")"), "V51 handle button creation missing");
assert(app.includes("betterquizzes:v51-ordering-reorder"), "V51 reorder event missing");
assert(app.includes("updateDraft(current.id, { response: nextOrder })"), "V51 React state update missing");
assert(app.includes("passive: false"), "V51 pointermove must be passive:false");
assert(app.includes("questionRailTouchedAtRef"), "V51 rail cooldown missing");
assert(!app.includes("bqV46bInstallOrderingDrag"), "old V46b installer still exists");
assert(!app.includes("bqV47InstallMobileOrderingDrag"), "old V47 installer still exists");
assert(!app.includes("bqV48InstallPointerOrderingDrag"), "old V48 installer still exists");
assert(!app.includes("bqV49InstallPointerOrderingReorder"), "old V49 installer still exists");

assert(css.includes("V51 real ordering handles"), "V51 CSS missing");
assert(css.includes(".bq-v51-order-handle"), "V51 handle CSS missing");
assert(css.includes("touch-action: none !important"), "V51 handle touch-action missing");
assert(css.includes("-webkit-user-drag: none !important"), "V51 webkit native drag disabling missing");
assert(css.includes(".bq-v51-slot-before") && css.includes(".bq-v51-slot-after"), "V51 insertion slot preview missing");
assert(css.includes("grid-template-columns: minmax(0, 1fr) auto !important"), "V51 row layout must reserve handle column");

if (failures.length) {
  console.error("V51 real ordering handles guards failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("V51 real ordering handles guards passed.");
