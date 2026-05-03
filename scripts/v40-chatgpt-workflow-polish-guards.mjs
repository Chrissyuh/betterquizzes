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

assert(app.includes("function bqV40IsChatGptHost"), "ChatGPT host detection helper missing");
assert(app.includes("bqV40ApplyHostClass();"), "ChatGPT host class application missing");
assert(css.includes("V40 calmer incomplete state and ChatGPT legal-link hiding"), "V40 CSS block missing");
assert(css.includes(".bq-chatgpt-host .home-legal-links"), "ChatGPT legal-link hiding CSS missing");
assert(css.includes("--bq-v40-needed-bg"), "calmer incomplete color tokens missing");

assert(remote.includes("BEGIN BETTERQUIZZES V40 CREATE_QUIZ WORKFLOW POLISH"), "V40 create_quiz workflow block missing");
assert(remote.includes("Prefer the incremental builder workflow for assistant-authored quizzes"), "incremental workflow guidance missing");
assert(remote.includes("Invalid create_quiz payload shape."), "compact create_quiz repair summary missing");
assert(remote.includes("show_correct_answers"), "alias repair guidance for show_correct_answers missing");
assert(remote.includes("allow_retake"), "alias repair guidance for allow_retake missing");
assert(remote.includes("BetterQuizzes V40 workflow guidance"), "model workflow guidance missing");

if (failures.length) {
  console.error("V40 polish guards failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("V40 polish guards passed.");
