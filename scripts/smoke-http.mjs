#!/usr/bin/env node
import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["mcp/remote-server.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: "0", HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"]
});

let baseUrl = "";
let stderr = "";
let passed = false;

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
          console.log("HTTP smoke test passed.");
          passed = true;
          cleanup();
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
  if (passed) {
    process.exitCode = 0;
    return;
  }
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
  assert(["betterquizzes", "betterquizzer"].includes(initialized.result?.serverInfo?.name), "initialize failed");

  const listed = await rpc("tools/list", {});
  const toolNames = listed.result.tools.map((tool) => tool.name);
  assert(toolNames.includes("create_quiz"), "create_quiz missing");
  assert(toolNames.includes("start_quiz"), "start_quiz missing");
  assert(toolNames.includes("add_question"), "add_question missing");
  assert(toolNames.includes("open_quiz"), "open_quiz missing");
  assert(toolNames.includes("submit_answers"), "submit_answers missing");
  for (const tool of listed.result.tools) {
    assert(tool.outputSchema && tool.outputSchema.type === "object", `${tool.name} missing object outputSchema`);
    assert(tool.annotations?.destructiveHint !== true, `${tool.name} should not be destructive`);
    assert(tool.annotations?.openWorldHint !== true, `${tool.name} should not be open-world`);
  }
  assert(!toolNames.includes("finalize_quiz"), "finalize_quiz should not be advertised in normal tools/list");
  const openTool = listed.result.tools.find((tool) => tool.name === "open_quiz");
  assert(openTool._meta?.["openai/outputTemplate"], "open_quiz missing widget output template");
  assert(openTool.annotations?.readOnlyHint === true, "open_quiz should be read-only");
  assert(openTool.annotations?.idempotentHint === true, "open_quiz should be idempotent");
  assert(!openTool.inputSchema?.required?.length, "open_quiz should not require arguments");
  const createTool = listed.result.tools.find((tool) => tool.name === "create_quiz");
  const createSchemaJson = JSON.stringify(createTool?.inputSchema || {});
  assert(createTool?.inputSchema?.properties?.quiz?.properties?.questions?.items?.additionalProperties === true, "create_quiz should advertise compact question objects");
  assert(!createSchemaJson.includes('"oneOf"'), "create_quiz input schema should stay compact");
  assert((createTool?.description || "").length < 500, "create_quiz description should stay compact");
  assert(!(createTool?.description || "").includes("Canonical minimal example"), "create_quiz description should not advertise legacy examples");
  const submitTool = listed.result.tools.find((tool) => tool.name === "submit_answers");
  const submitSchema = submitTool?.inputSchema || {};
  assert(Array.isArray(submitSchema.anyOf), "submit_answers schema should allow fallback submission packets");
  assert(!submitSchema.required?.includes("answers"), "submit_answers schema should not always require top-level answers");
  assert(submitSchema.anyOf.some((entry) => entry.required?.includes("submission")), "submit_answers schema should accept a complete fallback submission");
  const startTool = listed.result.tools.find((tool) => tool.name === "start_quiz");
  assert(startTool?.inputSchema?.properties?.questions?.type === "array", "start_quiz schema missing bulk questions array");
  const repairTool = listed.result.tools.find((tool) => tool.name === "repair_question");
  assert(repairTool?.inputSchema?.properties?.repairedQuestion, "repair_question schema missing repairedQuestion");
  assert(repairTool?.inputSchema?.required?.includes("repairedQuestion"), "repair_question schema should require repairedQuestion");

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

  const stagedStarted = await rpc("tools/call", {
    name: "start_quiz",
    arguments: {
      title: "Staged Builder Smoke",
      topic: "QA",
      quizId: "staged-builder-smoke",
      expectedQuestionCount: 3
    }
  });
  const stagedDraftId = stagedStarted.result.structuredContent.draftId;
  await rpc("tools/call", {
    name: "add_question",
    arguments: {
      draftId: stagedDraftId,
      question: {
        id: "staged-choice",
        type: "multiple_choice",
        prompt: "Pick the checked path.",
        choices: ["Builder", "Legacy"],
        answer: 0
      }
    }
  });

  const latestBeforeOpen = await getJsonAllowStatus("/api/quiz/latest", 410);
  assert(latestBeforeOpen.error?.includes("disabled for privacy"), "latest quiz endpoint should not expose created quizzes without launch metadata");

  const opened = await rpc("tools/call", {
    name: "open_quiz",
    arguments: {}
  });
  assert(opened.result.structuredContent.kind === "betterquizzer.launch", "open_quiz did not return a launch packet");
  assert(opened.result.structuredContent.declaredQuestionCount === 3, "open_quiz should preserve expected question count");
  assert(opened.result.structuredContent.questionCount === 1, "open_quiz should launch available questions");
  assert(opened.result.structuredContent.packetProgress.complete === false, "open_quiz partial launch should not be complete");
  const stagedRecoveryToken = opened.result._meta?.recoveryToken;
  assert(typeof stagedRecoveryToken === "string" && stagedRecoveryToken.length > 10, "open_quiz must provide a private recovery token in metadata");
  await getJsonAllowStatus("/api/quiz/staged-builder-smoke", 403);
  const stagedAfterOpen = await getJson("/api/quiz/staged-builder-smoke?recoveryToken=" + encodeURIComponent(stagedRecoveryToken));
  assert(stagedAfterOpen.quizId === "staged-builder-smoke", "token-scoped quiz endpoint should expose the opened staged quiz");
  assert(stagedAfterOpen.quiz.questions.length === 1, "token-scoped quiz endpoint should expose the current staged revision");
  const replayedOpen = await rpc("tools/call", {
    name: "open_quiz",
    arguments: {}
  });
  assert(replayedOpen.result.structuredContent.launchId === opened.result.structuredContent.launchId, "open_quiz should replay a stable launchId for the same revision");

  const legacyFinalizeLaunch = await rpc("tools/call", {
    name: "finalize_quiz",
    arguments: { draftId: stagedDraftId, quizId: "staged-builder-smoke" }
  });
  assert(legacyFinalizeLaunch.result.structuredContent.kind === "betterquizzer.launch", "legacy finalize_quiz should launch for cached old tool callers");
  assert(legacyFinalizeLaunch.result.structuredContent.quizId === "staged-builder-smoke", "legacy finalize_quiz returned wrong quizId");

  await rpc("tools/call", {
    name: "add_question",
    arguments: {
      draftId: stagedDraftId,
      question: {
        id: "staged-text-select",
        type: "text_select",
        prompt: "Select the evidence phrase that best supports the claim about validation.",
        segments: [
          { id: "s1", text: "The draft stores each question before launch." },
          { id: "s2", text: "The server validates the draft through the render contract before the widget opens." },
          { id: "s3", text: "The final packet then reports whether every question can render." }
        ],
        selectionPolicy: { mode: "exact_count", count: 1 },
        answer: ["s2"]
      }
    }
  });

  await rpc("tools/call", {
    name: "add_question",
    arguments: {
      draftId: stagedDraftId,
      question: {
        id: "staged-match",
        type: "matching",
        prompt: "Match each builder step to its role.",
        left: [
          { id: "l1", text: "start_quiz" },
          { id: "l2", text: "add_question" }
        ],
        right: [
          { id: "r1", text: "Create draft" },
          { id: "r2", text: "Store validated quiz" }
        ],
        answer: [
          { leftId: "l1", rightId: "r1" },
          { leftId: "l2", rightId: "r2" }
        ]
      }
    }
  });

  const stagedStored = await getJson("/api/quiz/staged-builder-smoke?recoveryToken=" + encodeURIComponent(stagedRecoveryToken));
  assert(stagedStored.quiz.questions.length === 3, "launched draft should sync later questions to stored quiz without another finalize");
  assert(stagedStored.quiz.questions[1].type === "text_select", "stored staged text_select question was not preserved");
  const stagedAfterUpdates = await getJson("/api/quiz/staged-builder-smoke?recoveryToken=" + encodeURIComponent(stagedRecoveryToken));
  assert(stagedAfterUpdates.quiz.questions.length === 3, "token-scoped quiz endpoint should update as staged questions are added");

  const badTextSelect = await rpc("tools/call", {
    name: "add_question",
    arguments: {
      draftId: stagedDraftId,
      question: {
        id: "bad-text-select",
        type: "text_select",
        prompt: "Select the phrase that describes natural selection.",
        segments: [
          { id: "s1", text: "Natural selection happens when " },
          { id: "s2", text: "individuals with useful traits leave more offspring" },
          { id: "s3", text: "." }
        ],
        answer: ["s2"]
      }
    }
  });
  assert(badTextSelect.result.structuredContent.needsRepair === true, "single-obvious-phrase text_select should be rejected");
  assert(String(badTextSelect.result.structuredContent.issues).includes("single obvious sentence"), "bad text_select repair should explain the quality issue");

  const started = await rpc("tools/call", {
    name: "start_quiz",
    arguments: {
      title: "Builder Ordering Smoke",
      topic: "QA",
      quizId: "builder-ordering-smoke"
    }
  });
  const builderDraftId = started.result.structuredContent.draftId;
  assert(typeof builderDraftId === "string" && builderDraftId.length > 0, "start_quiz did not return a draftId");

  await rpc("tools/call", {
    name: "add_question",
    arguments: {
      draftId: builderDraftId,
      question: {
        id: "order-1",
        type: "ordering",
        prompt: "Order these release steps.",
        orderingBehavior: { direction: "top_to_bottom", topLabel: "Top = First", bottomLabel: "Bottom = Last" },
        items: [
          { id: "review", text: "Review the change" },
          { id: "fix", text: "Implement the fix" },
          { id: "test", text: "Test on mobile" }
        ],
        answer: ["review", "fix", "test"],
        tags: ["smoke"]
      }
    }
  });

  await rpc("tools/call", {
    name: "add_question",
    arguments: {
      draftId: builderDraftId,
      question: {
        id: "match-1",
        type: "matching",
        prompt: "Match each release term to its meaning.",
        left: [
          { id: "l1", text: "Patch" },
          { id: "l2", text: "Rollback" }
        ],
        right: [
          { id: "r1", text: "Small fix" },
          { id: "r2", text: "Revert to a previous version" }
        ],
        answer: [
          { leftId: "l1", rightId: "r1" },
          { leftId: "l2", rightId: "r2" }
        ],
        tags: ["smoke"]
      }
    }
  });

  await rpc("tools/call", {
    name: "add_question",
    arguments: {
      draftId: builderDraftId,
      question: {
        id: "match-legacy",
        type: "matching",
        prompt: "Match the legacy pair terms.",
        pairs: [
          { left: "Alpha", right: "First" },
          { left: "Beta", right: "Second" }
        ],
        tags: ["smoke"]
      }
    }
  });

  await rpc("tools/call", {
    name: "repair_question",
    arguments: {
      draftId: builderDraftId,
      replace: true,
      replaceQuestionId: "match-legacy",
      repairedQuestion: {
        id: "match-legacy",
        type: "matching",
        prompt: "Match the repaired canonical terms.",
        left: [
          { id: "left1", text: "Alpha" },
          { id: "left2", text: "Beta" }
        ],
        right: [
          { id: "right1", text: "First" },
          { id: "right2", text: "Second" }
        ],
        answer: [
          { leftId: "left1", rightId: "right1" },
          { leftId: "left2", rightId: "right2" }
        ],
        tags: ["smoke"]
      }
    }
  });

  const openedFinal = await rpc("tools/call", {
    name: "open_quiz",
    arguments: { quizId: "builder-ordering-smoke" }
  });
  assert(openedFinal.result._meta?.ui?.route === "quiz", "open_quiz missing launch metadata route");
  const builderRecoveryToken = openedFinal.result._meta?.recoveryToken;
  assert(typeof builderRecoveryToken === "string" && builderRecoveryToken.length > 10, "open_quiz must provide a builder recovery token in metadata");
  const storedBuilderQuiz = await getJson("/api/quiz/builder-ordering-smoke?recoveryToken=" + encodeURIComponent(builderRecoveryToken));
  assert(storedBuilderQuiz.quiz.questions.length === 3, "add_question should continuously store all builder questions");
  assert(openedFinal.result.structuredContent.quiz.questions[1].type === "matching", "canonical matching question was not preserved");
  assert(Array.isArray(openedFinal.result.structuredContent.quiz.questions[2].left), "legacy matching pairs were not normalized to left/right");

  const inspected = await rpc("tools/call", {
    name: "inspect_quiz",
    arguments: { quizId: "builder-ordering-smoke" }
  });
  assert(inspected.result.structuredContent.quizId === "builder-ordering-smoke", "inspect_quiz could not find stored builder quiz");
  assert(inspected.result.structuredContent.questionCount === 3, "inspect_quiz returned wrong stored question count");

  const submitted = await rpc("tools/call", {
    name: "submit_answers",
    arguments: {
      quizId: "smoke-quiz",
      sessionId: "smoke-session",
      launchId: "smoke-quiz:r1",
      quizRevision: 1,
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
  assert(submission.launchId === "smoke-quiz:r1", "submission should preserve launch identity");
  assert(submission.quizRevision === 1, "submission should preserve quiz revision identity");
  assert(submitted.result.structuredContent.launchId === "smoke-quiz:r1", "submission packet should expose launch identity");
  assert(submitted.result.structuredContent.quizRevision === 1, "submission packet should expose quiz revision identity");

  const fallbackSubmitted = await rpc("tools/call", {
    name: "submit_answers",
    arguments: {
      launchId: "fallback-quiz:r7",
      quizRevision: 7,
      submission: {
        schema: "betterquizzer.submission",
        version: 2,
        quizId: "fallback-quiz",
        sessionId: "fallback-session",
        title: "Fallback Quiz",
        mode: "practice",
        submittedAt: new Date(0).toISOString(),
        displayPolicy: { showCorrectAnswers: "after_submit", showExplanations: "llm_after_submit", requireConfidence: false },
        gradingPolicy: { preferredGrader: "llm", includeAnswerKeyInSubmission: true },
        activityPolicy: { allowSkipQuiz: true, allowSkipQuestions: true, defaultAnswerRequired: false, submitRequiresRequiredAnswers: true },
        completion: { requiredTotal: 0, requiredAnswered: 0, optionalTotal: 1, optionalAnswered: 1, missingRequiredQuestionIds: [], missingRequiredConfidenceIds: [], isComplete: true },
        questions: [],
        answers: [{ questionId: "q1", response: "fallback", confidence: 3, timeMs: 250 }],
        llmInstructions: "Grade from this fallback submission only."
      }
    }
  });
  assert(fallbackSubmitted.result.structuredContent.submission.launchId === "fallback-quiz:r7", "fallback submission should preserve top-level launch identity");
  assert(fallbackSubmitted.result.structuredContent.submission.quizRevision === 7, "fallback submission should preserve top-level revision identity");
  assert(fallbackSubmitted.result.structuredContent.launchId === "fallback-quiz:r7", "fallback packet should expose launch identity");
  assert(fallbackSubmitted.result.structuredContent.quizRevision === 7, "fallback packet should expose revision identity");
}

async function getJson(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  if (!response.ok) throw new Error(`GET ${pathname} failed: ${response.status}`);
  return response.json();
}

async function getJsonAllowStatus(pathname, expectedStatus) {
  const response = await fetch(`${baseUrl}${pathname}`);
  if (response.status !== expectedStatus) throw new Error(`GET ${pathname} expected ${expectedStatus}, received ${response.status}`);
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
  child.stdout?.removeAllListeners("data");
  child.stderr?.removeAllListeners("data");
  child.stdout?.destroy();
  child.stderr?.destroy();
  if (!child.killed) child.kill("SIGKILL");
}

function fail(message) {
  console.error(`HTTP smoke test failed: ${message}`);
  if (stderr) console.error(stderr);
  process.exit(1);
}
