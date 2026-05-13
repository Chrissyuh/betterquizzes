#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = new Set(process.argv.slice(2));
const strictHttps = args.has("--strict-https") || args.has("--strict");
const writeReports = !args.has("--no-report");
const rawBase = process.env.TRIAL_BASE_URL || process.env.PUBLIC_BASE_URL || process.env.PUBLIC_ORIGIN || "http://127.0.0.1:8787";
const baseUrl = rawBase.replace(/\/$/, "");
const startedAt = new Date();
const checks = [];
let nextId = 1;

if (strictHttps && !baseUrl.startsWith("https://")) {
  fail(`Strict hosted trial requires HTTPS. Current base URL: ${baseUrl}`);
}

try {
  const report = await runTrial();
  if (writeReports) writeReport(report);
  console.log(`Stage 12.1 host trial passed for ${baseUrl}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const report = buildReport(false, message);
  if (writeReports) writeReport(report);
  console.error(`Stage 12.1 host trial failed for ${baseUrl}: ${message}`);
  process.exit(1);
}

async function runTrial() {
  const health = await check("GET /healthz", () => getJson("/healthz"), (value) => value.ok === true);
  const manifest = await check("GET /.well-known/mcp-app.json", () => getJson("/.well-known/mcp-app.json"), (value) => value.transport?.endpoint?.endsWith("/mcp"));
  const connector = await check("GET /connector-card.json", () => getJson("/connector-card.json"), (value) => value.connectorSetup?.connectorUrl?.endsWith("/mcp"));

  if (baseUrl.startsWith("https://")) {
    assert(manifest.transport.endpoint === `${baseUrl}/mcp`, "manifest transport endpoint must use the public base URL");
    assert(connector.connectorSetup.connectorUrl === `${baseUrl}/mcp`, "connector card must use the public base URL");
  }

  const initialized = await check("MCP initialize", () => rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "stage12-schema-contract", version: "0.1.0" } }), (value) => Boolean(value.result?.capabilities?.tools));
  await check("MCP ping", () => rpc("ping", {}), (value) => Boolean(value.result));

  const listed = await check("MCP tools/list", () => rpc("tools/list", {}), (value) => Array.isArray(value.result?.tools));
  const tools = listed.result.tools;
  const toolNames = tools.map((tool) => tool.name);
  for (const required of ["start_quiz", "add_question", "open_quiz", "create_quiz", "submit_answers", "inspect_quiz"]) {
    assert(toolNames.includes(required), `${required} missing from tools/list`);
  }

  assert(!toolNames.includes("finalize_quiz"), "finalize_quiz must not be advertised in tools/list");
  const openTool = tools.find((tool) => tool.name === "open_quiz");
  const resourceUri = openTool?._meta?.["openai/outputTemplate"] || openTool?._meta?.ui?.resourceUri;
  assert(typeof resourceUri === "string" && resourceUri.startsWith("ui://"), "open_quiz must expose a UI resource URI");

  const resources = await check("MCP resources/list", () => rpc("resources/list", {}), (value) => Array.isArray(value.result?.resources));
  assert(resources.result.resources.some((resource) => resource.uri === resourceUri), "resources/list must include the widget resource");

  const resource = await check("MCP resources/read widget", () => rpc("resources/read", { uri: resourceUri }), (value) => value.result?.contents?.[0]?.mimeType === "text/html;profile=mcp-app");
  const widgetText = resource.result.contents[0].text || "";
  assert(widgetText.includes("<script") || widgetText.includes("BetterQuizzes widget build missing"), "widget resource should contain an HTML/script payload or a clear build-missing message");

  const quiz = makeTrialQuiz();
  const started = await check("MCP tools/call start_quiz", () => callTool("start_quiz", { title: quiz.title, topic: quiz.subject, quizId: quiz.quizId, expectedQuestionCount: quiz.questions.length }), (value) => typeof value.result?.structuredContent?.draftId === "string");
  const draftId = started.result.structuredContent.draftId;
  const firstAdd = await check(`MCP tools/call add_question ${quiz.questions[0].id}`, () => callTool("add_question", { draftId, question: quiz.questions[0] }), (value) => value.result?.structuredContent?.ok === true && value.result?.structuredContent?.questionCount === 1 && !value.result?.structuredContent?.launch);
  assert(firstAdd.result?.structuredContent?.quizId === quiz.quizId, "first add_question must store the staged quiz before launch");
  let opened = await check("MCP tools/call open_quiz after q1", () => callTool("open_quiz", {}), (value) => value.result?.structuredContent?.kind === "betterquizzer.launch" && value.result?.structuredContent?.questionCount === 1);
  assert(opened.result?._meta?.quiz?.quizId === quiz.quizId, "open_quiz must privately hydrate the widget with the staged quiz");
  assert(opened.result?.structuredContent?.packetProgress?.complete === false, "early open_quiz launch should report partial generation");

  for (const [index, question] of quiz.questions.slice(1).entries()) {
    const expectedCount = index + 2;
    await check(`MCP tools/call add_question ${question.id}`, () => callTool("add_question", { draftId, question }), (value) => value.result?.structuredContent?.ok === true && value.result?.structuredContent?.questionCount === expectedCount);
    opened = await check(`MCP tools/call open_quiz after ${question.id}`, () => callTool("open_quiz", {}), (value) => value.result?.structuredContent?.kind === "betterquizzer.launch" && value.result?.structuredContent?.questionCount === expectedCount);
  }
  assert(opened.result?.structuredContent?.packetProgress?.complete === true, "final open_quiz launch should report complete generation");

  const inspected = await check("MCP tools/call inspect_quiz", () => callTool("inspect_quiz", { quizId: quiz.quizId }), (value) => value.result?.structuredContent?.questionCount === quiz.questions.length);

  const submitted = await check("MCP tools/call submit_answers", () => callTool("submit_answers", {
    quizId: quiz.quizId,
    sessionId: "stage11-trial-session",
    launchId: opened.result.structuredContent.launchId,
    quizRevision: opened.result.structuredContent.quizRevision,
    answers: [
      { questionId: "q1", response: 1, confidence: 3, timeMs: 1200 },
      { questionId: "q2", response: [0, 2], confidence: 3, timeMs: 2400 },
      { questionId: "q3", response: "Von Thunen", confidence: 3, timeMs: 1800 },
      { questionId: "q4", response: "Perishable goods need fast transport to market.", confidence: 3, timeMs: 4200 }
    ]
  }), (value) => value.result?.structuredContent?.submission?.schema === "betterquizzer.submission");

  const submission = submitted.result.structuredContent.submission;
  assert(submission.version === 2, "submission version must be 2");
  assert(submission.answers.length === 4, "submission must include all trial answers");
  assert(!("answerKey" in submission), "submission should omit the answer key by default");
  assert(submitted.result.content?.[0]?.text?.includes("Grade"), "submit_answers model-facing content should ask the LLM to grade/teach");

  return buildReport(true, null, { health, manifest, initialized, tools, resourceUri, inspected, submission });
}

async function getJson(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  if (!response.ok) throw new Error(`GET ${pathname} failed with HTTP ${response.status}`);
  return response.json();
}

async function rpc(method, params) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "MCP-Protocol-Version": "2025-06-18" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params })
  });
  if (!response.ok) throw new Error(`RPC ${method} failed with HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`RPC ${method} failed: ${payload.error.message}`);
  return payload;
}

function callTool(name, args) {
  return rpc("tools/call", { name, arguments: args });
}

async function check(name, fn, validate = () => true) {
  const start = performance.now();
  const value = await fn();
  const ms = Math.round(performance.now() - start);
  if (!validate(value)) throw new Error(`${name} returned an invalid response`);
  checks.push({ name, ok: true, ms });
  return value;
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function makeTrialQuiz() {
  return {
    schema: "betterquizzer.quiz",
    version: 2,
    quizId: "stage12-schema-contract-quiz",
    title: "Stage 12.1 Host Trial Quiz",
    subject: "BetterQuizzes Integration",
    mode: "practice",
    displayPolicy: { showCorrectAnswers: "after_submit", showExplanations: "llm_after_submit", requireConfidence: true },
    gradingPolicy: { preferredGrader: "llm", includeAnswerKeyInSubmission: false },
    questions: [
      { id: "q1", type: "multiple_choice", prompt: "Which layer should explain missed answers?", choices: ["The static UI", "The LLM", "The CSS file", "The package manager"], answer: 1, tags: ["architecture", "llm-grading"], difficulty: 1 },
      { id: "q2", type: "multi_select", prompt: "Which data should BetterQuizzes return?", choices: ["User answers", "Ad data", "Confidence ratings", "Private browser history"], answer: [0, 2], tags: ["submission", "privacy"], difficulty: 2 },
      { id: "q3", type: "fill_blank", prompt: "The agriculture model often associated with market-distance rings is the ________ model.", answer: "Von Thunen", tags: ["fill-blank"], difficulty: 2 },
      { id: "q4", type: "long_response", prompt: "Explain why confidence ratings are useful for LLM tutoring.", expectedKeywords: ["misconception", "uncertainty", "targeted"], rubric: "Look for a distinction between high-confidence wrong answers and low-confidence correct answers.", tags: ["confidence", "free-response"], difficulty: 3 }
    ]
  };
}

function buildReport(ok, error, details = {}) {
  const endedAt = new Date();
  return {
    schema: "betterquizzer.hostTrialReport",
    version: 1,
    stage: 9,
    ok,
    error,
    baseUrl,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    checks,
    details: summarizeDetails(details)
  };
}

function summarizeDetails(details) {
  const submission = details.submission;
  return {
    health: details.health ? { ok: details.health.ok, version: details.health.version, publicHttpsReady: details.health.publicHttpsReady } : undefined,
    manifest: details.manifest ? { transport: details.manifest.transport, widgetResource: details.manifest.widgetResource, stage: details.manifest.stage } : undefined,
    toolNames: details.tools?.map((tool) => tool.name),
    resourceUri: details.resourceUri,
    inspectedQuiz: details.inspected?.result?.structuredContent,
    submission: submission ? { schema: submission.schema, version: submission.version, quizId: submission.quizId, answers: submission.answers.length, answerKey: submission.answerKey?.length ?? 0 } : undefined
  };
}

function writeReport(report) {
  mkdirSync("trial-reports", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = join("trial-reports", `stage12-schema-contract-${stamp}`);
  writeFileSync(`${base}.json`, JSON.stringify(report, null, 2));
  writeFileSync(`${base}.md`, markdownReport(report));
  console.log(`Wrote trial report: ${base}.md`);
}

function markdownReport(report) {
  const lines = [];
  lines.push(`# BetterQuizzes Stage 12.1 Host Trial Report`);
  lines.push("");
  lines.push(`- Status: ${report.ok ? "PASS" : "FAIL"}`);
  lines.push(`- Base URL: ${report.baseUrl}`);
  lines.push(`- Started: ${report.startedAt}`);
  lines.push(`- Duration: ${report.durationMs} ms`);
  if (report.error) lines.push(`- Error: ${report.error}`);
  lines.push("");
  lines.push(`## Checks`);
  lines.push("");
  for (const check of report.checks) lines.push(`- ${check.ok ? "✅" : "❌"} ${check.name} (${check.ms} ms)`);
  lines.push("");
  lines.push(`## Summary`);
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(report.details, null, 2));
  lines.push("```");
  lines.push("");
  lines.push(`## Next manual step`);
  lines.push("");
  lines.push("Use the public `/mcp` URL in a compatible host/connector setup, build with `start_quiz`, alternate `add_question` and `open_quiz` once per question, then verify the LLM receives and grades the `SubmissionCapsule`.");
  return lines.join("\n");
}
