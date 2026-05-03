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
const remote = read("mcp/remote-server.mjs");

for (const file of [
  "public/privacy/index.html",
  "public/privacy.html",
  "public/terms/index.html",
  "public/terms.html"
]) {
  assert(fs.existsSync(file), file + " missing");
}

assert(remote.includes("BEGIN BETTERQUIZZES V35 LEGAL ROUTES"), "V35 legal route block missing");
assert(remote.includes("bqV35ServeLegalRoute(req, res)"), "early legal route hook missing");
assert(remote.includes('method !== "GET" && method !== "HEAD"'), "legal routes must allow GET and HEAD");
assert(remote.includes('["/privacy"'), "/privacy route missing");
assert(remote.includes('["/terms"'), "/terms route missing");

assert(app.includes('className="footer-button" href="/privacy"'), "small Privacy button missing");
assert(app.includes('className="footer-button" href="/terms"'), "small Terms button missing");
assert(css.includes("V35 footer legal buttons"), "footer button CSS missing");

assert(!app.includes("Open a sample quiz or import your own"), "old import heading still exists");
assert(!app.includes("Paste a QuizSpec v2 JSON object"), "old import heading still exists");
assert(!app.includes("Paste a BetterQuizzes quiz JSON packet here"), "old import placeholder still exists");

if (failures.length) {
  console.error("V35 guards failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("V35 legal route/footer guards passed.");
