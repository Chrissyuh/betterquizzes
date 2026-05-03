#!/usr/bin/env node
import fs from "node:fs";

const failures = [];

function read(file) {
  return fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

function assert(value, message) {
  if (!value) failures.push(message);
}

function isPng(file) {
  const bytes = fs.readFileSync(file);
  return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

const app = read("src/App.tsx");
const css = read("src/styles.css");

assert(app.includes("Interactive quizzes that feel built for the lesson."), "landing hero copy was not updated");
assert(app.includes("site-footer"), "site footer/legal links missing");
assert(app.includes('/privacy') && app.includes('/terms'), "privacy/terms links missing from app");
assert(css.includes("V29 brand/site/legal polish"), "V29 CSS block missing");
assert(css.includes("Fix clipped active-question aura"), "active-dot clipping repair CSS missing");
assert(fs.existsSync("public/privacy/index.html"), "privacy page missing");
assert(fs.existsSync("public/terms/index.html"), "terms page missing");
assert(fs.existsSync("public/privacy.html"), "privacy.html missing");
assert(fs.existsSync("public/terms.html"), "terms.html missing");
assert(isPng("public/brand/betterquizzes-logo-light.png"), "light brand logo is not PNG");
assert(isPng("public/brand/betterquizzes-logo-dark.png"), "dark brand logo is not PNG");
assert(isPng("public/favicon.png"), "favicon is not PNG");

if (failures.length) {
  console.error("V29 polish guards failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("V29 polish guards passed.");
