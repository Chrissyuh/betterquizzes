#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { lookup } from "node:dns/promises";

const CANONICAL_ORIGIN = "https://quizzes.trybettertools.com";
const CANONICAL_HOST = "quizzes.trybettertools.com";
const STALE_CANONICAL_ORIGIN = "https://app.betterquizzes.com";
const SUPPORT_EMAIL = "support@trybettertools.com";
const SUPPORT_PLACEHOLDERS = [
  "support@betterquizzes.example",
  "support@example.com",
  "support@trybettertools.example"
];
const RESOURCE_URI = "ui://widget/betterquizzes-v68-mobile-dot-fix.html";
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function read(path) {
  return readFileSync(path, "utf8");
}

async function checkDns() {
  try {
    const records = await lookup(CANONICAL_HOST, { all: true });
    check(records.length > 0, `${CANONICAL_HOST} must resolve before submission.`);
  } catch (error) {
    failures.push(`${CANONICAL_HOST} DNS lookup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function checkPublicHost() {
  let manifest = null;
  try {
    const response = await fetch(`${CANONICAL_ORIGIN}/.well-known/mcp-app.json`, { headers: { accept: "application/json" } });
    check(response.ok, `${CANONICAL_ORIGIN}/.well-known/mcp-app.json must return HTTP 200.`);
    manifest = await response.json().catch(() => null);
  } catch (error) {
    failures.push(`${CANONICAL_ORIGIN}/.well-known/mcp-app.json fetch failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (manifest) {
    check(manifest.transport?.endpoint === `${CANONICAL_ORIGIN}/mcp`, "public manifest must advertise the canonical custom-domain MCP endpoint.");
    check(manifest.widgetResource === RESOURCE_URI, "public manifest must advertise the v68 mobile-dot-fix widget resource.");
  }

  for (const path of ["/privacy", "/terms"]) {
    try {
      const response = await fetch(`${CANONICAL_ORIGIN}${path}`, { headers: { accept: "text/html" } });
      check(response.ok, `${CANONICAL_ORIGIN}${path} must return HTTP 200.`);
    } catch (error) {
      failures.push(`${CANONICAL_ORIGIN}${path} fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function checkLegalAndSubmissionFiles() {
  const legalFiles = [
    "public/privacy.html",
    "public/privacy/index.html",
    "public/terms.html",
    "public/terms/index.html"
  ];
  for (const file of legalFiles) {
    const text = read(file);
    check(text.includes("Effective date:"), `${file} must publish an effective date.`);
    check(text.includes("mailto:"), `${file} must publish a support contact email.`);
    check(text.includes("ChatGPT"), `${file} must disclose the ChatGPT handoff.`);
    check(text.includes("server memory") || text.includes("server-memory"), `${file} must disclose temporary server-memory storage.`);
    check(text.includes("sensitive personal information"), `${file} must warn against unnecessary sensitive personal information.`);
  }

  const appSubmission = JSON.parse(read("chatgpt-app-submission.json"));
  const serialized = JSON.stringify(appSubmission);
  check(!serialized.includes(STALE_CANONICAL_ORIGIN), "submission metadata must not use the stale app.betterquizzes.com URL.");
  check(!serialized.includes("start_quiz, add_question, open_quiz"), "submission test cases must not describe the stale add_question/open_quiz launch flow.");
  check(serialized.includes("add_first_question"), "submission test cases must describe the add_first_question launch flow.");
  check(serialized.includes("durable classroom gradebook"), "negative tests must reject durable classroom gradebook use.");
  check(serialized.includes("sensitive personal information"), "negative tests must cover sensitive personal information collection.");
  check(existsSync("docs/submission-final-checklist.md"), "final submission checklist doc must exist.");
  const finalChecklist = read("docs/submission-final-checklist.md");
  check(finalChecklist.includes(`${CANONICAL_ORIGIN}/mcp`), "final checklist must include the canonical MCP URL.");
  check(finalChecklist.includes(SUPPORT_EMAIL), "final checklist must include the production support email.");
}

function checkSupportReleaseBlocker() {
  const legalText = [
    read("public/privacy.html"),
    read("public/privacy/index.html"),
    read("public/terms.html"),
    read("public/terms/index.html")
  ].join("\n");
  check(legalText.includes(SUPPORT_EMAIL), `legal pages must publish ${SUPPORT_EMAIL}.`);
  for (const placeholder of SUPPORT_PLACEHOLDERS) {
    check(!legalText.includes(placeholder), `replace ${placeholder} with the real support email before submission.`);
  }
}

await checkDns();
await checkPublicHost();
checkLegalAndSubmissionFiles();
checkSupportReleaseBlocker();

if (failures.length) {
  console.error(`Submission readiness failed: ${failures.length} blocker(s).`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Submission readiness passed for ${CANONICAL_ORIGIN}.`);
