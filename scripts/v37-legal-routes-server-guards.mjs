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

assert(remote.includes("BEGIN BETTERQUIZZES V37 LEGAL ROUTES"), "V37 legal route block missing");
assert(remote.includes("function bqV37ServeLegalRoute"), "V37 legal route function missing");
assert(remote.includes('method !== "GET" && method !== "HEAD"'), "V37 legal route must allow GET and HEAD");
assert(remote.includes('route === "/privacy"'), "/privacy route missing");
assert(remote.includes('route === "/terms"'), "/terms route missing");
assert(remote.includes("if (bqV37ServeLegalRoute("), "V37 legal route hook missing");

const hookIndex = remote.indexOf("if (bqV37ServeLegalRoute(");
const handlerIndex = remote.indexOf("createServer(");

assert(handlerIndex >= 0, "createServer handler missing");
assert(hookIndex > handlerIndex, "V37 legal route hook must be inside the createServer handler, not at file top");
assert(!remote.includes("bqV36ServeEarlyLegalRoute"), "broken V36 legal route code still exists");

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
  console.error("V37 legal route guards failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("V37 legal route guards passed.");
