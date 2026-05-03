#!/usr/bin/env node
import fs from "node:fs";

const failures = [];

function read(file) {
  return fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

const app = read("src/App.tsx");

assert(app.includes("function bqV27OrderingInitialOrder"), "App.tsx missing bqV27OrderingInitialOrder");
assert(app.includes("function bqV27OrderingDisplayOrder"), "App.tsx missing bqV27OrderingDisplayOrder");

assert(
  !app.includes("response.length ? response : initialOrder"),
  "App.tsx still contains runtime-unsafe response fallback to initialOrder"
);

assert(
  !app.includes("Array.isArray(response) && response.length ? response : initialOrder"),
  "App.tsx still contains runtime-unsafe Array.isArray fallback to initialOrder"
);

assert(
  !app.includes("response.length ? response : safeInitialOrder"),
  "App.tsx still contains stale safeInitialOrder fallback"
);

assert(
  app.includes("const initialOrder: string[] = [];"),
  "App.tsx missing last-resort initialOrder sentinel"
);

if (failures.length) {
  console.error("V27 ordering runtime guards failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("V27 ordering runtime guards passed.");
