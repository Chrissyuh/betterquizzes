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

assert(app.includes("function BetterQuizzesHomeLegalLinks"), "home legal links component missing");
assert(app.includes("isChatGptHost"), "ChatGPT host detection missing");
assert(app.includes('"openai" in window'), "OpenAI host bridge detection missing");
assert(app.includes("window.parent !== window"), "iframe host detection missing");
assert(app.includes("if (isChatGptHost) return null;"), "legal links are not hidden in ChatGPT");
assert(app.includes('href="/privacy"'), "public Privacy link should still exist");
assert(app.includes('href="/terms"'), "public Terms link should still exist");
assert(app.includes("<BetterQuizzesHomeLegalLinks />"), "homepage legal link component should still render on public site");

if (failures.length) {
  console.error("V39 ChatGPT legal-link guards failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("V39 ChatGPT legal-link guards passed.");
