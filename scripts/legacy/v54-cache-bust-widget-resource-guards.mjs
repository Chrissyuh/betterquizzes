#!/usr/bin/env node
import fs from "node:fs";

const failures = [];
const NEW_WIDGET_URI = "ui://widget/betterquizzes-v54.html";
const NEW_WIDGET_VERSION = "v54-cache-bust";

function read(file) {
  return fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

function assert(value, message) {
  if (!value) failures.push(message);
}

const remote = read("mcp/remote-server.mjs");
const app = fs.existsSync("src/App.tsx") ? read("src/App.tsx") : "";
const css = fs.existsSync("src/styles.css") ? read("src/styles.css") : "";

assert(remote.includes(NEW_WIDGET_URI), "remote server does not include new V54 widget URI");
assert(remote.includes("openai/outputTemplate"), "remote server missing openai/outputTemplate metadata");
assert(remote.includes(NEW_WIDGET_VERSION), "remote server missing V54 widget version marker");
assert(app.includes("BQ_V54_CLIENT_BUILD_MARKER") || app.length === 0, "client V54 marker missing");
assert(css.includes("V54 cache-bust marker") || css.length === 0, "CSS V54 marker missing");

const outputTemplateCount = (remote.match(/openai\/outputTemplate/g) || []).length;
assert(outputTemplateCount >= 1, "no outputTemplate entries found");

const oldLikelyUris = [
  "betterquizzes-v53.html",
  "betterquizzes-v52.html",
  "betterquizzes-v51.html",
  "betterquizzes-v49.html"
];

for (const oldUri of oldLikelyUris) {
  assert(!remote.includes(oldUri), "old widget URI still present: " + oldUri);
}

if (failures.length) {
  console.error("V54 cache-bust widget resource guards failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("V54 cache-bust widget resource guards passed.");
