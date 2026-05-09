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

assert(app.includes("function bqV52InstallDomOrderingDrag"), "V52 DOM ordering drag installer missing");
assert(app.includes("bqV52EnsureHandle"), "V52 handle upgrade missing");
assert(app.includes("touchstart") && app.includes("touchmove") && app.includes("touchend"), "V52 touch fallback missing");
assert(app.includes("bqV52ClickMoveSequence"), "V52 internal up/down move bridge missing");
assert(app.includes("return bqV52InstallDomOrderingDrag();"), "V52 installer not mounted in App");
assert(app.includes("passive: false"), "V52 mobile events must be passive:false");
assert(!app.includes("bqV51InstallPointerOrderingReorder"), "old V51 installer still exists");
assert(!app.includes("bqV49InstallPointerOrderingReorder"), "old V49 installer still exists");

assert(css.includes("V52 ordering handle and mobile reorder fix"), "V52 CSS block missing");
assert(css.includes(".drag-handle.bq-v52-order-handle"), "V52 must override old drag-handle styling");
assert(css.includes("touch-action: none !important"), "V52 handle touch-action none missing");
assert(css.includes("-webkit-user-drag: none !important"), "V52 native iOS drag disabling missing");
assert(css.includes(".bq-v52-slot-before") && css.includes(".bq-v52-slot-after"), "V52 insertion slot preview missing");

if (remote) {
  assert(remote.includes("BEGIN BETTERQUIZZES V52 ORDERING DIRECTION INPUT ALIASES"), "V52 ordering direction alias block missing");
  assert(remote.includes("BQ_V52_ORDERING_DIRECTION_INPUT_ALIASES"), "V52 alias enum missing");
  assert(remote.includes("numeric_ascending"), "V52 numeric_ascending alias missing");
  assert(remote.includes("ascending"), "V52 ascending alias missing");
  assert(remote.includes("Input accepts top_to_bottom plus common semantic aliases"), "V52 relaxed direction schema missing");
}

if (failures.length) {
  console.error("V52 ordering handle/schema guards failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("V52 ordering handle/schema guards passed.");
