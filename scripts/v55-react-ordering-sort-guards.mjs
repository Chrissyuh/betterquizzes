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

assert(app.includes("const bqV61OrderingRebuild = true"), "V61 ordering rebuild marker missing");
assert(app.includes("function useOrderingInputMode"), "ordering mode detector missing");
assert(app.includes('"desktop" | "mobile"'), "ordering must model desktop and mobile separately");
assert(app.includes('window.matchMedia("(hover: hover) and (pointer: fine)")'), "desktop detection should use fine pointer/hover media query");
assert(app.includes("function insertionIndexFromPoint"), "pointer sorting insertion-index logic missing");
assert(app.includes("function moveByStep"), "fallback up/down movement missing");
assert(app.includes("function moveToIndex"), "direct index movement missing");
assert(app.includes("draggable={false}"), "native HTML draggable should be disabled for rebuilt sorter");
assert(app.includes("data-ordering-mode={inputMode}"), "ordering DOM must expose desktop/mobile mode");
assert(app.includes("inputMode === \"desktop\" ? (event) => beginDrag(event, id, \"desktop\")"), "desktop drag should start from rows");
assert(app.includes("onTouchStart={inputMode === \"mobile\" ? (event) => beginTouchDrag(event, id) : undefined}"), "mobile ordering should start from a handle touchstart handler");
assert(app.includes("beginMobilePointerFallbackDrag"), "mobile ordering should keep a pointer fallback separate from desktop row dragging");
assert(app.includes('document.addEventListener("touchmove", onDocumentTouchMove'), "mobile ordering should track touchmove with document-level listeners");
assert(app.includes('document.addEventListener("touchmove", onDocumentTouchMove, touchMoveOptions)'), "mobile ordering touchmove listener should use explicit options");
assert(app.includes("const touchMoveOptions = { capture: true, passive: false } as const"), "mobile ordering touchmove listener must be capture/passive:false");
assert(app.includes('document.removeEventListener("touchmove", onDocumentTouchMove, touchMoveOptions)'), "mobile ordering cleanup should remove touchmove listener");
assert(app.includes('document.removeEventListener("touchend", onDocumentTouchEnd'), "mobile ordering cleanup should remove touchend listener");
assert(app.includes('document.removeEventListener("touchcancel", onDocumentTouchCancel'), "mobile ordering cleanup should remove touchcancel listener");
assert(!app.includes('onPointerMove={inputMode === "mobile"'), "mobile drag must not depend on handle-scoped onPointerMove");
assert(app.includes("onKeyDown={(event) => onHandleKeyDown(event, id)}"), "keyboard sorting fallback missing");
assert(app.includes("Move up/down buttons"), "mobile user guidance missing");

assert(css.includes("V61 ordering rebuild"), "V61 ordering CSS block missing");
assert(css.includes('data-ordering-mode="desktop"'), "desktop-specific ordering CSS missing");
assert(/\.bq-ordering-rebuilt\[data-ordering-mode="mobile"\] \.draggable-order-item\s*\{[^}]*touch-action:\s*pan-y/s.test(css), "mobile row should preserve vertical panning");
assert(/\.bq-ordering-rebuilt\[data-ordering-mode="mobile"\] \.drag-handle\s*\{[^}]*touch-action:\s*none/s.test(css), "drag handle should own touch drag gestures");
assert(/\.bq-ordering-rebuilt\[data-ordering-mode="mobile"\] \.draggable-order-item\.dragging\s*\{[^}]*background:/s.test(css), "mobile dragging state should have immediate visual styling");
assert(css.includes(".bq-ordering-rebuilt .order-controls"), "fallback controls CSS missing");
assert(css.includes("@media (max-width: 720px), (hover: none), (pointer: coarse)"), "mobile-specific ordering CSS missing");
assert(css.includes("bq-ordering-drag-lock"), "drag scroll lock CSS missing");

if (remote) {
  assert(!remote.includes("destructiveHint: true"), "destructiveHint true still present");
  assert(!remote.includes("openWorldHint: true"), "openWorldHint true still present");
  assert(remote.includes("BetterQuizzes V55 tool metadata cleanup"), "V55 tool metadata cleanup instructions missing");
  assert(remote.includes("This tool modifies only the current draft; it is not destructive"), "add_question description not cleaned");
}

if (failures.length) {
  console.error("V61 ordering rebuild guards failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("V61 ordering rebuild guards passed.");
