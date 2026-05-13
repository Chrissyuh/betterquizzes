#!/usr/bin/env node
import { readFileSync } from "node:fs";

const server = readFileSync("mcp/remote-server.mjs", "utf8");
const stage12Contract = readFileSync("docs/stage-12-ai-schema-contract.md", "utf8");
const appSubmission = JSON.parse(readFileSync("chatgpt-app-submission.json", "utf8"));
const demoClient = readFileSync("mcp/demo-client.mjs", "utf8");
const trialProbe = readFileSync("scripts/trial-probe.mjs", "utf8");
const localHostTrial = readFileSync("scripts/local-host-trial.mjs", "utf8");
function assert(value, message) { if (!value) throw new Error(message); }

assert(server.includes('const VERSION = "V1"'), "server version must be V1");
assert(server.includes('ui://widget/betterquizzes-v1-build-bqv1p1.html'), "widget URI must be versioned for V1");
assert(server.includes('CREATE_QUIZ_INPUT_SCHEMA'), "create_quiz must use a named input schema");
assert(server.includes('outputSchema: LAUNCH_OUTPUT_SCHEMA'), "create_quiz must expose an output schema");
assert(server.includes('outputSchema: BUILDER_OUTPUT_SCHEMA'), "builder tools must expose output schemas");
assert(!server.includes('name: "finalize_quiz"'), "finalize_quiz must not be advertised as a normal tool");
assert(server.includes('name: "open_quiz"'), "open_quiz must be registered");
assert(server.includes('"openai/toolInvocation/invoking": "Opening quiz..."'), "open_quiz must attach widget launch metadata");
assert(server.includes("Do not call finalize_quiz for assistant-authored quizzes"), "model instructions must remove finalize_quiz from the normal creation path");
assert(server.includes('if (name === "finalize_quiz") return finalizeQuiz(input);'), "hidden finalize_quiz compatibility handler must remain for cached old tool callers");
assert(server.includes("OPEN_TOOL_ANNOTATIONS") && server.includes("idempotentHint: true"), "open_quiz must be idempotent");
assert(server.includes("Open Existing Complete Quiz Packet"), "create_quiz must be demoted to compatibility opener");
assert(server.includes('outputSchema: SUBMISSION_OUTPUT_SCHEMA'), "submit_answers must expose an output schema");
assert(server.includes('anyOf: [{ required: ["quizId", "answers"] }, { required: ["submission"] }]'), "submit_answers schema must accept fallback submission packets without top-level answers");
assert(server.includes('outputSchema: GRADE_OUTPUT_SCHEMA'), "grade tools must expose output schemas");
assert(server.includes('outputSchema: INSPECT_QUIZ_OUTPUT_SCHEMA'), "inspect_quiz must expose an output schema");
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

assert(stage12Contract.includes("Normal assistant-authored quizzes are built with `start_quiz`"), "Stage 12 docs must describe the staged builder flow");
assert(stage12Contract.includes("`create_quiz` remains a compact legacy compatibility opener"), "Stage 12 docs must demote create_quiz to legacy compatibility");
assert(!stage12Contract.includes("create_quiz now exposes the exact nested QuizSpec v2 schema"), "Stage 12 docs must not restore stale full-schema create_quiz guidance");
assert(!stage12Contract.includes("Complete create_quiz.inputSchema instead of quiz: object / any."), "Stage 12 docs must not claim create_quiz exposes the full contract");

assert(appSubmission.tools?.open_quiz?.annotations?.readOnlyHint === true, "submission metadata must mark open_quiz read-only");
assert(appSubmission.tools?.open_quiz?.annotations?.destructiveHint === false, "submission metadata must mark open_quiz non-destructive");
assert(appSubmission.tools?.open_quiz?.annotations?.openWorldHint === false, "submission metadata must mark open_quiz non-open-world");
assert(appSubmission.tools?.open_quiz?.annotations?.idempotentHint === true, "submission metadata must mark open_quiz idempotent");

assert(demoClient.includes("resources.result.resources[0].uri"), "demo client must read the advertised widget resource URI");
assert(demoClient.includes('name: "open_quiz", arguments: {}'), "demo client must exercise the no-arg open_quiz path");
assert(!demoClient.includes("betterquizzer-stage12-1.html"), "demo client must not hardcode stale widget resource aliases");
assert(!demoClient.includes("arguments: { quizId: quiz.quizId }"), "demo client must not teach explicit quizId launch args for normal staged authoring");

assert(trialProbe.includes('callTool("open_quiz", {})'), "host trial probe must exercise the no-arg open_quiz path");
assert(trialProbe.includes("quiz.questions.slice(1)"), "host trial probe must open before adding all staged questions");
assert(trialProbe.includes("packetProgress?.complete === false"), "host trial probe must assert early launch is partial");
assert(trialProbe.includes("launchId: opened.result.structuredContent.launchId"), "host trial submission must preserve launch identity");
assert(!trialProbe.includes('callTool("open_quiz", { quizId: quiz.quizId })'), "host trial probe must not teach explicit quizId launch args for normal staged authoring");
assert(localHostTrial.includes("const probeArgs = process.argv.slice(2)"), "local host trial wrapper must preserve probe CLI flags");
assert(localHostTrial.includes('["scripts/trial-probe.mjs", ...probeArgs]'), "local host trial wrapper must forward probe CLI flags");

const sdkServer = readFileSync("mcp/sdk-stdio-server.mjs", "utf8");
assert(sdkServer.includes("quizId: z.string().optional()"), "SDK submit schema must allow fallback submissions without top-level quizId");
assert(sdkServer.includes("}).passthrough()).optional()"), "SDK submit schema must allow fallback submissions without top-level answers");
assert(sdkServer.includes("const effectiveAnswers = Array.isArray(args.answers) ? args.answers : providedSubmission?.answers"), "SDK submit runtime must read fallback submission answers");

console.log("V1 MCP/App contract static checks passed.");
