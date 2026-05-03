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

assert(app.includes("function BetterQuizzesHomeLegalLinks"), "home legal links component missing");
assert(app.includes("<BetterQuizzesHomeLegalLinks />"), "home legal links component is not rendered");
assert(app.includes('href="/privacy"'), "Privacy link missing");
assert(app.includes('href="/terms"'), "Terms link missing");
assert(css.includes("V38 visible homepage legal links"), "V38 legal link CSS missing");
assert(css.includes(".home-legal-links"), "home legal links CSS class missing");

if (failures.length) {
  console.error("V38 homepage legal links guards failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("V38 homepage legal links guards passed.");
