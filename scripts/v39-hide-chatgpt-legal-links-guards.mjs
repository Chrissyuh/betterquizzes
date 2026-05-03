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
const css = fs.existsSync("src/styles.css") ? read("src/styles.css") : "";

assert(
  app.includes("function bqV40IsChatGptHost") ||
    app.includes("function BetterQuizzesHomeLegalLinks"),
  "ChatGPT host/legal-link handling missing"
);

assert(
  app.includes("bqV40ApplyHostClass();") ||
    app.includes("if (isChatGptHost) return null;"),
  "legal links are not hidden in ChatGPT"
);

assert(
  app.includes("window.parent !== window") ||
    app.includes('"openai" in window') ||
    css.includes(".bq-chatgpt-host .home-legal-links"),
  "ChatGPT host detection missing"
);

assert(app.includes('href="/privacy"'), "public Privacy link should still exist");
assert(app.includes('href="/terms"'), "public Terms link should still exist");

assert(
  app.includes("<BetterQuizzesHomeLegalLinks />") ||
    css.includes(".bq-chatgpt-host .home-legal-links"),
  "homepage legal link component or ChatGPT CSS hiding should still exist"
);

if (failures.length) {
  console.error("V39/V40 ChatGPT legal-link guards failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("V39/V40 ChatGPT legal-link guards passed.");
