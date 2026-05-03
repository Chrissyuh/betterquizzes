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
const bridge = read("src/host/openaiBridge.ts");

assert(app.includes("function bqV44ShouldUseEarlyMobileFollowUp"), "V44 mobile host detector missing");
assert(app.includes("navigator.maxTouchPoints"), "V44 mobile detector should include touch detection");
assert(app.includes("await sendSubmissionFollowUp(buildLlmReturnPrompt(submission), 4500)"), "V44 early follow-up send missing");
assert(app.includes('status: "grade_requested"'), "V44 should persist grade_requested when early follow-up succeeds");
assert(app.includes("followUpRequested: bqV44EarlyFollowUpSent"), "V44 should prevent duplicate follow-up after early mobile send");

assert(bridge.includes("sendFollowUpMessage.call(bridge, message)"), "V44 bridge should preserve host binding");
assert(bridge.includes("{ prompt, scrollToBottom: true }"), "V44 bridge should try desktop-style follow-up shape");
assert(bridge.includes("{ prompt }"), "V44 bridge should try mobile-safe follow-up shape");
assert(bridge.includes("{ prompt, scrollToBottom: false }"), "V44 bridge should try no-scroll follow-up shape");

if (failures.length) {
  console.error("V44 mobile grade follow-up guards failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("V44 mobile grade follow-up guards passed.");
