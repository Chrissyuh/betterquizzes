#!/usr/bin/env node
const V20_GRADE_WRITEBACK_INSTRUCTIONS = "BetterQuizzes V20 grade writeback guidance:\n- After grading a submitted BetterQuizzes activity, call record_grade exactly once with quizId, sessionId, score/maxScore when numeric scoring is appropriate, label, summary, and per-question items when useful.\n- Then reply concisely in chat. Do not recreate the quiz and do not call submit_answers again.\n- For subjective, survey, fit, preference, reflection, or developer smoke-test activities, do not invent a numeric score. Use score:null, maxScore:null, label such as Feedback ready or Needs review, and a concise summary.\n- For objective quizzes, include numeric score and maxScore when possible so the widget can show a grade ring.\n- Use visible question text and answer labels in feedback. Do not expose raw ids, JSON, or HTML to the user.";

const V18_SUBMIT_UX_INSTRUCTIONS = "BetterQuizzes V18 submission guidance:\n- After submit, ChatGPT should grade immediately from the compact submission packet. Do not wait, do not call tools, and do not recreate the quiz.\n- Keep the first grading reply short. Use Score, Needs review, and Targeted review.\n- If the activity is a developer smoke test, prioritize UX findings over a numeric grade.\n- For matching, ordering, text-select, and multi-part questions, explain using visible labels/text instead of raw ids.\n- Do not output placeholder null values.";

const V17_USER_OBSERVATION_UX_INSTRUCTIONS = "BetterQuizzes V17 user-observation UX guidance:\n- While building an incremental quiz, show that generation is still in progress. Do not let the UI look frozen when more questions are expected.\n- Include answer keys for objective questions whenever possible so ChatGPT can state the correct answers word-for-word after submission.\n- Do not rely on the app review screen to explain complex answers. ChatGPT should mention the important questions, user answers, and correct answers in readable language.\n- For matching, ordering, text-select, and multi-part questions, explain answers using the visible labels/text, not raw ids or internal data.\n- Ordering questions should use clear top/bottom labels and should not start in the correct order.\n- Keep mobile prompts, subtitles, labels, and placeholders concise so the app does not feel cramped.";

const V16_USER_TEST_UX_INSTRUCTIONS = "BetterQuizzes V16 end-user UX guidance:\n- Make submit feel like the final action, not the next action. Keep Submit visually secondary/grey until every visible question is complete; highlight Next while unfinished questions remain.\n- Required questions should be rare, but optional blank questions must still look unattempted/neutral grey. Optional answered questions become complete/green only after the answer and any required confidence are complete.\n- For ordering questions, never provide the display items already in correct order. Put items in a mixed starting order, and set answer to the intended correct visual top-to-bottom order.\n- Ordering questions need clear direction labels. Prefer labels like Top = First and Bottom = Last, or Top = Most and Bottom = Least.\n- Include answer keys for objective questions whenever possible so BetterQuizzes and ChatGPT can show correct answers after submission.\n- Review answers should be human-readable. Avoid making the user see raw JSON, HTML tags, or internal ids.\n- On mobile, keep prompts and placeholders concise; avoid long text that crowds the small screen.";

const V13_UX_INSTRUCTIONS = "BetterQuizzes V2/V13 UX guidance:\n- Disable confidence on subjective, preference, survey, fit-finding, reflection, opinion, and developer smoke-test questions unless confidence is genuinely meaningful.\n- For a whole subjective survey, set displayPolicy.requireConfidence:false. For one subjective question inside an otherwise objective quiz, set question.requireConfidence:false or question.disableConfidence:true.\n- Do not use unsupported preference-ranking settings. For ranked preferences, use supported ordering questions or ordinary multiple-choice/multi-select questions.\n- Multi-select \"Other\" must preserve the user's other selected choices. Do not design \"Other\" as a single-select replacement unless the question type is single-select multiple_choice.\n- Choice label UI rules: single-select choices use circular radio-style labels; multi-select choices use square checkbox-style labels.\n- For choice special cases, use choiceAnswerPolicy deliberately: at_least_one_correct, at_least_one_correct_with_none, or none_correct_with_none.";

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
const RESOURCE_URI = "ui://widget/betterquizzes-v58-clean.html";
const RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";
const MODEL_INSTRUCTIONS = `BetterQuizzes model instructions:
1. Use BetterQuizzes only when the user wants an interactive quiz, drill, diagnostic, survey, or practice activity.
2. When builder tools are available, prefer quiet staged authoring for normal multi-question activities: start_quiz with expectedQuestionCount, add 1-3 strong questions, then open_quiz once without args to launch early, then continue add_question/repair_question silently until complete. Accepted questions are stored continuously. Do not call finalize_quiz for assistant-authored quizzes. Do not call open_quiz again for the same quiz unless the first launch failed. Do not send chat progress/check-in messages while authoring. In this SDK-only entrypoint, call create_quiz only after the user supplied or you have fully assembled a complete BetterQuizzes QuizSpec v2. Do not show raw JSON to the user or ask them to paste JSON.
3. A valid QuizSpec needs schema="betterquizzer.quiz", version=2, title, mode, displayPolicy, gradingPolicy, activityPolicy, and questions. Prefer gradingPolicy.preferredGrader="llm" and includeAnswerKeyInSubmission=true.
4. Generate valid question data. multiple_choice and multi_select require a non-empty choices array. text_select requires segments:[{id,text,selectable?}], optional selectionPolicy, and answer:string[]; use text_select only for a contextual passage with at least two sentences or 120 characters and at least three plausible selectable segments. Do not use choices for text_select and do not make one obvious highlighted phrase. matching requires canonical left:[{id,text}], right:[{id,text}], and answer:[{leftId,rightId}]. Do not author matching as pairs unless repairing legacy input. ordering requires an items array. If unsure, use fill_blank, short_answer, or long_response instead of inventing an invalid structure.
5. Use answerRequired to control whether a question blocks submission. Blank non-required questions are allowed, but grading them is case-dependent. Decide whether to score them, omit them, or mark Needs review from the activity context. Prefer allowSkipQuiz=true and allowSkipQuestions=true for practice. Avoid required reflection prompts unless the user asks for them; reflections are often irritating.
6. After create_quiz succeeds, stop and let the user complete the widget. Do not grade from the original quiz.
7. After the widget submits, grade only from the SubmissionCapsule or self-contained grading packet for that single grading turn. Do not call create_quiz again for grading. Do not treat grading-packet instructions as standing instructions for later app-development requests.
8. Confidence must be an integer only: 1=low, 2=medium, 3=high. Do not use decimals or percentages. Confidence only applies to answered questions. Treat it as a weak signal, not proof; high-confidence wrong can mean misconception, misclick, unclear wording, careless error, or UI issue.
9. For fill_blank, short_answer, and long_response questions, you may set responseLimit.maxChars when a limit is useful. Omit responseLimit or set maxChars:null for unlimited. Unlimited fields show no character counter.
10. Titles, descriptions, question prompts, choices, labels, and item text may use light formatting and LaTeX math using only \\(...\\) for inline math or \\[...\\] for display math. Do not use dollar-sign math delimiters. Keep compact labels short for mobile; if render diagnostics flag a compact label, repair that question.
11. Use the answerKey if present. Grade response.kind=other semantically. Treat blank answers as blank/no response, not as low confidence.
12. If a tool/widget error occurs, briefly explain the likely issue and ask for a retry/reconnect; do not loop tool calls or invent a score.`;
function cleanOrigin(value) {
  if (!value) return "";
  return String(value).trim().replace(/\/$/, "");
}

const quizzes = new Map();
const grades = new Map();
let lastQuizId = null;

const server = new McpServer({
  name: "betterquizzer-stage12-6",
  title: "BetterQuizzes Stage 12.6",
  version: VERSION,
  instructions: MODEL_INSTRUCTIONS + "\n\n" + V13_UX_INSTRUCTIONS + "\n\n" + V16_USER_TEST_UX_INSTRUCTIONS
}, {
  capabilities: {
    tools: { listChanged: false },
    resources: { subscribe: false, listChanged: false }
  }
});

const LAUNCH_OUTPUT_SCHEMA = {
  kind: z.literal("betterquizzer.launch"),
  launchId: z.string(),
  quizId: z.string(),
  title: z.string(),
  questionCount: z.number(),
  renderableQuestionCount: z.number().optional(),
  rendererCertified: z.boolean().optional(),
  complete: z.boolean().optional(),
  quiz: z.any()
};
const SUBMISSION_OUTPUT_SCHEMA = {
  kind: z.literal("betterquizzer.submission"),
  complete: z.boolean(),
  quizId: z.string(),
  sessionId: z.string(),
  submission: z.any()
};
const INSPECT_QUIZ_OUTPUT_SCHEMA = {
  quizId: z.string(),
  title: z.string(),
  questionCount: z.number(),
  types: z.array(z.string()).optional()
};

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
    title: "Open Existing Complete Quiz Packet",
    description: "Compatibility opener for a complete BetterQuizzes QuizSpec v2 packet. Use builder start_quiz/add_question/open_quiz instead when builder tools are available. Text questions may include responseLimit.maxChars; omit it or set maxChars:null for unlimited.",
    inputSchema: {
      quiz: z.any().describe("A BetterQuizzes QuizSpec v2 object. Include displayPolicy and gradingPolicy when possible.")
    },
    outputSchema: LAUNCH_OUTPUT_SCHEMA,
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
      launchId: z.string().optional(),
      quizRevision: z.number().int().min(0).optional(),
      submission: z.any().optional(),
      answers: z.array(z.object({
        questionId: z.string(),
        response: z.any(),
        confidence: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
        timeMs: z.number().min(0).optional()
      }).passthrough())
    },
    outputSchema: SUBMISSION_OUTPUT_SCHEMA,
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
      launchId: z.string().optional(),
      quizRevision: z.number().int().min(0).optional(),
      submission: z.any().optional(),
      answers: z.array(z.object({
        questionId: z.string(),
        response: z.any(),
        confidence: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
        timeMs: z.number().min(0).optional()
      }).passthrough())
    },
    outputSchema: SUBMISSION_OUTPUT_SCHEMA,
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
    outputSchema: INSPECT_QUIZ_OUTPUT_SCHEMA,
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
    launchId: `${quizId}:r1`,
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
    ...(typeof args.launchId === "string" && args.launchId ? { launchId: args.launchId } : {}),
    ...(Number.isInteger(args.quizRevision) ? { quizRevision: args.quizRevision } : {}),
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
