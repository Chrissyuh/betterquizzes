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

assert(app.includes("function bqV49InstallPointerOrderingReorder"), "V49 pointer ordering installer missing");
assert(app.includes("betterquizzes:v49-ordering-reorder"), "V49 custom reorder event missing");
assert(app.includes("updateDraft(current.id, { response: nextOrder })"), "V49 React state update missing");
assert(app.includes("questionRailTouchedAtRef"), "V49 question rail cooldown ref missing");
assert(app.includes("scrollIntoView({ behavior: \"smooth\""), "V49 active question rail auto-scroll missing");
assert(app.includes("elapsed < 1600"), "V49 question rail cooldown missing");
assert(app.includes("draggable\"") || app.includes("draggable"), "V49 native drag disabling missing");
assert(!app.includes("bqV46bInstallOrderingDrag"), "old V46b ordering drag code still exists");
assert(!app.includes("bqV47InstallMobileOrderingDrag"), "old V47 ordering drag code still exists");
assert(!app.includes("bqV48InstallPointerOrderingDrag"), "old V48 ordering drag code still exists");

assert(css.includes("V49 ordering UX overhaul"), "V49 CSS block missing");
assert(css.includes(".bq-v49-order-handle"), "V49 custom handle CSS missing");
assert(css.includes("touch-action: none !important"), "V49 handle touch-action missing");
assert(css.includes("-webkit-user-drag: none"), "V49 webkit user drag disabling missing");
assert(css.includes(".bq-v49-slot-before") && css.includes(".bq-v49-slot-after"), "V49 insertion slot preview missing");
assert(!css.includes("V46 mobile ordering controls"), "old V46 CSS still exists");
assert(!css.includes("V46b mobile drag ordering"), "old V46b CSS still exists");
assert(!css.includes("V47 real mobile ordering drag"), "old V47 CSS still exists");
assert(!css.includes("V48 pointer ordering reorder"), "old V48 CSS still exists");

assert(fs.existsSync("public/examples/v49-ordering-smoke-test.json"), "public V49 smoke quiz missing");
assert(fs.existsSync("src/shared/examples/v49-ordering-smoke-test.json"), "shared V49 smoke quiz missing");
assert(fs.existsSync("scripts/v49-ordering-smoke-test.mjs"), "V49 smoke script missing");

if (remote) {
  assert(remote.includes("BEGIN BETTERQUIZZES V49 ORDERING SEMANTICS"), "V49 remote ordering semantics block missing");
  assert(remote.includes("bqV49ComputeOrderingAnswer"), "V49 deterministic answer computation missing");
  assert(remote.includes("alphabetical_az"), "V49 alphabetical rule missing");
  assert(remote.includes("numeric_descending"), "V49 numeric descending rule missing");
  assert(remote.includes("custom_sequence"), "V49 custom sequence rule missing");
}

if (failures.length) {
  console.error("V49 ordering UX guards failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("V49 ordering UX guards passed.");
