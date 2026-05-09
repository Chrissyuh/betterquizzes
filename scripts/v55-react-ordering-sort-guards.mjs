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
const remote = fs.existsSync("mcp/remote-server.mjs") ? read("mcp/remote-server.mjs") : "";

assert(app.includes("function bqV55InstallSortInteraction"), "V55 sort installer missing");
assert(app.includes("betterquizzes:v55-ordering-reorder"), "V55 custom reorder event missing");
assert(app.includes("updateDraft(current.id, { response: nextOrder })"), "V55 React state update missing");
assert(app.includes("bqV55DispatchReactReorder"), "V55 dispatch-to-React path missing");
assert(app.includes("window.addEventListener(\"touchstart\""), "V55 touch capture missing");
assert(app.includes("window.addEventListener(\"pointerdown\""), "V55 pointer capture missing");
assert(app.includes("capture: true, passive: false"), "V55 must use capture passive:false");
assert(app.includes("draggable={false}"), "V55 native draggable JSX disable missing");
assert(app.includes("return bqV55InstallSortInteraction();"), "V55 installer not mounted");

assert(!app.includes("bqV53InstallSortInteraction"), "old V53 installer still present");
assert(!app.includes("bqV52InstallDomOrderingDrag"), "old V52 installer still present");
assert(!app.includes("bqV51InstallPointerOrderingReorder"), "old V51 installer still present");

assert(css.includes("V55 React ordering sort fix"), "V55 CSS missing");
assert(css.includes(".drag-handle,"), "V55 must style existing drag-handle");
assert(css.includes("touch-action: none !important"), "V55 handle touch-action missing");
assert(css.includes("-webkit-user-drag: none !important"), "V55 webkit native drag disabling missing");
assert(css.includes(".bq-v55-slot-before") && css.includes(".bq-v55-slot-after"), "V55 insertion slot preview missing");

if (remote) {
  assert(!remote.includes("destructiveHint: true"), "destructiveHint true still present");
  assert(!remote.includes("openWorldHint: true"), "openWorldHint true still present");
  assert(remote.includes("BetterQuizzes V55 tool metadata cleanup"), "V55 tool metadata cleanup instructions missing");
  assert(remote.includes("This tool modifies only the current draft; it is not destructive"), "add_question description not cleaned");
}

if (failures.length) {
  console.error("V55 React ordering sort guards failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("V55 React ordering sort guards passed.");
