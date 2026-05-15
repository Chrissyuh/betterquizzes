#!/usr/bin/env node
import { readFileSync } from "node:fs";

const server = readFileSync("mcp/remote-server.mjs", "utf8");
const stableServer = readFileSync("mcp/betterquizzes-app-server.mjs", "utf8");
const sdkServer = readFileSync("mcp/sdk-stdio-server.mjs", "utf8");
const sharedGuidance = readFileSync("mcp/shared-authoring-guidance.mjs", "utf8");
const stage12Contract = readFileSync("docs/stage-12-ai-schema-contract.md", "utf8");
const appSubmission = JSON.parse(readFileSync("chatgpt-app-submission.json", "utf8"));
const demoClient = readFileSync("mcp/demo-client.mjs", "utf8");
const trialProbe = readFileSync("scripts/trial-probe.mjs", "utf8");
const localHostTrial = readFileSync("scripts/local-host-trial.mjs", "utf8");
const app = readFileSync("src/App.tsx", "utf8");
const bridge = readFileSync("src/host/openaiBridge.ts", "utf8");
function assert(value, message) { if (!value) throw new Error(message); }

assert(server.includes('const VERSION = "V1"'), "server version must be V1");
assert(server.includes('ui://widget/betterquizzes-v1-build-bqv1p1.html'), "widget URI must be versioned for V1");
assert(server.includes('CREATE_QUIZ_INPUT_SCHEMA'), "create_quiz must use a named input schema");
assert(server.includes('outputSchema: LAUNCH_OUTPUT_SCHEMA'), "create_quiz must expose an output schema");
assert(server.includes('outputSchema: BUILDER_OUTPUT_SCHEMA'), "builder tools must expose output schemas");
assert(!server.includes('name: "finalize_quiz"'), "finalize_quiz must not be advertised as a normal tool");
assert(server.includes('name: "open_quiz"'), "open_quiz must be registered");
assert(server.includes('"openai/toolInvocation/invoking": "Opening quiz..."'), "open_quiz must attach widget launch metadata");
assert(server.includes("Do not call open_quiz or finalize_quiz for normal assistant-authored quizzes"), "model instructions must remove open_quiz/finalize_quiz from the normal creation path");
assert(server.includes('if (name === "finalize_quiz") return finalizeQuiz(input);'), "hidden finalize_quiz compatibility handler must remain for cached old tool callers");
assert(server.includes("OPEN_TOOL_ANNOTATIONS") && server.includes("idempotentHint: true"), "open_quiz must be idempotent");
assert(server.includes('import { V2_BUILDER_INSTRUCTIONS } from "./shared-authoring-guidance.mjs"'), "remote server must use shared builder guidance");
assert(stableServer.includes('import { V2_BUILDER_INSTRUCTIONS } from "./shared-authoring-guidance.mjs"'), "stable stdio server must use shared builder guidance");
assert(sharedGuidance.includes("start_quiz only creates a draft") && sharedGuidance.includes("add_first_question is the only builder tool that launches the widget"), "shared builder guidance must launch only from add_first_question");
assert(sharedGuidance.includes("call add_first_question exactly once for the first question") && sharedGuidance.includes("Continue add_question/repair_question exactly once per later question"), "shared builder guidance must add one question at a time");
assert(sharedGuidance.includes("Do not call open_quiz or finalize_quiz"), "shared builder guidance must avoid open_quiz/finalize_quiz in the normal path");
assert(sharedGuidance.includes("Do not send question batches in start_quiz"), "shared builder guidance must reject start_quiz question batches");
for (const [label, text] of [["remote server", server], ["stable stdio server", stableServer], ["SDK stdio server", sdkServer]]) {
  if (label === "SDK stdio server") {
    assert(text.includes('import "./betterquizzes-app-server.mjs"'), "SDK stdio server must route through the canonical stdio server");
  } else {
    assert(text.includes('orderingBehavior.direction') && text.includes('"top_to_bottom"'), `${label} must instruct top_to_bottom ordering direction`);
    assert(text.includes("topLabel") && text.includes("bottomLabel"), `${label} must put ordering meaning in top/bottom labels`);
  }
}
assert(server.includes("Open Existing Complete Quiz Packet"), "create_quiz must be demoted to compatibility opener");
assert(server.includes('outputSchema: SUBMISSION_OUTPUT_SCHEMA'), "submit_answers must expose an output schema");
assert(!server.includes('anyOf: [{ required: ["quizId", "answers"] }, { required: ["submission"] }]'), "submit_answers parameters must not use top-level anyOf");
assert(server.includes('submission: { type: "object", additionalProperties: true'), "submit_answers schema must accept fallback submission packets without top-level answers");
assert(server.includes('const submitAnswersAlias = tools.find((tool) => tool.name === "submit_answers");'), "record_submission alias must share the OpenAI-compatible submit schema");
assert(server.includes('outputSchema: GRADE_OUTPUT_SCHEMA'), "grade tools must expose output schemas");
assert(server.includes('outputSchema: INSPECT_QUIZ_OUTPUT_SCHEMA'), "inspect_quiz must expose an output schema");
assert(server.includes('DEFAULT_WIDGET_DOMAIN = "https://app.betterquizzes.com"'), "widget domain must have a submission-ready default");
assert(server.includes('"openai/widgetDomain": domain'), "widget resource must advertise openai/widgetDomain");
assert(server.includes("ui: { prefersBorder: true, domain, csp:"), "widget resource must expose ui.domain metadata");
assert(server.includes("resource_domains: resourceDomains"), "legacy widget CSP metadata must use explicit resource domains");
assert(server.includes('DRAFT_TOOL_ANNOTATIONS'), "builder tools must declare non-destructive annotations");
assert(server.includes('destructiveHint: false'), "tool metadata must mark non-destructive tools correctly");
assert(server.includes('QUIZ_SPEC_SCHEMA'), "server must expose a QuizSpec schema");
assert(server.includes('QUESTION_SCHEMA'), "server must expose discriminated question schemas");
assert(server.includes('COMPACT_QUIZ_PACKET_SCHEMA'), "create_quiz must advertise the compact legacy packet schema");
assert(!server.includes('properties: { quiz: QUIZ_SPEC_SCHEMA }'), "create_quiz must not advertise the full QuizSpec schema");
assert(server.includes('properties: { quiz: COMPACT_QUIZ_PACKET_SCHEMA }'), "create_quiz input must point at the compact packet schema");
assert(server.includes('oneOf'), "question schema should be discriminated with oneOf");
assert(server.includes('MultipleChoiceQuestion'), "schema must include multiple choice shape");
assert(server.includes('ShortAnswerQuestion'), "schema must include short answer shape");
assert(server.includes('prepareQuizForRender'), "server must normalize and validate quizzes before rendering");
assert(server.includes('getRenderDiagnostics'), "server must return render diagnostics");
assert(server.includes('buildLaunchToolResult') && server.includes('function openQuiz'), "open_quiz and create_quiz should share launch storage/result logic");
assert(server.includes("quizRecoveryTokens") && server.includes("requireQuizRecoveryAccess(url, quizId)"), "public recovery endpoints must require quiz recovery tokens");
assert(server.includes("quizLaunchAccessTokens") && server.includes('url.searchParams.get("launchId")'), "public recovery endpoints must accept scoped launchId fallback tokens for staged widget polling");
assert(server.includes('"/api/quiz/latest"') && server.includes('source: "latest"'), "latest quiz endpoint may remain available for local/dev diagnostics");
assert(server.includes("createdQuizzesHidden: true"), "public quiz listing must not expose created quiz ids");
assert(server.includes("recoveryToken: stored.recoveryToken"), "launch metadata must include the private recovery token for the widget");
assert(server.includes('name: "add_first_question"') && server.includes("launch exactly one widget"), "add_first_question must be the sole builder launch tool");
assert(server.includes('name: "add_question"') && server.includes("intentionally has no widget output template"), "add_question must be storage-only after launch");
assert(server.includes('"openai/toolInvocation/invoking": "Adding question..."'), "add_question must retain status metadata");
assert(!server.includes('name: "add_question",\n    description: "Add exactly one later question') || !server.includes('"openai/outputTemplate": "ui://widget/betterquizzes-v61-bridge.html", "openai/widgetAccessible": true, "openai/toolInvocation/invoking": "Adding question..."'), "storage-only add_question must not advertise an output template");
assert(server.includes("betterquizzes-v61-bridge.html"), "widget URI must cache-bust the bridge-first hydration rewrite");
assert(server.includes("SUPPORTED_QUESTION_TYPE_VALUES") && server.includes("unsupportedQuestionTypes") && server.includes("multiple_select"), "builder tools must advertise supported/unsupported question types");
assert(server.includes("add_question validates every question against the renderer-supported type") && server.includes("Unsupported question type:"), "add_question must reject unsupported types before storing");
assert(server.includes("safeToPresentToUser") && server.includes("launchStatus"), "launch packets must expose clear model-facing readiness flags");
assert(server.includes("summarizeNormalizations") && server.includes("visibleWarnings"), "model-facing diagnostics must split normalizations from warnings");
assert(server.includes('renderableQuestionCount'), "create_quiz must report renderable question count");
assert(server.includes('componentByQuestion'), "render diagnostics must include componentByQuestion");
assert(server.includes('normalizedFields'), "render diagnostics must include normalizedFields");
assert(server.includes('rendererCertified'), "render diagnostics must include rendererCertified");
assert(server.includes('const CREATE_QUIZ_DESCRIPTION = "Use only when'), "create_quiz description should stay compact");
assert(!server.includes('CREATE_QUIZ_DESCRIPTION = "Compatibility opener'), "create_quiz description must not restore the long legacy guidance");
assert(!server.includes('"openai/outputTemplate": RESOURCE_URI,\n      "openai/widgetAccessible": true,\n      "openai/toolInvocation/invoking": "Submitting'), "submit_answers must not attach the widget output template");
assert(!server.includes("create_quiz exactly once"), "legacy create_quiz exactly-once guidance must not remain");
assert(!server.includes("destructiveHint: true"), "no tool should be marked destructive");
assert(!server.includes("openWorldHint: true"), "no tool should be marked open-world");
assert(bridge.includes("ui/notifications/tool-result") && bridge.includes("ui/notifications/tool-input"), "widget bridge must listen for MCP Apps tool-result/tool-input notifications");
assert(bridge.includes("openai:set_globals") && bridge.includes("latestOpenAiGlobals"), "widget bridge must preserve ChatGPT window.openai compatibility globals");
assert(bridge.includes("subscribeHostQuizPayload"), "widget bridge must expose event-driven launch updates");
assert(app.includes("subscribeHostQuizPayload") && app.includes("embeddedWidgetMode"), "app hydration must boot embedded MCP Apps iframes without depending on window.openai");

assert(stage12Contract.includes("Normal assistant-authored quizzes are built with draft-only `start_quiz`") && stage12Contract.includes("`add_first_question` launch packet"), "Stage 12 docs must describe the first-question launch flow");
assert(stage12Contract.includes("`create_quiz` remains a compact legacy compatibility opener"), "Stage 12 docs must demote create_quiz to legacy compatibility");
assert(!stage12Contract.includes("create_quiz now exposes the exact nested QuizSpec v2 schema"), "Stage 12 docs must not restore stale full-schema create_quiz guidance");
assert(!stage12Contract.includes("Complete create_quiz.inputSchema instead of quiz: object / any."), "Stage 12 docs must not claim create_quiz exposes the full contract");

assert(appSubmission.tools?.open_quiz?.annotations?.readOnlyHint === true, "submission metadata must mark open_quiz read-only");
assert(appSubmission.tools?.open_quiz?.annotations?.destructiveHint === false, "submission metadata must mark open_quiz non-destructive");
assert(appSubmission.tools?.open_quiz?.annotations?.openWorldHint === false, "submission metadata must mark open_quiz non-open-world");
assert(appSubmission.tools?.open_quiz?.annotations?.idempotentHint === true, "submission metadata must mark open_quiz idempotent");
for (const toolName of ["start_quiz", "add_first_question", "add_question", "repair_question"]) {
  const annotations = appSubmission.tools?.[toolName]?.annotations;
  assert(annotations?.readOnlyHint === true, `submission metadata must mark ${toolName} read-only`);
  assert(annotations?.destructiveHint === false, `submission metadata must mark ${toolName} non-destructive`);
  assert(annotations?.openWorldHint === false, `submission metadata must mark ${toolName} non-open-world`);
}

assert(demoClient.includes("resources.result.resources[0].uri"), "demo client must read the advertised widget resource URI");
assert(demoClient.includes('name: "add_first_question"') && demoClient.includes('betterquizzer.launch'), "demo client must cover add_first_question launch");
assert(!demoClient.includes("betterquizzer-stage12-1.html"), "demo client must not hardcode stale widget resource aliases");

assert(trialProbe.includes('callTool("add_first_question"'), "host trial probe must exercise add_first_question staged launch path");
assert(trialProbe.includes('callTool("add_question"'), "host trial probe must exercise storage-only add_question updates");
assert(trialProbe.includes('callTool("start_quiz"'), "host trial probe must open from start_quiz");
assert(trialProbe.includes("quiz.questions.slice(1)"), "host trial probe must still add later questions after the widget is open");
assert(trialProbe.includes("packetProgress?.complete === false"), "host trial probe must assert early launch is partial");
assert(trialProbe.includes("updatedStoredQuiz = await fetchQuizFromServerForTrial"), "host trial probe must verify token-scoped polling API can see later questions");
assert(!trialProbe.includes("fetchLatestQuizFromServerForTrial"), "host trial probe must not depend on latest-quiz widget fallback");
assert(trialProbe.includes("launchId: opened.result.structuredContent.launchId"), "host trial submission must preserve launch identity");
assert(localHostTrial.includes("const probeArgs = process.argv.slice(2)"), "local host trial wrapper must preserve probe CLI flags");
assert(localHostTrial.includes('["scripts/trial-probe.mjs", ...probeArgs]'), "local host trial wrapper must forward probe CLI flags");

assert(sdkServer.includes('import "./betterquizzes-app-server.mjs"'), "SDK stdio command must use the canonical first-question launch contract");

console.log("V1 MCP/App contract static checks passed.");
