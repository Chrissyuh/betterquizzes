#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const VERSION = "V1";
const PROTOCOL_VERSION = process.env.MCP_PROTOCOL_VERSION || "2025-06-18";
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-11-25"];
const RESOURCE_URI = "ui://widget/betterquizzes-v1-build-bqv1p1.html";
const RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";
const RESOURCE_URI_ALIASES = [
  RESOURCE_URI,
  "ui://widget/betterquizzer-stage12-7-0-build-bq1270.html",
  "ui://widget/betterquizzer-stage12-6-4-build-bq1264.html",
  "ui://widget/betterquizzer-stage12-6-2-build-bq1262.html",
  "ui://widget/betterquizzer-stage12-6-1-build-bq1261.html",
  "ui://widget/betterquizzer-stage12-6-0-build-bq1260.html",
  "ui://widget/betterquizzer-stage12-5-1-build-a7c9.html",
  "ui://widget/betterquizzer-stage12-5-0.html",
  "ui://widget/betterquizzer-stage12.html",
  "ui://widget/betterquizzer-stage12-1.html"
];
function isKnownWidgetResourceUri(uri) {
  return typeof uri === "string" && (RESOURCE_URI_ALIASES.includes(uri) || /^ui:\/\/widget\/(betterquizzes|betterquizzer)-stage12[-\w]*\.html$/.test(uri));
}
function listedWidgetResources() {
  return [RESOURCE_URI, ...RESOURCE_URI_ALIASES.filter((uri) => uri !== RESOURCE_URI)].map((uri) => ({
    uri,
    name: uri === RESOURCE_URI ? "BetterQuizzes Widget" : "BetterQuizzes Widget compatibility alias",
    title: "BetterQuizzes",
    mimeType: RESOURCE_MIME_TYPE
  }));
}
function cleanOrigin(value) {
  if (!value) return "";
  return String(value).trim().replace(/\/$/, "");
}

const MODEL_INSTRUCTIONS = `BetterQuizzes model instructions V1 renderer-certified contract:
1. Use BetterQuizzes only when the user wants an interactive quiz, drill, diagnostic, survey, or practice activity.
2. To start an activity, call create_quiz exactly once with {"quiz": BetterQuizzesQuizSpecV2}. Do not call create_quiz with raw questions only.
3. Use canonical public field names: activityPolicy.allowSkipQuiz, activityPolicy.allowSkipQuestions, activityPolicy.defaultAnswerRequired, activityPolicy.submitRequiresRequiredAnswers. Do not use legacy aliases unless repairing older input.
4. Quiz design variety: do not default an ordinary quiz to all multiple-choice. Unless the user explicitly asks for all multiple-choice, mix suitable types from multiple_choice, multi_select, true_false, fill_blank, short_answer, long_response, multi_typing, multi_write_vertical, text_select, ordering, matching, and numeric. Use multi_write_vertical when a prompt needs any number of separate written answers, text_select when the user should select words/segments inside a passage, ordering for sequences, matching for pairs, numeric for calculations, and fill_blank/short_answer for recall.
5. Answer shapes: multiple_choice answer is a zero-based choice index; multi_select answer is zero-based choice indexes; true_false answer is boolean; numeric answer is number with optional tolerance; fill_blank/short_answer answer is string or string[] plus optional acceptableAnswers; ordering answer is ordered item ids in visual top-to-bottom order and should include orderingBehavior labels when direction matters; matching answer is [{leftId,rightId}].
6. Each advertised question type has renderer certification. If create_quiz returns renderDiagnostics.unrenderableQuestions or rendererCertified=false, fix the QuizSpec and call create_quiz once more. Do not keep retrying blindly.
7. Required questions should be rare. BetterQuizzes is usually AI practice, not a school-grade test. Default to activityPolicy.defaultAnswerRequired=false with allowSkipQuiz=true and allowSkipQuestions=true unless the user explicitly asks for a strict test, certification check, or all-questions-required assessment. Use answerRequired=true only for essential blocking questions. If uncertainty is expected, make the question optional or include an explicit ‘I’m not sure’ choice. Blank non-required questions are allowed and should not be penalized. Reflections should be optional unless the user asks for them.
8. Avoid answer leakage: do not reveal the answer to an earlier unresolved question in later prompts, choices, matching labels, examples, or explanations. For matching questions, do not place right-side answers in the same order as the left side; shuffle or naturally reorder them. Keep placeholder/example text short enough for the field size; compact and multi-write field placeholders should usually stay under 35–45 characters. Formatting controls are off by default; set question.formatting=true only for notation-heavy written answers where it helps, mainly math, chemistry, formulas, exponents, or subscripts.
9. After create_quiz succeeds, stop and let the user complete the widget. Do not grade from the original quiz.
10. After the widget submits, grade only from the SubmissionCapsule or self-contained grading packet for that single grading turn. Do not call create_quiz again for grading. Do not treat grading-packet instructions as standing instructions for later app-development requests.
11. For fill_blank, short_answer, and long_response questions, you may set responseLimit.maxChars when a limit is useful. Omit responseLimit or set maxChars:null for unlimited. Unlimited fields show no character counter.
10. Confidence must be an integer only: 1=low, 2=medium, 3=high. Do not use decimals or percentages. Confidence only applies to answered questions. Treat it as a weak signal, not proof.`;



const V17_USER_OBSERVATION_UX_INSTRUCTIONS = "BetterQuizzes V17 user-observation UX guidance:\n- While building an incremental quiz, show that generation is still in progress. Do not let the UI look frozen when more questions are expected.\n- Include answer keys for objective questions whenever possible so ChatGPT can state the correct answers word-for-word after submission.\n- Do not rely on the app review screen to explain complex answers. ChatGPT should mention the important questions, user answers, and correct answers in readable language.\n- For matching, ordering, text-select, and multi-part questions, explain answers using the visible labels/text, not raw ids or internal data.\n- Ordering questions should use clear top/bottom labels and should not start in the correct order.\n- Keep mobile prompts, subtitles, labels, and placeholders concise so the app does not feel cramped.";

const V16_USER_TEST_UX_INSTRUCTIONS = "BetterQuizzes V16 end-user UX guidance:\n- Make submit feel like the final action, not the next action. Keep Submit visually secondary/grey until every visible question is complete; highlight Next while unfinished questions remain.\n- Required questions should be rare, but optional blank questions must still look unattempted/neutral grey. Optional answered questions become complete/green only after the answer and any required confidence are complete.\n- For ordering questions, never provide the display items already in correct order. Put items in a mixed starting order, and set answer to the intended correct visual top-to-bottom order.\n- Ordering questions need clear direction labels. Prefer labels like Top = First and Bottom = Last, or Top = Most and Bottom = Least.\n- Include answer keys for objective questions whenever possible so BetterQuizzes and ChatGPT can show correct answers after submission.\n- Review answers should be human-readable. Avoid making the user see raw JSON, HTML tags, or internal ids.\n- On mobile, keep prompts and placeholders concise; avoid long text that crowds the small screen.";

const V13_UX_INSTRUCTIONS = "BetterQuizzes V2/V13 UX guidance:\n- Disable confidence on subjective, preference, survey, fit-finding, reflection, opinion, and developer smoke-test questions unless confidence is genuinely meaningful.\n- For a whole subjective survey, set displayPolicy.requireConfidence:false. For one subjective question inside an otherwise objective quiz, set question.requireConfidence:false or question.disableConfidence:true.\n- Do not use unsupported preference-ranking settings. For ranked preferences, use supported ordering questions or ordinary multiple-choice/multi-select questions.\n- Multi-select \"Other\" must preserve the user's other selected choices. Do not design \"Other\" as a single-select replacement unless the question type is single-select multiple_choice.\n- Choice label UI rules: single-select choices use circular radio-style labels; multi-select choices use square checkbox-style labels.\n- For choice special cases, use choiceAnswerPolicy deliberately: at_least_one_correct, at_least_one_correct_with_none, or none_correct_with_none.";

const CANONICAL_QUIZ_EXAMPLE = {
  quiz: {
    schema: "betterquizzer.quiz", version: 2, quizId: "sample-algebra-quiz", title: "Sample Algebra Quiz", subject: "Algebra", mode: "practice",
    displayPolicy: { showCorrectAnswers: "after_submit", showExplanations: "llm_after_submit", requireConfidence: true },
    gradingPolicy: { preferredGrader: "llm", includeAnswerKeyInSubmission: true },
    activityPolicy: { allowSkipQuiz: true, allowSkipQuestions: true, defaultAnswerRequired: false, submitRequiresRequiredAnswers: true },
    choiceBehavior: { allowOther: false },
    questions: [
      { id: "q1", type: "multiple_choice", prompt: "Solve: 2x + 3 = 11", choices: ["x = 2", "x = 4", "x = 7", "x = 8"], answer: 1, answerRequired: false, tags: ["linear-equations"], difficulty: 1 },
      { id: "q2", type: "fill_blank", prompt: "The coefficient of x in 5x + 2 is ________.", answer: "5", answerRequired: false, tags: ["vocabulary"], difficulty: 1 }
    ], metadata: { createdBy: "llm", tags: ["example"] }
  }
};
const CHOICE_ITEM_SCHEMA = { anyOf: [{ type: "string", minLength: 1 }, { type: "object", properties: { id: { type: "string", minLength: 1 }, text: { type: "string", minLength: 1 }, label: { type: "string" }, value: { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] } }, required: ["id", "text"], additionalProperties: true }] };
const ORDERING_BEHAVIOR_SCHEMA = { type: "object", properties: { direction: { const: "top_to_bottom" }, topLabel: { type: "string" }, bottomLabel: { type: "string" } }, additionalProperties: false };
const RESPONSE_LIMIT_SCHEMA = { type: "object", properties: { maxChars: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] }, minChars: { type: "integer", minimum: 0 }, showCounter: { type: "boolean" } }, additionalProperties: false };
const MULTI_TYPING_FIELD_SCHEMA = { type: "object", properties: { id: { type: "string", minLength: 1 }, label: { type: "string", minLength: 1 }, placeholder: { type: "string" }, responseLimit: RESPONSE_LIMIT_SCHEMA, answer: { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] }, acceptableAnswers: { type: "array", items: { type: "string" } }, expectedKeywords: { type: "array", items: { type: "string" } } }, required: ["id", "label"], additionalProperties: true };
const TEXT_SELECT_SEGMENT_SCHEMA = { type: "object", properties: { id: { type: "string", minLength: 1 }, text: { type: "string", minLength: 1 }, selectable: { type: "boolean" } }, required: ["id", "text"], additionalProperties: true };
const TEXT_SELECT_POLICY_SCHEMA = { type: "object", properties: { mode: { enum: ["exact_count", "all_that_apply", "range"] }, count: { type: "integer", minimum: 1 }, min: { type: "integer", minimum: 0 }, max: { type: "integer", minimum: 1 }, instruction: { type: "string" } }, additionalProperties: true };
const COMMON_Q = { id: { type: "string", minLength: 1 }, type: { type: "string" }, prompt: { type: "string", minLength: 1 }, answerRequired: { type: "boolean" }, required: { type: "boolean", description: "Backward-compatible alias. Prefer answerRequired." }, tags: { type: "array", items: { type: "string" } }, difficulty: { type: "number", minimum: 1, maximum: 5 }, points: { type: "number", minimum: 0 }, choiceBehavior: { type: "object", properties: { allowOther: { type: "boolean" }, otherLabel: { type: "string" } }, additionalProperties: false }, orderingBehavior: ORDERING_BEHAVIOR_SCHEMA, responseLimit: RESPONSE_LIMIT_SCHEMA, formatting: { type: "boolean", description: "Opt-in plain-text formatting toolbar. Rare; use mainly for math, chemistry, exponents, subscripts, or notation-heavy answers." } };
const QUESTION_SCHEMA = { oneOf: [
  { title: "MultipleChoiceQuestion", type: "object", properties: { ...COMMON_Q, type: { const: "multiple_choice" }, choices: { type: "array", minItems: 1, items: CHOICE_ITEM_SCHEMA }, answer: { anyOf: [{ type: "number", minimum: 0 }, { type: "string" }] } }, required: ["id", "type", "prompt", "choices"], additionalProperties: true },
  { title: "MultiSelectQuestion", type: "object", properties: { ...COMMON_Q, type: { const: "multi_select" }, choices: { type: "array", minItems: 1, items: CHOICE_ITEM_SCHEMA }, answer: { type: "array", items: { anyOf: [{ type: "number", minimum: 0 }, { type: "string" }] } } }, required: ["id", "type", "prompt", "choices"], additionalProperties: true },
  { title: "TrueFalseQuestion", type: "object", properties: { ...COMMON_Q, type: { const: "true_false" }, answer: { type: "boolean" } }, required: ["id", "type", "prompt"], additionalProperties: true },
  { title: "FillBlankQuestion", type: "object", properties: { ...COMMON_Q, type: { const: "fill_blank" }, answer: { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] }, acceptableAnswers: { type: "array", items: { type: "string" } }, placeholder: { type: "string" } }, required: ["id", "type", "prompt"], additionalProperties: true },
  { title: "ShortAnswerQuestion", type: "object", properties: { ...COMMON_Q, type: { const: "short_answer" }, answer: { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] }, acceptableAnswers: { type: "array", items: { type: "string" } }, expectedKeywords: { type: "array", items: { type: "string" } } }, required: ["id", "type", "prompt"], additionalProperties: true },
  { title: "LongResponseQuestion", type: "object", properties: { ...COMMON_Q, type: { const: "long_response" }, answer: { type: "string" }, rubric: { type: "array", items: { type: "string" } } }, required: ["id", "type", "prompt"], additionalProperties: true },
  { title: "MultiTypingQuestion", type: "object", properties: { ...COMMON_Q, type: { const: "multi_typing" }, fields: { type: "array", minItems: 2, items: MULTI_TYPING_FIELD_SCHEMA }, answer: { type: "object", additionalProperties: { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] } } }, required: ["id", "type", "prompt", "fields"], additionalProperties: true },
  { title: "MultiWriteVerticalQuestion", type: "object", properties: { ...COMMON_Q, type: { const: "multi_write_vertical" }, fields: { type: "array", minItems: 1, items: MULTI_TYPING_FIELD_SCHEMA }, answer: { type: "object", additionalProperties: { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] } }, rubric: { type: "array", items: { type: "string" } } }, required: ["id", "type", "prompt", "fields"], additionalProperties: true },
  { title: "TextSelectQuestion", type: "object", properties: { ...COMMON_Q, type: { const: "text_select" }, text: { type: "string" }, segments: { type: "array", minItems: 1, items: TEXT_SELECT_SEGMENT_SCHEMA }, selectionPolicy: TEXT_SELECT_POLICY_SCHEMA, answer: { type: "array", items: { type: "string" } }, rubric: { type: "array", items: { type: "string" } } }, required: ["id", "type", "prompt", "segments"], additionalProperties: true },
  { title: "NumericQuestion", type: "object", properties: { ...COMMON_Q, type: { const: "numeric" }, answer: { type: "number" }, tolerance: { type: "number", minimum: 0 }, unit: { type: "string" } }, required: ["id", "type", "prompt"], additionalProperties: true },
  { title: "OrderingQuestion", type: "object", properties: { ...COMMON_Q, type: { const: "ordering" }, items: { type: "array", minItems: 2, items: { type: "object", properties: { id: { type: "string" }, text: { type: "string" } }, required: ["id", "text"], additionalProperties: true } }, answer: { type: "array", items: { type: "string" } } }, required: ["id", "type", "prompt", "items"], additionalProperties: true },
  { title: "MatchingQuestion", type: "object", properties: { ...COMMON_Q, type: { const: "matching" }, left: { type: "array", minItems: 1, items: { type: "object", properties: { id: { type: "string" }, text: { type: "string" } }, required: ["id", "text"], additionalProperties: true } }, right: { type: "array", minItems: 1, items: { type: "object", properties: { id: { type: "string" }, text: { type: "string" } }, required: ["id", "text"], additionalProperties: true } }, answer: { type: "array", items: { type: "object", properties: { leftId: { type: "string" }, rightId: { type: "string" } }, required: ["leftId", "rightId"], additionalProperties: false } } }, required: ["id", "type", "prompt", "left", "right"], additionalProperties: true }
] };
const QUIZ_SPEC_SCHEMA = { type: "object", title: "BetterQuizzesQuizSpecV2", description: "Exact renderable BetterQuizzes QuizSpec v2. Canonical renderer fields are id/type/prompt/choices/answer/answerRequired.", properties: { schema: { const: "betterquizzer.quiz" }, version: { const: 2 }, quizId: { type: "string" }, title: { type: "string", minLength: 1 }, description: { type: "string" }, subject: { type: "string" }, mode: { enum: ["practice", "test", "survey"] }, displayPolicy: { type: "object", properties: { showCorrectAnswers: { enum: ["instant", "after_submit", "never"] }, showExplanations: { enum: ["llm_after_submit", "never"] }, requireConfidence: { type: "boolean" } }, additionalProperties: false }, gradingPolicy: { type: "object", properties: { preferredGrader: { enum: ["llm", "local", "hybrid"] }, includeAnswerKeyInSubmission: { type: "boolean" } }, additionalProperties: false }, activityPolicy: { type: "object", description: "Canonical fields: allowSkipQuiz, allowSkipQuestions, defaultAnswerRequired, submitRequiresRequiredAnswers. Legacy aliases are accepted but not preferred.", properties: { allowSkipQuiz: { type: "boolean", description: "Canonical. Show a top-right Skip quiz control." }, allowSkipQuestions: { type: "boolean" }, defaultAnswerRequired: { type: "boolean", description: "Canonical. Default for question.answerRequired." }, submitRequiresRequiredAnswers: { type: "boolean", description: "Canonical. Disable final submit until required questions are answered." }, allowCancel: { type: "boolean", deprecated: true, description: "Deprecated alias for allowSkipQuiz." }, defaultQuestionRequired: { type: "boolean", deprecated: true, description: "Deprecated alias for defaultAnswerRequired." }, submitRequiresAllRequired: { type: "boolean", deprecated: true, description: "Deprecated alias for submitRequiresRequiredAnswers." } }, additionalProperties: false }, choiceBehavior: { type: "object", properties: { allowOther: { type: "boolean" }, otherLabel: { type: "string" } }, additionalProperties: false }, questions: { type: "array", minItems: 1, items: QUESTION_SCHEMA }, metadata: { type: "object", additionalProperties: true } }, required: ["schema", "version", "title", "mode", "questions"], additionalProperties: false };
const CREATE_QUIZ_INPUT_SCHEMA = { type: "object", properties: { quiz: QUIZ_SPEC_SCHEMA }, required: ["quiz"], additionalProperties: false };
const SUBMIT_ANSWERS_INPUT_SCHEMA = { type: "object", properties: { quizId: { type: "string" }, sessionId: { type: "string" }, submission: { type: "object" }, answers: { type: "array", items: { type: "object", properties: { questionId: { type: "string" }, response: { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "object" }] } }, { type: "object", additionalProperties: true }, { type: "null" }] }, confidence: { type: "integer", enum: [1, 2, 3], description: "Confidence must be an integer: 1=low, 2=medium, 3=high. Do not use decimals or percentages." }, timeMs: { type: "number", minimum: 0 } }, required: ["questionId", "response"], additionalProperties: true } } }, required: ["quizId", "answers"], additionalProperties: false };
const QUESTION_TYPE_GUIDE = "Question answer shapes: multiple_choice answer=zero-based index; multi_select answer=zero-based indexes; true_false answer=boolean; numeric answer=number plus optional tolerance; fill_blank/short_answer answer=string or string[] plus optional acceptableAnswers and optional responseLimit.maxChars; ordering answer=ordered item ids in visual top-to-bottom order with orderingBehavior labels when direction matters; matching answer=[{leftId,rightId}].";
const CREATE_QUIZ_DESCRIPTION = "Create and open a BetterQuizzes activity. Input MUST be {\"quiz\": BetterQuizzesQuizSpecV2}. Use canonical policy names allowSkipQuiz/defaultAnswerRequired/submitRequiresRequiredAnswers. Quiz design guidance: do not default to all multiple-choice; mix appropriate question types and use any number of choices, fields, segments, matches, or correct answers when useful. Required questions should be rare in practice activities; defaultAnswerRequired=false is preferred unless the user asks for a strict test. Avoid leaking earlier answers in later questions. Shuffle matching answer options. Formatting is opt-in per question and should be used mainly for math/chemistry notation. " + QUESTION_TYPE_GUIDE + " " + V13_UX_INSTRUCTIONS + " Canonical minimal example: " + JSON.stringify(CANONICAL_QUIZ_EXAMPLE) + ". The server returns renderDiagnostics, including componentByQuestion, normalizedFields, and rendererCertified.";


const quizzes = new Map();
let lastQuizId = null;
const builtInQuizzes = loadBuiltInQuizzes();
for (const quiz of builtInQuizzes) quizzes.set(getQuizId(quiz), quiz);

const tools = [
  { name: "create_quiz", title: "Open BetterQuizzes", description: CREATE_QUIZ_DESCRIPTION, inputSchema: CREATE_QUIZ_INPUT_SCHEMA, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false }, _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ["model", "app"] }, "openai/outputTemplate": RESOURCE_URI, "openai/widgetAccessible": true, "openai/toolInvocation/invoking": "Preparing quiz…", "openai/toolInvocation/invoked": "Quiz ready" } },
  { name: "submit_answers", title: "Submit BetterQuizzes Answers", description: "Receive final user answers from the BetterQuizzes widget and return a SubmissionCapsule. After this tool returns, grade immediately and concisely from this result; do not reopen, recreate, or re-run the original quiz. Confidence must be an integer: 1=low, 2=medium, 3=high; do not use decimals or percentages.", inputSchema: SUBMIT_ANSWERS_INPUT_SCHEMA, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false }, _meta: { "openai/widgetAccessible": true, "openai/toolInvocation/invoking": "Submitting answers…", "openai/toolInvocation/invoked": "Answers submitted" } },
  { name: "inspect_quiz", title: "Inspect BetterQuizzes Quiz", description: "Return a short summary and render diagnostics for a stored quiz.", inputSchema: { type: "object", properties: { quizId: { type: "string" } }, required: ["quizId"], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true } }
];

const submitAnswersAlias = tools.find((tool) => tool.name === "submit_answers");
if (submitAnswersAlias && !tools.some((tool) => tool.name === "record_submission")) {
  tools.splice(tools.findIndex((tool) => tool.name === "inspect_quiz"), 0, {
    ...submitAnswersAlias,
    name: "record_submission",
    title: "Record BetterQuizzes Submission",
    description: "Alias for submit_answers. Receives final user answers from the BetterQuizzes widget and returns a SubmissionCapsule for grading."
  });
}

function handleRequest(message) {
  if (!message || message.jsonrpc !== "2.0") return;
  const { id, method, params } = message;

  if (method === "initialize") {
    ok(id, {
      protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } },
      serverInfo: { name: "betterquizzes", title: "BetterQuizzes", version: VERSION }, instructions: MODEL_INSTRUCTIONS + "\n\n" + V13_UX_INSTRUCTIONS + "\n\n" + V16_USER_TEST_UX_INSTRUCTIONS
    });
    return;
  }

  if (method === "notifications/initialized") return;
  if (method === "ping") return ok(id, {});
  if (method === "tools/list") return ok(id, { tools });
  if (method === "resources/list") return ok(id, { resources: listedWidgetResources() });
  if (method === "resources/read") {
    if (!isKnownWidgetResourceUri(params?.uri)) return fail(id, -32602, "Unknown resource URI");
    return ok(id, { contents: [buildWidgetResource(params?.uri || RESOURCE_URI)] });
  }

  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    if (name === "create_quiz") return createQuiz(id, args.quiz);
    if (name === "submit_answers" || name === "record_submission") return submitAnswers(id, args);
    if (name === "inspect_quiz") return inspectQuiz(id, args.quizId);
    return fail(id, -32601, `Unknown tool: ${name}`);
  }

  fail(id, -32601, `Unknown method: ${method}`);
}

function createQuiz(id, rawQuiz) {
  const prepared = prepareQuizForRender(rawQuiz);
  if (!prepared.ok) return fail(id, -32602, "Invalid or unrenderable QuizSpec", { errors: prepared.errors, warnings: prepared.warnings, renderDiagnostics: prepared.diagnostics, canonicalExample: CANONICAL_QUIZ_EXAMPLE });
  const quiz = prepared.quiz;
  const quizId = getQuizId(quiz);
  quiz.quizId = quizId;
  quizzes.set(quizId, quiz);
  lastQuizId = quizId;
  const publicQuiz = toPublicQuiz(quiz);
  const launch = {
    kind: "betterquizzer.launch",
    launchId: `${quizId}:${Date.now()}`,
    quizId,
    quizRevision: 1,
    title: quiz.title,
    subject: quiz.subject,
    mode: quiz.mode,
    questionCount: quiz.questions.length,
    renderableQuestionCount: prepared.diagnostics.renderableQuestionCount,
    unrenderableQuestions: prepared.diagnostics.unrenderableQuestions,
    warnings: prepared.warnings,
    renderDiagnostics: prepared.diagnostics,
    rendererCertified: prepared.diagnostics.rendererCertified === true,
    complete: prepared.diagnostics.rendererCertified === true && prepared.diagnostics.renderableQuestionCount === quiz.questions.length,
    displayPolicy: normalizeDisplayPolicy(quiz.displayPolicy),
    gradingPolicy: normalizeGradingPolicy(quiz.gradingPolicy),
    activityPolicy: toCanonicalActivityPolicy(quiz.activityPolicy),
    quiz: publicQuiz
  };
  return ok(id, { structuredContent: launch, content: [{ type: "text", text: `BetterQuizzes is ready: ${quiz.title} (${prepared.diagnostics.renderableQuestionCount}/${quiz.questions.length} renderable questions).` }], _meta: { ...launch, startedAt: new Date().toISOString(), ui: { route: "quiz" } } });
}

function submitAnswers(id, args) {
  const providedSubmission = normalizeProvidedSubmission(args.submission, args);
  const effectiveAnswers = Array.isArray(args.answers) ? args.answers : providedSubmission?.answers;
  const quiz = quizzes.get(args.quizId) || (providedSubmission?.quizId ? quizzes.get(providedSubmission.quizId) : null);
  if (!Array.isArray(effectiveAnswers)) return fail(id, -32602, "answers must be an array, or submission.answers must be provided.");
  const confidenceError = validateConfidenceValues(effectiveAnswers);
  if (confidenceError) return fail(id, -32602, confidenceError);
  const normalizedArgs = { ...args, answers: effectiveAnswers, quizId: args.quizId || providedSubmission?.quizId };
  const submission = quiz ? makeSubmission(quiz, normalizedArgs) : providedSubmission;
  if (!submission) return fail(id, -32602, `No stored quiz with id ${args.quizId}, and no valid fallback submission was provided.`);
  const packet = {
    kind: "betterquizzer.submission",
    complete: true,
    quizId: submission.quizId,
    sessionId: submission.sessionId,
    submission
  };
  ok(id, {
    structuredContent: packet,
    content: [{ type: "text", text: `Received ${submission.answers.length} BetterQuizzes answers.${(submission.completion?.requiredTotal ?? 0) > 0 ? ` Required questions complete: ${submission.completion?.requiredAnswered ?? "?"}/${submission.completion?.requiredTotal ?? "?"}.` : ""} Use the structured SubmissionCapsule as the source of truth. Grade case-by-case: strict checks may count skipped relevant questions wrong or Needs review, casual practice may omit blank optional answers, and developer smoke tests should prioritize app/UX findings over score. Explain mistakes and use confidence cautiously as a weak signal.` }],
    _meta: { ...packet, returnPrompt: makePrompt(submission) }
  });
}

function inspectQuiz(id, quizId) {
  const quiz = quizzes.get(quizId);
  if (!quiz) return fail(id, -32602, `No stored quiz with id ${quizId}.`);
  const renderDiagnostics = getRenderDiagnostics(quiz);
  return ok(id, { structuredContent: { quizId, title: quiz.title, questionCount: quiz.questions.length, renderableQuestionCount: renderDiagnostics.renderableQuestionCount, unrenderableQuestions: renderDiagnostics.unrenderableQuestions, warnings: renderDiagnostics.warnings, renderDiagnostics, types: [...new Set(quiz.questions.map((q) => q.type))] }, content: [{ type: "text", text: `${quiz.title}: ${renderDiagnostics.renderableQuestionCount}/${quiz.questions.length} renderable questions.` }] });
}

function buildWidgetResource(requestedUri = RESOURCE_URI) {
  const origin = cleanOrigin(process.env.PUBLIC_ORIGIN || process.env.PUBLIC_BASE_URL);
  const connectDomains = origin ? [origin] : [];
  return {
    uri: RESOURCE_URI,
    mimeType: RESOURCE_MIME_TYPE,
    text: widgetHtml(),
    _meta: {
      ui: {
        prefersBorder: true,
        csp: { connectDomains, resourceDomains: connectDomains }
      },
      "openai/widgetDescription": "BetterQuizzes V1 displays an LLM-created quiz, collects answers and confidence, then submits a structured capsule back for LLM grading.",
      "betterquizzer/widgetVersion": VERSION,
      "betterquizzer/requestedResourceUri": requestedUri,
      "betterquizzer/canonicalResourceUri": RESOURCE_URI,
      "openai/widgetPrefersBorder": true,
      "openai/widgetCSP": { connect_domains: connectDomains, resource_domains: connectDomains }
    }
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
<script>
window.__BETTERQUIZZER_FORCE_WIDGET__=true;
window.__BETTERQUIZZER_WIDGET_VERSION__=${safeScriptJson(VERSION)};
window.__BETTERQUIZZER_BOOTSTRAP__=${safeScriptJson(buildWidgetBootstrap())};
window.__BETTERQUIZZER_SERVER_BASE__=${safeScriptJson(cleanOrigin(process.env.PUBLIC_ORIGIN || process.env.PUBLIC_BASE_URL))};
window.addEventListener("error",function(e){var root=document.getElementById("root");if(root&&!root.dataset.bqMounted){root.innerHTML='<main class="shell narrow"><section class="card stack fatal-widget-error"><p class="eyebrow">BetterQuizzes V1</p><h1>Widget failed to load</h1><pre class="error-box"></pre></section></main>';var pre=root.querySelector("pre");if(pre)pre.textContent=String(e.error&&e.error.message||e.message||e.error||"Unknown error");}});
window.addEventListener("unhandledrejection",function(e){var root=document.getElementById("root");if(root&&!root.dataset.bqMounted){root.innerHTML='<main class="shell narrow"><section class="card stack fatal-widget-error"><p class="eyebrow">BetterQuizzes V1</p><h1>Widget promise failed</h1><pre class="error-box"></pre></section></main>';var pre=root.querySelector("pre");if(pre)pre.textContent=String(e.reason&&e.reason.message||e.reason||"Unknown rejection");}});
</script>
<div id="root"><main class="shell narrow"><section class="card stack"><p class="eyebrow">BetterQuizzes V1</p><h1>Loading quiz…</h1><p>If this stays here, the widget bundle did not mount.</p></section></main></div>
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

function loadBuiltInQuizzes() {
  const examplesDir = join(process.cwd(), "src", "shared", "examples");
  if (!existsSync(examplesDir)) return [];
  return readdirSync(examplesDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      try { return JSON.parse(readFileSync(join(examplesDir, file), "utf8")); }
      catch { return null; }
    })
    .filter((quiz) => quiz && quiz.schema === "betterquizzer.quiz" && quiz.version === 2 && Array.isArray(quiz.questions));
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
  const answers = Array.isArray(args.answers) ? args.answers : [];
  const completion = buildCompletionSummary(quiz, answers, displayPolicy, activityPolicy);
  const warnings = [];
  if (!completion.isComplete) warnings.push(`Incomplete submission: missing required ${completion.missingRequiredQuestionIds.join(",") || "none"}; missing confidence ${completion.missingRequiredConfidenceIds.join(",") || "none"}.`);
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
    completion,
    status: {
      localSaved: true,
      hostSubmitted: true,
      followUpRequested: false,
      duplicateSubmission: false,
      warnings,
    },
    questions: quiz.questions.map((q) => ({ id: q.id, type: q.type, prompt: q.prompt, tags: q.tags, difficulty: q.difficulty, answerRequired: q.answerRequired, required: q.required, ...(q.type === "ordering" ? { orderingBehavior: q.orderingBehavior } : {}) })),
    answers,
    llmInstructions: `Grade this ${quiz.mode} activity titled "${quiz.title}" using the SubmissionCapsule only. Use the answerKey if present. Grade blank non-required answers case-by-case based on the activity context. In strict knowledge checks, skipped relevant items can be Incorrect or Needs review; in casual practice/check-ins, blank optional items may be omitted from the score when useful; in developer/app smoke tests, prioritize UX/debug findings over the academic score. Confidence scale: confidence must be an integer only: 1=low, 2=medium, 3=high. Do not use decimals or percentages. Confidence only applies to answered questions. Treat confidence as a weak signal, not proof: high-confidence wrong can be a misconception, misclick, careless error, unclear wording, or UI issue. Blank answers mean no response; do not infer why. For response.kind=other, grade the text semantically. For ordering questions, response arrays are visual top-to-bottom order; use answer.meta.topLabel and answer.meta.bottomLabel to interpret endpoints. These grading instructions apply only while responding to this submitted activity. Give targeted review and, if useful, one short follow-up drill, then stop.`
  };
  if (gradingPolicy.includeAnswerKeyInSubmission !== false) {
    const answerKey = buildAnswerKey(quiz.questions);
    if (answerKey.length) submission.answerKey = answerKey;
  }
  return submission;
}

function buildCompletionSummary(quiz, answers, displayPolicy = normalizeDisplayPolicy(quiz.displayPolicy), activityPolicy = normalizeActivityPolicy(quiz.activityPolicy)) {
  const answerMap = new Map((answers || []).map((answer) => [answer.questionId, answer]));
  const required = quiz.questions.filter((q) => isQuestionRequired(q, activityPolicy));
  const optional = quiz.questions.filter((q) => !isQuestionRequired(q, activityPolicy));
  const missingRequiredQuestionIds = [];
  const missingRequiredConfidenceIds = [];
  for (const question of required) {
    const answer = answerMap.get(question.id);
    if (!answerHasResponse(answer)) missingRequiredQuestionIds.push(question.id);
    if (questionRequiresConfidence(question, displayPolicy) && answerHasResponse(answer) && !isValidConfidence(answer.confidence)) missingRequiredConfidenceIds.push(question.id);
  }
  return {
    requiredTotal: required.length,
    requiredAnswered: required.length - missingRequiredQuestionIds.length,
    optionalTotal: optional.length,
    optionalAnswered: optional.filter((question) => answerHasResponse(answerMap.get(question.id))).length,
    missingRequiredQuestionIds,
    missingRequiredConfidenceIds,
    isComplete: missingRequiredQuestionIds.length === 0 && missingRequiredConfidenceIds.length === 0,
  };
}


function questionRequiresConfidence(question, displayPolicy) {
  if (!displayPolicy?.requireConfidence) return false;
  if (!question || typeof question !== "object") return Boolean(displayPolicy.requireConfidence);
  if (question.disableConfidence === true) return false;
  if (question.requireConfidence === false) return false;
  if (question.confidenceRequired === false) return false;
  if (question.confidence === false || question.confidence === "disabled") return false;
  return true;
}

function isQuestionRequired(question, activityPolicy) {
  return question.answerRequired ?? question.required ?? activityPolicy.defaultAnswerRequired;
}

function answerHasResponse(answer) {
  if (!answer) return false;
  const response = answer.response;
  if (response === null || response === undefined) return false;
  if (typeof response === "string") return response.trim().length > 0;
  if (Array.isArray(response)) return response.length > 0;
  if (typeof response === "object") {
    if (response.kind === "other") return typeof response.text === "string" && response.text.trim().length > 0 || Array.isArray(response.selections) && response.selections.length > 0;
    if (response.kind === "cancelled") return true;
  }
  return true;
}

function buildAnswerKey(questions) {
  return questions.flatMap((q) => {
    if (q.answer !== undefined) return [{ questionId: q.id, answer: q.answer, tolerance: q.tolerance, unit: q.unit, expectedKeywords: q.expectedKeywords, rubric: q.rubric }];
    if (q.expectedKeywords || q.rubric) return [{ questionId: q.id, expectedKeywords: q.expectedKeywords, rubric: q.rubric }];
    return [];
  });
}

function makePrompt(submission) {
  const missing = [
    ...(submission.completion?.missingRequiredQuestionIds || []),
    ...(submission.completion?.missingRequiredConfidenceIds || [])
  ];
  return [
    "I completed a BetterQuizzes activity.",
    `Submission: ${submission.quizId} / ${submission.sessionId}`,
    `Completion: ${submission.completion?.requiredAnswered ?? "?"}/${submission.completion?.requiredTotal ?? "?"} required answered; missing: ${missing.join(", ") || "none"}.`,
    "Grade using the structured SubmissionCapsule returned by the tool. Do not recreate the quiz. Grade blank non-required answers case-by-case based on whether this is strict assessment, casual practice, or developer/app testing.",
    "Use confidence cautiously as a weak signal. If answer text conflicts with confidence, prioritize the answer text.",
    "For ordering questions, response arrays are visual top-to-bottom order; use answer.meta.topLabel and answer.meta.bottomLabel to interpret endpoints.",
  ].join("\n");
}

function validateQuizSpec(quiz) {
  const prepared = prepareQuizForRender(quiz);
  return prepared.ok ? [] : prepared.errors;
}

function prepareQuizForRender(input) {
  const errors = [];
  const warnings = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, errors: ["quiz must be an object in the tool argument shape { quiz: { ... } }."], warnings, diagnostics: emptyDiagnostics() };
  const quiz = clone(input);
  if (quiz.schema !== "betterquizzer.quiz") errors.push("quiz.schema must be betterquizzer.quiz");
  if (quiz.version !== 2) errors.push("quiz.version must be 2");
  if (typeof quiz.title !== "string" || !quiz.title.trim()) errors.push("quiz.title must be a non-empty string");
  if (!["practice", "test", "survey"].includes(quiz.mode)) errors.push("quiz.mode must be practice, test, or survey");
  if (!Array.isArray(quiz.questions) || quiz.questions.length === 0) errors.push("quiz.questions must be a non-empty array");
  quiz.displayPolicy = normalizeDisplayPolicy(quiz.displayPolicy);
  quiz.gradingPolicy = normalizeGradingPolicy(quiz.gradingPolicy);
  const normalizedFields = [];
  quiz.activityPolicy = normalizeActivityPolicy(quiz.activityPolicy, warnings, normalizedFields);
  const ids = new Set();
  if (Array.isArray(quiz.questions)) {
    quiz.questions = quiz.questions.map((raw, index) => normalizeQuestion(raw, index, warnings, normalizedFields));
    quiz.questions.forEach((q, index) => {
      if (!q || typeof q !== "object" || Array.isArray(q)) { errors.push(`questions[${index}] must be an object.`); return; }
      if (!isNonEmptyString(q.id)) errors.push(`questions[${index}].id must be a non-empty string.`); else if (ids.has(q.id)) errors.push(`duplicate question id ${q.id}`); else ids.add(q.id);
      if (!isNonEmptyString(q.prompt)) errors.push(`questions[${index}].prompt must be a non-empty string.`);
      if (!SUPPORTED_QUESTION_TYPES.has(String(q.type))) errors.push(`questions[${index}].type unsupported: ${String(q.type)}`);
    });
  }
  const diagnostics = getRenderDiagnostics(quiz, warnings, normalizedFields);
  for (const item of diagnostics.unrenderableQuestions) errors.push((item.questionId || item.index) + ": " + item.reason);
  return { ok: errors.length === 0, quiz, errors, warnings: diagnostics.warnings, diagnostics };
}
const SUPPORTED_QUESTION_TYPES = new Set(["multiple_choice", "multi_select", "true_false", "fill_blank", "short_answer", "long_response", "multi_typing", "multi_write_vertical", "text_select", "matching", "ordering", "numeric"]);
const QUESTION_TYPE_ALIASES = new Map([["multipleChoice", "multiple_choice"], ["multiple-choice", "multiple_choice"], ["mcq", "multiple_choice"], ["multiSelect", "multi_select"], ["multi-select", "multi_select"], ["trueFalse", "true_false"], ["true-false", "true_false"], ["fillBlank", "fill_blank"], ["fill-in-the-blank", "fill_blank"], ["shortAnswer", "short_answer"], ["short-answer", "short_answer"], ["longResponse", "long_response"], ["long-response", "long_response"], ["multiTyping", "multi_typing"], ["multi-typing", "multi_typing"], ["multiWriteVertical", "multi_write_vertical"], ["multi-write-vertical", "multi_write_vertical"], ["textSelect", "text_select"], ["text-select", "text_select"]]);
function normalizeQuestion(raw, index, warnings, normalizedFields = []) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const q = { ...raw };
  if (!q.id && q.questionId) { q.id = String(q.questionId); warnings.push(`questions[${index}]: normalized questionId to id.`); normalizedFields.push({ path: `questions[${index}]`, from: "questionId", to: "id" }); }
  if (!q.prompt) { const promptAliasName = q.stem !== undefined ? "stem" : q.question !== undefined ? "question" : q.text !== undefined ? "text" : q.title !== undefined ? "title" : null; const alias = q.stem ?? q.question ?? q.text ?? q.title; if (typeof alias === "string") { q.prompt = alias; warnings.push(`questions[${index}]: normalized ${promptAliasName} to prompt.`); normalizedFields.push({ path: `questions[${index}]`, from: promptAliasName, to: "prompt" }); } }
  if (typeof q.type === "string" && QUESTION_TYPE_ALIASES.has(q.type)) { const fromType = q.type; q.type = QUESTION_TYPE_ALIASES.get(q.type); warnings.push(`questions[${index}]: normalized question type alias ${fromType} to ${q.type}.`); normalizedFields.push({ path: `questions[${index}].type`, from: fromType, to: q.type }); }
  if (q.answerRequired === undefined && q.required !== undefined) { q.answerRequired = q.required; normalizedFields.push({ path: `questions[${index}]`, from: "required", to: "answerRequired" }); }
  if (q.answer === undefined) { if (q.correctAnswer !== undefined) { q.answer = q.correctAnswer; warnings.push(`questions[${index}]: normalized correctAnswer to answer.`); normalizedFields.push({ path: `questions[${index}]`, from: "correctAnswer", to: "answer" }); } else if (q.answerKey !== undefined) { q.answer = q.answerKey; warnings.push(`questions[${index}]: normalized answerKey to answer.`); normalizedFields.push({ path: `questions[${index}]`, from: "answerKey", to: "answer" }); } }
  if (q.answer === undefined && Array.isArray(q.acceptedAnswers) && (q.type === "fill_blank" || q.type === "short_answer")) { q.answer = q.acceptedAnswers; warnings.push(`questions[${index}]: normalized acceptedAnswers to answer.`); }
  if ((q.type === "multiple_choice" || q.type === "multi_select") && !q.choices && q.options) { q.choices = q.options; warnings.push(`questions[${index}]: normalized options to choices.`); normalizedFields.push({ path: `questions[${index}]`, from: "options", to: "choices" }); }
  if ((q.type === "multiple_choice" || q.type === "multi_select") && Array.isArray(q.choices)) {
    const normalized = normalizeChoices(q.choices, index, warnings);
    q.choices = normalized.texts;
    if (q.type === "multiple_choice" && q.answer !== undefined) q.answer = normalizeChoiceAnswer(q.answer, normalized, warnings, index);
    if (q.type === "multi_select" && Array.isArray(q.answer)) q.answer = q.answer.map((answer) => normalizeChoiceAnswer(answer, normalized, warnings, index)).filter((value) => Number.isInteger(value));
  }
  if (q.type === "ordering") {
    q.orderingBehavior = normalizeOrderingBehavior(q.orderingBehavior, q.prompt);
    if (!raw.orderingBehavior) normalizedFields.push({ path: `questions[${index}].orderingBehavior`, from: "prompt", to: "orderingBehavior" });
  }
  return q;
}
function normalizeChoices(choices, index, warnings) {
  const ids = [], texts = [];
  choices.forEach((choice, choiceIndex) => {
    if (typeof choice === "string") { texts.push(choice); ids.push(String.fromCharCode(65 + choiceIndex)); return; }
    if (choice && typeof choice === "object") { const id = choice.id != null ? String(choice.id) : String.fromCharCode(65 + choiceIndex); const text = choice.text ?? choice.label ?? choice.value ?? choice.id; if (["string", "number", "boolean"].includes(typeof text)) { texts.push(String(text)); ids.push(id); warnings.push(`questions[${index}].choices[${choiceIndex}]: normalized object choice to text string.`); } }
  });
  return { ids, texts };
}
function normalizeChoiceAnswer(answer, normalizedChoices, warnings, questionIndex) {
  if (typeof answer === "number" && Number.isInteger(answer)) return answer;
  if (typeof answer !== "string") return answer;
  const trimmed = answer.trim();
  const letterIndex = /^[A-Za-z]$/.test(trimmed) ? trimmed.toUpperCase().charCodeAt(0) - 65 : -1;
  if (letterIndex >= 0 && letterIndex < normalizedChoices.texts.length) { warnings.push(`questions[${questionIndex}]: normalized letter answer ${trimmed} to zero-based index ${letterIndex}.`); return letterIndex; }
  const idIndex = normalizedChoices.ids.findIndex((id) => id === trimmed);
  if (idIndex >= 0) { warnings.push(`questions[${questionIndex}]: normalized choice id answer ${trimmed} to zero-based index ${idIndex}.`); return idIndex; }
  const textIndex = normalizedChoices.texts.findIndex((text) => text.trim().toLowerCase() === trimmed.toLowerCase());
  if (textIndex >= 0) { warnings.push(`questions[${questionIndex}]: normalized answer text to zero-based index ${textIndex}.`); return textIndex; }
  return answer;
}
function normalizeOrderingBehavior(raw, prompt) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const topLabel = typeof raw.topLabel === "string" && raw.topLabel.trim() ? raw.topLabel.trim() : null;
    const bottomLabel = typeof raw.bottomLabel === "string" && raw.bottomLabel.trim() ? raw.bottomLabel.trim() : null;
    if (topLabel && bottomLabel) return { direction: "top_to_bottom", topLabel, bottomLabel };
  }
  return inferOrderingBehavior(typeof prompt === "string" ? prompt : "");
}
function inferOrderingBehavior(prompt) {
  const normalized = prompt.toLowerCase();
  if (normalized.includes("greatest to least") || normalized.includes("largest to smallest") || normalized.includes("highest to lowest")) return { direction: "top_to_bottom", topLabel: "Greatest", bottomLabel: "Least" };
  if (normalized.includes("least to greatest") || normalized.includes("smallest to largest") || normalized.includes("lowest to highest")) return { direction: "top_to_bottom", topLabel: "Least", bottomLabel: "Greatest" };
  if (normalized.includes("oldest to newest")) return { direction: "top_to_bottom", topLabel: "Oldest", bottomLabel: "Newest" };
  if (normalized.includes("newest to oldest")) return { direction: "top_to_bottom", topLabel: "Newest", bottomLabel: "Oldest" };
  if (normalized.includes("first to last")) return { direction: "top_to_bottom", topLabel: "First", bottomLabel: "Last" };
  return { direction: "top_to_bottom", topLabel: "First", bottomLabel: "Last" };
}
function getRenderDiagnostics(quiz, inheritedWarnings = [], normalizedFields = []) {
  const warnings = [...inheritedWarnings];
  const unrenderableQuestions = [];
  const componentByQuestion = {};
  const answerKeyWarnings = [];
  const questions = Array.isArray(quiz?.questions) ? quiz.questions : [];
  questions.forEach((q, index) => {
    const questionId = q?.id || `questions[${index}]`;
    if (!q || typeof q !== "object" || Array.isArray(q)) { unrenderableQuestions.push({ index, questionId, reason: "Question is not an object." }); return; }
    if (!isNonEmptyString(q.id)) unrenderableQuestions.push({ index, questionId, reason: "Missing required field: id." });
    if (!isNonEmptyString(q.prompt)) unrenderableQuestions.push({ index, questionId, reason: "Missing required field: prompt." });
    if (!SUPPORTED_QUESTION_TYPES.has(String(q.type))) {
      unrenderableQuestions.push({ index, questionId, reason: `Unsupported type: ${String(q.type)}.` });
      return;
    }
    componentByQuestion[String(questionId)] = rendererComponentForType(q.type);
    if ((q.type === "multiple_choice" || q.type === "multi_select") && (!Array.isArray(q.choices) || q.choices.length < 1 || !q.choices.every((choice) => typeof choice === "string" && choice.trim().length > 0))) unrenderableQuestions.push({ index, questionId, reason: "Choice question requires choices: string[] with at least one non-empty choice." });
    if (q.type === "matching" && (!Array.isArray(q.left) || !Array.isArray(q.right) || q.left.length < 1 || q.right.length < 1 || !q.left.every(isRenderableItem) || !q.right.every(isRenderableItem))) unrenderableQuestions.push({ index, questionId, reason: "Matching question requires left and right arrays of {id,text} items." });
    if (q.type === "multi_typing" && (!Array.isArray(q.fields) || q.fields.length < 2 || !q.fields.every(isRenderableTypingField))) unrenderableQuestions.push({ index, questionId, reason: "Multi-typing question requires fields: {id,label}[] with at least two valid fields." });
    if (q.type === "multi_write_vertical" && (!Array.isArray(q.fields) || q.fields.length < 1 || !q.fields.every(isRenderableTypingField))) unrenderableQuestions.push({ index, questionId, reason: "Multi-write vertical question requires fields: {id,label}[] with at least one valid field." });
    if (q.type === "text_select" && (!Array.isArray(q.segments) || q.segments.length < 1 || !q.segments.every(isRenderableTextSegment))) unrenderableQuestions.push({ index, questionId, reason: "Text-select question requires segments: {id,text}[] with at least one valid segment." });
    if (q.type === "ordering" && (!Array.isArray(q.items) || q.items.length < 2 || !q.items.every(isRenderableItem))) unrenderableQuestions.push({ index, questionId, reason: "Ordering question requires items: {id,text}[] with at least two valid items." });
    validateAnswerShape(q, questionId, answerKeyWarnings);
  });
  const rendererCertified = unrenderableQuestions.length === 0;
  return { questionCount: questions.length, renderableQuestionCount: Math.max(0, questions.length - unrenderableQuestions.length), unrenderableQuestions, warnings: [...warnings, ...answerKeyWarnings], rendererCertified, componentByQuestion, normalizedFields };
}
function rendererComponentForType(type) {
  return ({ multiple_choice: "MultipleChoiceQuestion", multi_select: "MultiSelectQuestion", true_false: "TrueFalseQuestion", fill_blank: "FillBlankQuestion", short_answer: "ShortAnswerQuestion", long_response: "LongResponseQuestion", multi_typing: "MultiTypingQuestion", multi_write_vertical: "MultiWriteVerticalQuestion", text_select: "TextSelectQuestion", numeric: "NumericQuestion", ordering: "OrderingQuestion", matching: "MatchingQuestion" })[type] || "UnsupportedQuestion";
}
function isRenderableTypingField(field) {
  return Boolean(field) && typeof field === "object" && isNonEmptyString(field.id) && isNonEmptyString(field.label);
}
function isRenderableTextSegment(segment) {
  return Boolean(segment) && typeof segment === "object" && isNonEmptyString(segment.id) && isNonEmptyString(segment.text);
}
function isRenderableItem(item) {
  return Boolean(item) && typeof item === "object" && isNonEmptyString(item.id) && isNonEmptyString(item.text);
}
function validateAnswerShape(q, questionId, warnings) {
  if (q.answer === undefined) { warnings.push(`${questionId}: no answer key provided; LLM can still grade open-ended answers if appropriate.`); return; }
  if (q.type === "multiple_choice" && !(Number.isInteger(q.answer) && Array.isArray(q.choices) && q.answer >= 0 && q.answer < q.choices.length)) warnings.push(`${questionId}: multiple_choice answer should be a valid zero-based choice index.`);
  if (q.type === "multi_select" && !(Array.isArray(q.answer) && q.answer.every((value) => Number.isInteger(value) && Array.isArray(q.choices) && value >= 0 && value < q.choices.length))) warnings.push(`${questionId}: multi_select answer should be zero-based choice indexes.`);
  if (q.type === "true_false" && typeof q.answer !== "boolean") warnings.push(`${questionId}: true_false answer should be boolean.`);
  if (q.type === "numeric" && typeof q.answer !== "number") warnings.push(`${questionId}: numeric answer should be a number.`);
  if ((q.type === "fill_blank" || q.type === "short_answer") && !(typeof q.answer === "string" || Array.isArray(q.answer))) warnings.push(`${questionId}: ${q.type} answer should be string or string[].`);
  if ((q.type === "multi_typing" || q.type === "multi_write_vertical") && (!q.answer || typeof q.answer !== "object" || Array.isArray(q.answer))) warnings.push(`${questionId}: ${q.type} answer should be a field-id keyed object.`);
  if (q.type === "text_select" && !Array.isArray(q.answer)) warnings.push(`${questionId}: text_select answer should be selected segment ids.`);
  if (q.type === "ordering" && Array.isArray(q.items) && Array.isArray(q.answer)) {
    const ids = new Set(q.items.map((item) => item.id));
    if (!q.answer.every((id) => ids.has(id))) warnings.push(`${questionId}: ordering answer should contain only item ids from items[].`);
  }
  if (q.type === "matching" && Array.isArray(q.answer) && !q.answer.every((pair) => pair && typeof pair.leftId === "string" && typeof pair.rightId === "string")) warnings.push(`${questionId}: matching answer should be [{leftId,rightId}].`);
}
function emptyDiagnostics() { return { questionCount: 0, renderableQuestionCount: 0, unrenderableQuestions: [], warnings: [], rendererCertified: false, componentByQuestion: {}, normalizedFields: [] }; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function isNonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }

function getQuizId(quiz) {
  return quiz.quizId || quiz.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "quiz";
}

function normalizeDisplayPolicy(policy = {}) {
  return { showCorrectAnswers: policy.showCorrectAnswers || "after_submit", showExplanations: policy.showExplanations || "llm_after_submit", requireConfidence: policy.requireConfidence ?? true };
}

function normalizeGradingPolicy(policy = {}) {
  return { preferredGrader: policy.preferredGrader || "llm", includeAnswerKeyInSubmission: policy.includeAnswerKeyInSubmission ?? true };
}

function normalizeActivityPolicy(policy = {}, warnings = [], normalizedFields = []) {
  const allowSkipQuiz = policy.allowSkipQuiz ?? policy.allowCancel ?? true;
  const defaultAnswerRequired = policy.defaultAnswerRequired ?? policy.defaultQuestionRequired ?? false;
  const submitRequiresRequiredAnswers = policy.submitRequiresRequiredAnswers ?? policy.submitRequiresAllRequired ?? true;
  if (policy.allowCancel !== undefined && policy.allowSkipQuiz === undefined) { warnings.push("activityPolicy.allowCancel normalized to allowSkipQuiz."); normalizedFields.push({ path: "activityPolicy", from: "allowCancel", to: "allowSkipQuiz" }); }
  if (policy.defaultQuestionRequired !== undefined && policy.defaultAnswerRequired === undefined) { warnings.push("activityPolicy.defaultQuestionRequired normalized to defaultAnswerRequired."); normalizedFields.push({ path: "activityPolicy", from: "defaultQuestionRequired", to: "defaultAnswerRequired" }); }
  if (policy.submitRequiresAllRequired !== undefined && policy.submitRequiresRequiredAnswers === undefined) { warnings.push("activityPolicy.submitRequiresAllRequired normalized to submitRequiresRequiredAnswers."); normalizedFields.push({ path: "activityPolicy", from: "submitRequiresAllRequired", to: "submitRequiresRequiredAnswers" }); }
  return {
    allowSkipQuiz,
    allowCancel: allowSkipQuiz,
    allowSkipQuestions: policy.allowSkipQuestions ?? true,
    defaultAnswerRequired,
    defaultQuestionRequired: defaultAnswerRequired,
    submitRequiresRequiredAnswers,
    submitRequiresAllRequired: submitRequiresRequiredAnswers
  };
}
function toCanonicalActivityPolicy(policy = {}) {
  const normalized = normalizeActivityPolicy(policy);
  return {
    allowSkipQuiz: normalized.allowSkipQuiz,
    allowSkipQuestions: normalized.allowSkipQuestions,
    defaultAnswerRequired: normalized.defaultAnswerRequired,
    submitRequiresRequiredAnswers: normalized.submitRequiresRequiredAnswers
  };
}
function toPublicQuiz(quiz) {
  return { ...quiz, activityPolicy: toCanonicalActivityPolicy(quiz.activityPolicy) };
}

function ok(id, result) { send({ jsonrpc: "2.0", id, result }); }
function fail(id, code, message, data) { send({ jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } }); }
function send(message) {
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}

let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    const header = buffer.slice(0, headerEnd).toString("utf8");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + length) return;
    const body = buffer.slice(bodyStart, bodyStart + length).toString("utf8");
    buffer = buffer.slice(bodyStart + length);
    try { handleRequest(JSON.parse(body)); } catch (error) { fail(null, -32700, error instanceof Error ? error.message : String(error)); }
  }
});
