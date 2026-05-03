#!/usr/bin/env node
import fs from "node:fs";

const failures = [];

function read(file) {
  return fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

function assert(value, message) {
  if (!value) failures.push(message);
}

const remote = read("mcp/remote-server.mjs");
const app = read("src/App.tsx");

assert(remote.includes("BEGIN BETTERQUIZZES V36 EARLY LEGAL ROUTES"), "V36 route block missing");
assert(remote.includes("bqV36ServeEarlyLegalRoute(req, res)"), "V36 early route hook missing");
assert(remote.includes('method !== "GET" && method !== "HEAD"'), "V36 route must support GET and HEAD");
assert(remote.includes('route === "/privacy"'), "/privacy route missing");
assert(remote.includes('route === "/terms"'), "/terms route missing");
assert(remote.indexOf("if (bqV36ServeEarlyLegalRoute(req, res)) return;") > remote.indexOf("createServer"), "V36 hook should be inside createServer handler");

assert(app.includes('className="footer-button" href="/privacy"'), "Privacy footer button missing");
assert(app.includes('className="footer-button" href="/terms"'), "Terms footer button missing");

for (const file of [
  "public/privacy/index.html",
  "public/privacy.html",
  "public/terms/index.html",
  "public/terms.html"
]) {
  assert(fs.existsSync(file), file + " missing");
}

if (failures.length) {
  console.error("V36 legal routes guards failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("V36 legal routes guards passed.");
