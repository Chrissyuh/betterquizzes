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
const remote = read("mcp/remote-server.mjs");

for (const file of [
  "public/privacy/index.html",
  "public/privacy.html",
  "public/terms/index.html",
  "public/terms.html"
]) {
  assert(fs.existsSync(file), file + " is missing");
}

assert(remote.includes("bqV34ServeLegalPage"), "remote-server missing legal route helper");
assert(remote.includes('["/privacy", "privacy/index.html"]'), "remote-server missing /privacy route");
assert(remote.includes('["/terms", "terms/index.html"]'), "remote-server missing /terms route");
assert(remote.includes("if (bqV34ServeLegalPage(url, res)) return;"), "remote-server legal route hook missing");

assert(!app.includes("Open a sample quiz or import your own"), "homepage import wording still exists");
assert(!app.includes("Paste a QuizSpec v2 JSON object"), "old import heading still exists");
assert(!app.includes("Paste a BetterQuizzes quiz JSON packet here"), "import textarea placeholder still exists");
assert(app.includes("Interactive quizzes that feel built for the lesson."), "landing hero should remain");
assert(app.includes("site-footer"), "footer/legal links should remain");

console.log("V34 legal routes and homepage cleanup guards passed.");

if (failures.length) {
  console.error("V34 guards failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}
