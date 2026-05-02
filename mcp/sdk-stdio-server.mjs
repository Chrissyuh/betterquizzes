const V13_UX_INSTRUCTIONS = "BetterQuizzes V2/V13 UX guidance:\n- Disable confidence on subjective, preference, survey, fit-finding, reflection, opinion, and developer smoke-test questions unless confidence is genuinely meaningful.\n- For a whole subjective survey, set displayPolicy.requireConfidence:false. For one subjective question inside an otherwise objective quiz, set question.requireConfidence:false or question.disableConfidence:true.\n- Do not use unsupported preference-ranking settings. For ranked preferences, use supported ordering questions or ordinary multiple-choice/multi-select questions.\n- Multi-select \"Other\" must preserve the user's other selected choices. Do not design \"Other\" as a single-select replacement unless the question type is single-select multiple_choice.\n- Choice label UI rules: single-select choices use circular radio-style labels; multi-select choices use square checkbox-style labels.\n- For choice special cases, use choiceAnswerPolicy deliberately: at_least_one_correct, at_least_one_correct_with_none, or none_correct_with_none.";

#!/usr/bin/env node
/**
 * Stage 12.6 official-SDK stdio entrypoint.
 *
 * The HTTP server remains the proven Stage 12.6 deployment transport. This file is
 * the standards-based local MCP server entrypoint built with the official
 * TypeScript SDK. It registers the same BetterQuizzes tools and widget resource
 * through McpServer instead of routing JSON-RPC by hand.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const VERSION = "V1";
const RESOURCE_URI = "ui://widget/betterquizzes-v1-build-bqv1p1.html";
const RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";
const MODEL_INSTRUCTIONS = `BetterQuizzes model instructions:
1. Use BetterQuizzes only when the user wants an interactive quiz, drill, diagnostic, survey, or practice activity.
2. To start an activity, call create_quiz exactly once with a complete BetterQuizzes QuizSpec v2. Do not show raw JSON to the user or ask them to paste JSON.
3. A valid QuizSpec needs schema="betterquizzer.quiz", version=2, title, mode, displayPolicy, gradingPolicy, activityPolicy, and questions. Prefer gradingPolicy.preferredGrader="llm" and includeAnswerKeyInSubmission=true.
4. Generate valid question data. multiple_choice and multi_select require a non-empty choices array. matching requires left and right arrays. ordering requires an items array. If unsure, use fill_blank, short_answer, or long_response instead of inventing an invalid structure.
5. Use answerRequired to control whether a question blocks submission. Blank non-required questions are allowed, but grading them is case-dependent. Decide whether to score them, omit them, or mark Needs review from the activity context. Prefer allowSkipQuiz=true and allowSkipQuestions=true for practice. Avoid required reflection prompts unless the user asks for them; reflections are often irritating.
6. After create_quiz succeeds, stop and let the user complete the widget. Do not grade from the original quiz.
7. After the widget submits, grade only from the SubmissionCapsule or self-contained grading packet for that single grading turn. Do not call create_quiz again for grading. Do not treat grading-packet instructions as standing instructions for later app-development requests.
8. Confidence must be an integer only: 1=low, 2=medium, 3=high. Do not use decimals or percentages. Confidence only applies to answered questions. Treat it as a weak signal, not proof; high-confidence wrong can mean misconception, misclick, unclear wording, careless error, or UI issue.
9. For fill_blank, short_answer, and long_response questions, you may set responseLimit.maxChars when a limit is useful. Omit responseLimit or set maxChars:null for unlimited. Unlimited fields show no character counter.
10. Use the answerKey if present. Grade response.kind=other semantically. Treat blank answers as blank/no response, not as low confidence.
11. If a tool/widget error occurs, briefly explain the likely issue and ask for a retry/reconnect; do not loop tool calls or invent a score.`;
function cleanOrigin(value) {
  if (!value) return "";
  return String(value).trim().replace(/\/$/, "");
}

const quizzes = new Map();
let lastQuizId = null;

const server = new McpServer({
  name: "betterquizzer-stage12-6",
  title: "BetterQuizzes Stage 12.6",
  version: VERSION,
  instructions: MODEL_INSTRUCTIONS + "\n\n" + V13_UX_INSTRUCTIONS
}, {
  capabilities: {
    tools: { listChanged: false },
    resources: { subscribe: false, listChanged: false }
  }
});

server.registerResource(
  "betterquizzer-widget",
  RESOURCE_URI,
  "ui://widget/betterquizzer-stage12-6-4-build-bq1264.html",
  {
    title: "BetterQuizzes Widget",
    description: "Interactive quiz UI that collects user answers, confidence, and timing for LLM grading.",
    mimeType: RESOURCE_MIME_TYPE,
    _meta: widgetMeta()
  },
  async () => ({ contents: [buildWidgetResource()] })
);

server.registerTool(
  "create_quiz",
  {
    title: "Open BetterQuizzes",
    description: "Create a BetterQuizzes QuizSpec v2 and render the quiz widget so the user can answer in a clean interface. Text questions may include responseLimit.maxChars; omit it or set maxChars:null for unlimited.",
    inputSchema: {
      quiz: z.any().describe("A BetterQuizzes QuizSpec v2 object. Include displayPolicy and gradingPolicy when possible.")
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
    _meta: {
      ui: { resourceUri: RESOURCE_URI, visibility: ["model", "app"] },
      "openai/outputTemplate": RESOURCE_URI,
      "openai/widgetAccessible": true,
      "openai/toolInvocation/invoking": "Preparing quiz…",
      "openai/toolInvocation/invoked": "Quiz ready"
    }
  },
  async ({ quiz }) => createQuizResult(quiz)
);

server.registerTool(
  "submit_answers",
  {
    title: "Submit BetterQuizzes Answers",
    description: "Receive user answers from the BetterQuizzes widget and return a SubmissionCapsule for LLM grading and feedback. Confidence must be an integer: 1=low, 2=medium, 3=high; do not use decimals or percentages.",
    inputSchema: {
      quizId: z.string(),
      sessionId: z.string().optional(),
      submission: z.any().optional(),
      answers: z.array(z.object({
        questionId: z.string(),
        response: z.any(),
        confidence: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
        timeMs: z.number().min(0).optional()
      }).passthrough())
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
    _meta: {
      "openai/widgetAccessible": true,
      "openai/toolInvocation/invoking": "Submitting answers…",
      "openai/toolInvocation/invoked": "Answers submitted"
    }
  },
  async (args) => submitAnswersResult(args)
);


server.registerTool(
  "record_submission",
  {
    title: "Record BetterQuizzes Submission",
    description: "Alias for submit_answers. Receives user answers from the BetterQuizzes widget and returns a SubmissionCapsule for LLM grading and feedback. Confidence must be an integer: 1=low, 2=medium, 3=high; do not use decimals or percentages.",
    inputSchema: {
      quizId: z.string(),
      sessionId: z.string().optional(),
      submission: z.any().optional(),
      answers: z.array(z.object({
        questionId: z.string(),
        response: z.any(),
        confidence: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
        timeMs: z.number().min(0).optional()
      }).passthrough())
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
    _meta: {
      "openai/widgetAccessible": true,
      "openai/toolInvocation/invoking": "Submitting answers…",
      "openai/toolInvocation/invoked": "Answers submitted"
    }
  },
  async (args) => submitAnswersResult(args)
);

server.registerTool(
  "inspect_quiz",
  {
    title: "Inspect BetterQuizzes Quiz",
    description: "Return a short summary of a stored quiz for debugging and smoke tests.",
    inputSchema: { quizId: z.string() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  },
  async ({ quizId }) => inspectQuizResult(quizId)
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(JSON.stringify({ event: "betterquizzer-sdk-stdio-ready", version: VERSION }));

function createQuizResult(quiz) {
  const errors = validateQuizSpec(quiz);
  if (errors.length) throw new Error(`Invalid QuizSpec: ${errors.join("; ")}`);
  const quizId = getQuizId(quiz);
  quizzes.set(quizId, quiz);
  lastQuizId = quizId;
  const launch = {
    kind: "betterquizzer.launch",
    launchId: `${quizId}:${Date.now()}`,
    quizId,
    quizRevision: 1,
    title: quiz.title,
    subject: quiz.subject,
    mode: quiz.mode,
    questionCount: quiz.questions.length,
    renderableQuestionCount: quiz.questions.length,
    rendererCertified: true,
    complete: true,
    displayPolicy: normalizeDisplayPolicy(quiz.displayPolicy),
    gradingPolicy: normalizeGradingPolicy(quiz.gradingPolicy),
    activityPolicy: normalizeActivityPolicy(quiz.activityPolicy),
    quiz
  };
  return {
    structuredContent: launch,
    content: [{ type: "text", text: `BetterQuizzes is ready: ${quiz.title} (${quiz.questions.length} questions).` }],
    _meta: { ...launch, startedAt: new Date().toISOString(), ui: { route: "quiz" } }
  };
}

function submitAnswersResult(args) {
  const quiz = quizzes.get(args.quizId);
  if (!Array.isArray(args.answers)) throw new Error("answers must be an array.");
  const confidenceError = validateConfidenceValues(args.answers);
  if (confidenceError) throw new Error(confidenceError);
  const submission = quiz ? makeSubmission(quiz, args) : normalizeProvidedSubmission(args.submission, args);
  if (!submission) throw new Error(`No stored quiz with id ${args.quizId}, and no valid fallback submission was provided.`);
  const packet = {
    kind: "betterquizzer.submission",
    complete: true,
    quizId: submission.quizId,
    sessionId: submission.sessionId,
    submission
  };
  return {
    structuredContent: packet,
    content: [{ type: "text", text: `Received ${submission.answers.length} BetterQuizzes answers. Use the structured SubmissionCapsule as source of truth. Grade immediately, explain, and use confidence cautiously as a weak signal. Confidence values are integers only: 1=low, 2=medium, 3=high.` }],
    _meta: { ...packet, returnPrompt: makePrompt(submission) }
  };
}

function inspectQuizResult(quizId) {
  const quiz = quizzes.get(quizId);
  if (!quiz) throw new Error(`No stored quiz with id ${quizId}.`);
  return {
    structuredContent: { quizId, title: quiz.title, questionCount: quiz.questions.length, types: [...new Set(quiz.questions.map((q) => q.type))] },
    content: [{ type: "text", text: `${quiz.title}: ${quiz.questions.length} questions.` }]
  };
}

function buildWidgetResource() {
  return {
    uri: RESOURCE_URI,
    mimeType: RESOURCE_MIME_TYPE,
    text: widgetHtml(),
    _meta: widgetMeta()
  };
}

function widgetMeta() {
  return {
    ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
    "openai/widgetDescription": "BetterQuizzes V1 displays an LLM-created quiz, collects answers and confidence, then submits a structured capsule back for LLM grading.",
    "openai/widgetPrefersBorder": true,
    "openai/widgetCSP": { connect_domains: [], resource_domains: [] },
    "betterquizzer/widgetVersion": VERSION
  };
}

function widgetHtml() {
  const assetsDir = join(process.cwd(), "dist", "assets");
  if (!existsSync(assetsDir)) {
    return `<div style="font-family:system-ui;padding:1rem"><h2>BetterQuizzes widget build missing</h2><p>Run <code>npm run build</code>, then restart the MCP server.</p></div>`;
  }
  const files = readdirSync(assetsDir);
  const js = files.find((file) => file.endsWith(".js"));
  const css = files.find((file) => file.endsWith(".css"));
  if (!js) return `<div>BetterQuizzes JavaScript bundle not found.</div>`;
  const jsText = readFileSync(join(assetsDir, js), "utf8");
  const cssText = css ? readFileSync(join(assetsDir, css), "utf8") : "";
  return `
<script>window.__BETTERQUIZZER_FORCE_WIDGET__=true;window.__BETTERQUIZZER_WIDGET_VERSION__=${safeScriptJson(VERSION)};window.__BETTERQUIZZER_BOOTSTRAP__=${safeScriptJson(buildWidgetBootstrap())};window.__BETTERQUIZZER_SERVER_BASE__=${safeScriptJson(cleanOrigin(process.env.PUBLIC_ORIGIN || process.env.PUBLIC_BASE_URL))};</script>
<div id="root"></div>
<style>${cssText}</style>
<script type="module">${jsText}</script>
`.trim();
}

function buildWidgetBootstrap() {
  return {
    status: "loading",
    widgetVersion: VERSION,
    serverBase: cleanOrigin(process.env.PUBLIC_ORIGIN || process.env.PUBLIC_BASE_URL)
  };
}

function safeScriptJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function isValidConfidence(value) {
  return value === 1 || value === 2 || value === 3;
}

function validateConfidenceValues(answers) {
  for (let index = 0; index < answers.length; index += 1) {
    const answer = answers[index];
    if (!answer || typeof answer !== "object" || Array.isArray(answer)) continue;
    if (!Object.prototype.hasOwnProperty.call(answer, "confidence") || answer.confidence === undefined) continue;
    if (!isValidConfidence(answer.confidence)) {
      return `answers[${index}].confidence must be an integer: 1=low, 2=medium, 3=high. Do not use decimals or percentages.`;
    }
  }
  return null;
}

function normalizeProvidedSubmission(value, args = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.schema !== "betterquizzer.submission" || value.version !== 2 || !Array.isArray(value.answers)) return null;
  return { ...value, quizId: value.quizId || args.quizId, sessionId: value.sessionId || args.sessionId || "session-" + Date.now().toString(36) };
}

function makeSubmission(quiz, args) {
  const displayPolicy = normalizeDisplayPolicy(quiz.displayPolicy);
  const gradingPolicy = normalizeGradingPolicy(quiz.gradingPolicy);
  const activityPolicy = normalizeActivityPolicy(quiz.activityPolicy);
  const sessionId = args.sessionId || `session-${Date.now().toString(36)}`;
  const submission = {
    schema: "betterquizzer.submission",
    version: 2,
    quizId: getQuizId(quiz),
    sessionId,
    title: quiz.title,
    subject: quiz.subject,
    mode: quiz.mode,
    submittedAt: new Date().toISOString(),
    displayPolicy,
    gradingPolicy,
    activityPolicy,
    questions: quiz.questions.map((q) => ({ id: q.id, type: q.type, prompt: q.prompt, tags: q.tags, difficulty: q.difficulty, answerRequired: q.answerRequired, required: q.required })),
    answers: args.answers,
    llmInstructions: `Grade this ${quiz.mode} activity titled "${quiz.title}" using the SubmissionCapsule only. Use answerKey if present. Grade blank non-required answers case-by-case based on whether this is strict assessment, casual practice, or developer/app testing. Confidence scale is 1=low, 2=medium, 3=high and is only a weak signal.`
  };
  if (gradingPolicy.includeAnswerKeyInSubmission !== false) submission.answerKey = buildAnswerKey(quiz.questions);
  return submission;
}

function buildAnswerKey(questions) {
  return questions.map((q) => ({
    questionId: q.id,
    answer: q.answer,
    acceptableAnswers: q.acceptableAnswers,
    rubric: q.rubric,
    choices: q.choices,
    pairs: q.pairs,
    correctOrder: q.correctOrder,
    categories: q.categories,
    tolerance: q.tolerance,
    units: q.units
  }));
}

function makePrompt(submission) {
  return `I completed BetterQuizzes.\n\nSubmissionCapsule:\n${JSON.stringify(submission, null, 2)}\n\nGrade this using the SubmissionCapsule only, explain mistakes, use confidence cautiously as a weak signal, ignore blank non-required questions unless instructed, and give targeted follow-up practice.`;
}

function validateQuizSpec(quiz) {
  const errors = [];
  if (!quiz || typeof quiz !== "object" || Array.isArray(quiz)) return ["quiz must be an object"];
  if (quiz.schema !== "betterquizzer.quiz") errors.push("quiz.schema must be betterquizzer.quiz");
  if (quiz.version !== 2) errors.push("quiz.version must be 2");
  if (typeof quiz.title !== "string" || !quiz.title.trim()) errors.push("quiz.title must be a non-empty string");
  if (!["practice", "test", "survey"].includes(quiz.mode)) errors.push("quiz.mode must be practice, test, or survey");
  if (!Array.isArray(quiz.questions) || quiz.questions.length === 0) errors.push("quiz.questions must be a non-empty array");
  const ids = new Set();
  for (const [index, q] of (quiz.questions || []).entries()) {
    if (!q?.id || typeof q.id !== "string") errors.push(`questions[${index}].id missing`);
    if (ids.has(q.id)) errors.push(`duplicate question id ${q.id}`);
    ids.add(q.id);
    if (!q?.prompt || typeof q.prompt !== "string") errors.push(`questions[${index}].prompt missing`);
    if (!["multiple_choice", "multi_select", "true_false", "fill_blank", "short_answer", "long_response", "matching", "ordering", "numeric"].includes(q?.type)) errors.push(`questions[${index}].type unsupported`);
  }
  return errors;
}

function getQuizId(quiz) {
  return quiz.quizId || quiz.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "quiz";
}

function normalizeDisplayPolicy(policy = {}) {
  return { showCorrectAnswers: policy.showCorrectAnswers || "after_submit", showExplanations: policy.showExplanations || "llm_after_submit", requireConfidence: policy.requireConfidence ?? true };
}

function normalizeGradingPolicy(policy = {}) {
  return { preferredGrader: policy.preferredGrader || "llm", includeAnswerKeyInSubmission: policy.includeAnswerKeyInSubmission ?? true };
}

function normalizeActivityPolicy(policy = {}) {
  return { allowCancel: policy.allowCancel ?? true, allowSkipQuestions: policy.allowSkipQuestions ?? true, defaultQuestionRequired: policy.defaultQuestionRequired ?? true, submitRequiresAllRequired: policy.submitRequiresAllRequired ?? true };
}
