#!/usr/bin/env node
import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["mcp/remote-server.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: "0", HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"]
});

let baseUrl = "";
let stderr = "";

const timeout = setTimeout(() => {
  cleanup();
  fail("Timed out waiting for HTTP server to start.");
}, 8000);

child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
child.stdout.on("data", async (chunk) => {
  const lines = chunk.toString().split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.event === "betterquizzer-http-ready") {
        baseUrl = event.url;
        clearTimeout(timeout);
        try {
          await runSmoke();
          cleanup();
          console.log("HTTP smoke test passed.");
          process.exit(0);
        } catch (error) {
          cleanup();
          fail(error instanceof Error ? error.message : String(error));
        }
      }
    } catch {
      // Ignore non-JSON logs.
    }
  }
});

child.on("exit", (code) => {
  if (!baseUrl) {
    clearTimeout(timeout);
    fail(`HTTP server exited before ready. code=${code} stderr=${stderr}`);
  }
});

async function runSmoke() {
  const health = await getJson("/healthz");
  assert(health.ok === true, "healthz did not return ok=true");

  const manifest = await getJson("/.well-known/betterquizzer.json");
  assert(manifest.mcpEndpoint === "/mcp", "well-known manifest missing MCP endpoint");

  const initialized = await rpc("initialize", { protocolVersion: "2025-11-25", clientInfo: { name: "smoke-test", version: "0.1.0" } });
  assert(initialized.result?.serverInfo?.name === "betterquizzer", "initialize failed");

  const listed = await rpc("tools/list", {});
  const toolNames = listed.result.tools.map((tool) => tool.name);
  assert(toolNames.includes("create_quiz"), "create_quiz missing");
  assert(toolNames.includes("submit_answers"), "submit_answers missing");

  const resources = await rpc("resources/list", {});
  assert(resources.result.resources[0].uri.startsWith("ui://widget/"), "widget resource missing");

  const resource = await rpc("resources/read", { uri: resources.result.resources[0].uri });
  assert(resource.result.contents[0].text.includes("BetterQuizzes") || resource.result.contents[0].text.includes("root"), "widget resource did not return HTML");

  const quiz = {
    schema: "betterquizzer.quiz",
    version: 2,
    quizId: "smoke-quiz",
    title: "Smoke Quiz",
    mode: "practice",
    displayPolicy: { showCorrectAnswers: "after_submit", showExplanations: "llm_after_submit", requireConfidence: true },
    gradingPolicy: { preferredGrader: "llm", includeAnswerKeyInSubmission: true },
    questions: [
      { id: "q1", type: "multiple_choice", prompt: "Pick A.", choices: ["A", "B"], answer: 0, tags: ["smoke"] },
      { id: "q2", type: "short_answer", prompt: "Explain briefly.", expectedKeywords: ["brief"] }
    ]
  };

  const created = await rpc("tools/call", { name: "create_quiz", arguments: { quiz } });
  assert(created.result.structuredContent.quizId === "smoke-quiz", "create_quiz returned wrong quizId");
  assert(created.result._meta.quiz.questions.length === 2, "create_quiz did not include private quiz metadata");
  assert(created.result.structuredContent.quiz.questions.length === 2, "create_quiz did not include model-visible quiz payload for widget hydration");
  assert(created.result.structuredContent.quiz.questions.length === 2, "create_quiz did not include model-visible quiz payload for widget hydration");

  const submitted = await rpc("tools/call", {
    name: "submit_answers",
    arguments: {
      quizId: "smoke-quiz",
      sessionId: "smoke-session",
      answers: [
        { questionId: "q1", response: 0, confidence: 3, timeMs: 1000 },
        { questionId: "q2", response: "brief answer", confidence: 3, timeMs: 2000 }
      ]
    }
  });

  const submission = submitted.result.structuredContent.submission;
  assert(submission.schema === "betterquizzer.submission", "submit_answers did not return a submission capsule");
  assert(submission.answers.length === 2, "submission answer count mismatch");
  assert(Array.isArray(submission.answerKey), "submission missing answer key");
}

async function getJson(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  if (!response.ok) throw new Error(`GET ${pathname} failed: ${response.status}`);
  return response.json();
}

let nextId = 1;
async function rpc(method, params) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params })
  });
  if (!response.ok) throw new Error(`RPC ${method} HTTP failed: ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`RPC ${method} failed: ${payload.error.message}`);
  return payload;
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

function cleanup() {
  clearTimeout(timeout);
  if (!child.killed) child.kill("SIGTERM");
}

function fail(message) {
  console.error(`HTTP smoke test failed: ${message}`);
  if (stderr) console.error(stderr);
  process.exit(1);
}
