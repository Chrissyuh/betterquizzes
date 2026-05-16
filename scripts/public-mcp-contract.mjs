#!/usr/bin/env node
const strict = process.argv.includes("--strict");
const base = (process.env.PUBLIC_BASE_URL || process.env.PUBLIC_ORIGIN || process.env.TRIAL_BASE_URL || "").replace(/\/$/, "");

function assert(value, message) {
  if (!value) throw new Error(message);
}

if (!base) {
  const message = "PUBLIC_BASE_URL/PUBLIC_ORIGIN not set; skipping public MCP contract check.";
  if (strict) {
    console.error(message);
    process.exit(1);
  }
  console.log(message);
  process.exit(0);
}

if (strict) assert(base.startsWith("https://"), "strict public MCP contract check requires an HTTPS PUBLIC_BASE_URL/PUBLIC_ORIGIN");

let nextId = 1;
async function rpc(method, params = {}) {
  const response = await fetch(base + "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params })
  });
  const text = await response.text();
  assert(response.ok, `${method} failed with HTTP ${response.status}: ${text.slice(0, 300)}`);
  const lines = text.split(/\r?\n/).filter(Boolean);
  const dataLine = lines.find((line) => line.startsWith("data:"));
  return JSON.parse(dataLine ? dataLine.slice(5).trim() : text);
}

await rpc("initialize", { protocolVersion: "2025-11-25", clientInfo: { name: "public-mcp-contract", version: "0.1.0" } });
const listed = await rpc("tools/list", {});
const tools = listed.result?.tools ?? [];
const names = tools.map((tool) => tool.name);
for (const required of ["start_quiz", "add_first_question", "add_question", "open_quiz", "submit_answers", "record_submission", "record_grade"]) {
  assert(names.includes(required), `public MCP tools/list missing ${required}`);
}
assert(!names.includes("finalize_quiz"), "public MCP tools/list must not advertise finalize_quiz");

const startTool = tools.find((tool) => tool.name === "start_quiz");
const firstQuestionTool = tools.find((tool) => tool.name === "add_first_question");
const addTool = tools.find((tool) => tool.name === "add_question");
const openTool = tools.find((tool) => tool.name === "open_quiz");
const createTool = tools.find((tool) => tool.name === "create_quiz");
assert(!startTool?._meta?.["openai/outputTemplate"], "start_quiz must not advertise a widget output template");
assert(firstQuestionTool?._meta?.["openai/outputTemplate"], "add_first_question must advertise the widget output template for the one widget launch");
assert(!addTool?._meta?.["openai/outputTemplate"], "add_question must not advertise a widget output template because later calls must not open duplicate widgets");
assert(!openTool?._meta?.["openai/outputTemplate"], "open_quiz must not advertise a widget output template because recovery must not open duplicate widgets");
assert(!createTool?._meta?.["openai/outputTemplate"], "create_quiz must not advertise a widget output template in the assistant-authored quiz path");

const quizId = `public-contract-${Date.now().toString(36)}`;
const started = await rpc("tools/call", {
  name: "start_quiz",
  arguments: { title: "Public Contract Smoke", quizId, expectedQuestionCount: 2 }
});
const draftId = started.result?.structuredContent?.draftId;
assert(typeof draftId === "string" && draftId, "start_quiz did not return a draftId");
assert(started.result?.structuredContent?.capabilities?.launchTool === "add_first_question", "start_quiz must name add_first_question as the normal launch tool");
assert(started.result?.structuredContent?.capabilities?.updateTool === "add_question", "start_quiz must name add_question as the later update tool");
assert(started.result?.structuredContent?.capabilities?.recoveryTool === "open_quiz", "start_quiz must name open_quiz only as the recovery tool");

const firstAdd = await rpc("tools/call", {
  name: "add_first_question",
  arguments: {
    draftId,
    question: {
      id: "q1",
      type: "multiple_choice",
      prompt: "Which tool launches BetterQuizzes after this rebuild?",
      choices: ["add_first_question", "finalize_quiz"],
      answer: 0
    }
  }
});
const launch = firstAdd.result?.structuredContent;
assert(launch?.kind === "betterquizzer.launch", "add_first_question must return a BetterQuizzes launch packet");
assert(launch.questionCount === 1, "add_first_question launch should contain one question");
assert(launch.packetProgress?.complete === false, "add_first_question launch should be partial while more questions are expected");
assert(launch.safeToPresentToUser === true, "add_first_question launch must be safe to present");
assert(firstAdd.result?._meta?.ui?.route === "quiz", "add_first_question result must include widget launch metadata");

const secondAdd = await rpc("tools/call", {
  name: "add_question",
  arguments: {
    draftId,
    question: {
      id: "q2",
      type: "true_false",
      prompt: "Later add_question calls should update the same stored quiz.",
      answer: true
    }
  }
});
assert(secondAdd.result?.structuredContent?.ok === true, "later add_question should be storage-only ok=true");
assert(secondAdd.result?.structuredContent?.kind !== "betterquizzer.launch", "later add_question must not return a second launch packet");
assert(secondAdd.result?.structuredContent?.quizRevision > launch.quizRevision, "later add_question must advance the stored quiz revision");

console.log(`Public MCP contract passed for ${base}/mcp`);
