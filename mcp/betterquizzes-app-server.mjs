#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { V2_BUILDER_INSTRUCTIONS } from "./shared-authoring-guidance.mjs";

// BEGIN BETTERQUIZZES V23 BUILDER REPAIR
const START_QUIZ_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", description: "Quiz title shown to the user." },
    description: { type: "string", description: "Optional short quiz description." },
    topic: { type: "string", description: "Topic, standard, or learning objective." },
    quizId: { type: "string", description: "Optional stable quiz id. Usually omit and let BetterQuizzes derive it from the title." },
    expectedQuestionCount: { type: "integer", minimum: 1 },
    instructions: { type: "string", description: "Authoring constraints or user preferences." },
    metadata: { type: "object", additionalProperties: true }
  },
  required: ["title"]
};

const SUPPORTED_QUESTION_TYPE_VALUES = ["multiple_choice", "multi_select", "true_false", "fill_blank", "short_answer", "long_response", "multi_typing", "multi_write_vertical", "text_select", "matching", "ordering", "numeric"];
const BUILDER_WORKFLOW = [
  "Call start_quiz to create a draft only.",
  "Call add_question exactly once for the first accepted/renderable question; this launches the widget.",
  "Continue add_question or repair_question silently for later questions; the launched widget polls updates.",
  "Use open_quiz only to recover or reopen an already stored quiz.",
  "Do not call finalize_quiz for normal assistant-authored quizzes."
];
const BUILDER_DO_NOT_CALL = [
  "open_quiz in the normal first-question creation path",
  "finalize_quiz for normal assistant-authored quizzes",
  "create_quiz with raw question arrays"
];
const BUILDER_VALIDATION_POLICY = "add_question validates every question against the renderer-supported type and shape contract before storing it.";
const BUILDER_CAPABILITIES = {
  supportedQuestionTypes: SUPPORTED_QUESTION_TYPE_VALUES,
  unsupportedQuestionTypes: ["multiple_select"],
  supportsConfidence: true,
  supportsExplanations: true,
  supportsAnswerKeys: true,
  supportsPartialCredit: false,
  launchTool: "open_quiz",
  validationPolicy: BUILDER_VALIDATION_POLICY
};

function builderContractFields() {
  return {
    supportedQuestionTypes: [...SUPPORTED_QUESTION_TYPE_VALUES],
    workflow: [...BUILDER_WORKFLOW],
    doNotCall: [...BUILDER_DO_NOT_CALL],
    validationPolicy: BUILDER_VALIDATION_POLICY,
    capabilities: { ...BUILDER_CAPABILITIES, supportedQuestionTypes: [...SUPPORTED_QUESTION_TYPE_VALUES] }
  };
}

const ADD_QUESTION_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: true,
  properties: {
    draftId: { type: "string", description: "Draft id returned by start_quiz." },
    question: { type: "object", additionalProperties: true, description: `Required. One BetterQuizzes v2 question object. Supported type values: ${SUPPORTED_QUESTION_TYPE_VALUES.join(", ")}. Use multi_select, not multiple_select, for multiple-answer questions.` },
    repairedQuestion: { type: "object", additionalProperties: true, description: "Replacement question for repair_question compatibility; repair_question should normally use repairedQuestion." },
    replace: { type: "boolean", description: "Replace an existing question instead of appending." },
    repair: { type: "boolean", description: "Whether this call is repairing a rejected question." },
    replaceQuestionId: { type: "string" },
    replaceIndex: { type: "integer", minimum: 0 },
    reason: { type: "string" }
  },
  required: ["draftId", "question"]
};

const REPAIR_QUESTION_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: true,
  properties: {
    draftId: { type: "string", description: "Draft id returned by start_quiz." },
    repairedQuestion: { type: "object", additionalProperties: true, description: `Required. Replacement BetterQuizzes v2 question object. Supported type values: ${SUPPORTED_QUESTION_TYPE_VALUES.join(", ")}. Use multi_select, not multiple_select, for multiple-answer questions.` },
    replace: { type: "boolean", const: true, description: "Set true to replace the bad question." },
    replaceQuestionId: { type: "string", description: "Id of the question being replaced." },
    replaceIndex: { type: "integer", minimum: 0, description: "Zero-based index of the question being replaced." },
    reason: { type: "string" }
  },
  required: ["draftId", "repairedQuestion"]
};

const FINALIZE_QUIZ_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: true,
  properties: {
    draftId: { type: "string", description: "Draft id returned by start_quiz." },
    quizId: { type: "string", description: "Optional final canonical quiz id to store and return." },
    quiz: { type: "object", additionalProperties: true, description: "Optional complete quiz object." },
    questions: {
      type: "array",
      items: { type: "object", additionalProperties: true },
      description: "Optional explicit question list."
    },
    title: { type: "string" },
    description: { type: "string" },
    metadata: { type: "object", additionalProperties: true }
  }
};

const OPEN_QUIZ_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    quizId: { type: "string", description: "Optional stored quiz id. Omit to open the latest stored quiz." }
  }
};


const GENERIC_OBJECT_SCHEMA = { type: "object", additionalProperties: true };
const BUILDER_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    kind: { type: "string" },
    draftId: { type: "string" },
    launchId: { type: "string" },
    quizId: { type: "string" },
    quizRevision: { type: "integer", minimum: 0 },
    recoveryToken: { type: "string" },
    questionCount: { type: "integer", minimum: 0 },
    declaredQuestionCount: { type: "integer", minimum: 0 },
    packetProgress: GENERIC_OBJECT_SCHEMA,
    renderableQuestionCount: { type: "integer", minimum: 0 },
    rendererCertified: { type: "boolean" },
    complete: { type: "boolean" },
    safeToPresentToUser: { type: "boolean" },
    launchStatus: { type: "string" },
    question: GENERIC_OBJECT_SCHEMA,
    draft: GENERIC_OBJECT_SCHEMA,
    quiz: GENERIC_OBJECT_SCHEMA,
    needsRepair: { type: "boolean" },
    tool: { type: "string" },
    issues: { type: "array", items: { type: "string" } },
    invalid: { type: "array", items: GENERIC_OBJECT_SCHEMA },
    repairRequest: GENERIC_OBJECT_SCHEMA,
    instructions: { type: "string" },
    supportedQuestionTypes: { type: "array", items: { type: "string" } },
    workflow: { type: "array", items: { type: "string" } },
    doNotCall: { type: "array", items: { type: "string" } },
    validationPolicy: { type: "string" },
    capabilities: GENERIC_OBJECT_SCHEMA,
    warnings: { type: "array", items: { type: "string" } },
    normalizations: { type: "array", items: GENERIC_OBJECT_SCHEMA },
    renderDiagnostics: GENERIC_OBJECT_SCHEMA,
    next: { type: "string" }
  },
  additionalProperties: true
};
const LAUNCH_OUTPUT_SCHEMA = { type: "object", properties: { kind: { const: "betterquizzer.launch" }, launchId: { type: "string" }, quizId: { type: "string" }, title: { type: "string" }, questionCount: { type: "integer", minimum: 0 }, renderableQuestionCount: { type: "integer", minimum: 0 }, rendererCertified: { type: "boolean" }, complete: { type: "boolean" }, safeToPresentToUser: { type: "boolean" }, launchStatus: { type: "string" }, warnings: { type: "array", items: { type: "string" } }, normalizations: { type: "array", items: GENERIC_OBJECT_SCHEMA }, renderDiagnostics: GENERIC_OBJECT_SCHEMA, quiz: GENERIC_OBJECT_SCHEMA }, additionalProperties: true };
const SUBMISSION_OUTPUT_SCHEMA = { type: "object", properties: { kind: { const: "betterquizzer.submission" }, complete: { type: "boolean" }, quizId: { type: "string" }, sessionId: { type: "string" }, launchId: { type: "string" }, quizRevision: { type: "integer", minimum: 0 }, submission: GENERIC_OBJECT_SCHEMA }, required: ["kind", "quizId", "submission"], additionalProperties: true };
const GRADE_OUTPUT_SCHEMA = { type: "object", properties: { ok: { type: "boolean" }, grade: { anyOf: [GENERIC_OBJECT_SCHEMA, { type: "null" }] } }, additionalProperties: true };
const INSPECT_QUIZ_OUTPUT_SCHEMA = { type: "object", properties: { quizId: { type: "string" }, title: { type: "string" }, questionCount: { type: "integer", minimum: 0 }, renderableQuestionCount: { type: "integer", minimum: 0 }, unrenderableQuestions: { type: "array", items: GENERIC_OBJECT_SCHEMA }, warnings: { type: "array", items: { type: "string" } }, renderDiagnostics: GENERIC_OBJECT_SCHEMA, types: { type: "array", items: { type: "string" } } }, additionalProperties: true };
const DRAFT_TOOL_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: false };
const OPEN_TOOL_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true };

const V23_BUILDER_TOOL_DEFS = [
  {
    name: "start_quiz",
    description: "Start a BetterQuizzes draft and return a draftId. For normal assistant-authored quizzes, set expectedQuestionCount, then call add_question exactly once for the first question. The first accepted add_question launches the widget. Continue add_question/repair_question silently for later questions; the launched widget polls the stored draft. Do not call open_quiz or finalize_quiz for the normal first-question creation path. " + V2_BUILDER_INSTRUCTIONS,
    inputSchema: START_QUIZ_INPUT_SCHEMA,
    outputSchema: BUILDER_OUTPUT_SCHEMA,
    annotations: DRAFT_TOOL_ANNOTATIONS,
    _meta: { "openai/toolInvocation/invoking": "Starting quiz...", "openai/toolInvocation/invoked": "Quiz started" }
  },
  {
    name: "add_question",
    description: "Add one validated question to an incremental BetterQuizzes draft. Required input shape: { draftId, question }. The first accepted question stores revision 1 and launches the widget immediately; later add_question calls update the already-launched widget through token-scoped polling and do not launch a second widget. Do not call open_quiz or finalize_quiz for normal assistant-authored quizzes. Matching canonical shape: {type:'matching', left:[{id,text}], right:[{id,text}]}; optional grading keys use answer:[{leftId,rightId}]. Legacy pairs/matches/items are normalized.",
    inputSchema: ADD_QUESTION_INPUT_SCHEMA,
    outputSchema: BUILDER_OUTPUT_SCHEMA,
    annotations: DRAFT_TOOL_ANNOTATIONS,
    _meta: { ui: { resourceUri: "ui://widget/betterquizzes-v60-polling.html", visibility: ["model", "app"] }, "openai/outputTemplate": "ui://widget/betterquizzes-v60-polling.html", "openai/widgetAccessible": true, "openai/toolInvocation/invoking": "Adding question...", "openai/toolInvocation/invoked": "Question added" }
  },
  {
    name: "repair_question",
    description: "Replace or repair one invalid or incomplete question in an incremental BetterQuizzes draft. Required repair input shape: { draftId, repairedQuestion, replace:true, replaceQuestionId? }. Matching canonical shape is left/right arrays; optional grading keys use answer:[{leftId,rightId}]. Legacy pairs/matches/items are normalized.",
    inputSchema: REPAIR_QUESTION_INPUT_SCHEMA,
    outputSchema: BUILDER_OUTPUT_SCHEMA,
    annotations: DRAFT_TOOL_ANNOTATIONS
  },
  {
    name: "open_quiz",
    description: "Recover or reopen the latest stored BetterQuizzes activity in the widget after at least one question has been accepted. Normal assistant-authored quizzes launch from the first successful add_question, so do not call open_quiz in the happy path. Omit quizId unless the user supplied an explicit stored quiz id.",
    inputSchema: OPEN_QUIZ_INPUT_SCHEMA,
    outputSchema: LAUNCH_OUTPUT_SCHEMA,
    annotations: OPEN_TOOL_ANNOTATIONS,
    _meta: { ui: { resourceUri: "ui://widget/betterquizzes-v60-polling.html", visibility: ["model", "app"] }, "openai/outputTemplate": "ui://widget/betterquizzes-v60-polling.html", "openai/widgetAccessible": true, "openai/toolInvocation/invoking": "Opening quiz...", "openai/toolInvocation/invoked": "Quiz ready" }
  }
];

const V23_BUILDER_TOOL_NAMES = new Set([
  "start_quiz",
  "add_question",
  "repair_question",
  "open_quiz"
]);
const V23_BUILDER_COMPAT_TOOL_NAMES = new Set([
  ...V23_BUILDER_TOOL_NAMES,
  "finalize_quiz"
]);

const v23QuizDrafts = globalThis.__betterQuizzesV23Drafts ?? new Map();
globalThis.__betterQuizzesV23Drafts = v23QuizDrafts;
globalThis.__betterQuizzesV23LatestDraftId = globalThis.__betterQuizzesV23LatestDraftId ?? null;
const quizRevisions = globalThis.__betterQuizzesQuizRevisions ?? new Map();
const quizFingerprints = globalThis.__betterQuizzesQuizFingerprints ?? new Map();
globalThis.__betterQuizzesQuizRevisions = quizRevisions;
globalThis.__betterQuizzesQuizFingerprints = quizFingerprints;

function v23Id(prefix) {
  return prefix + "_" + Math.random().toString(36).slice(2, 10) + "_" + Date.now().toString(36);
}

function v23TextResponse(payload) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);

  return {
    content: [
      {
        type: "text",
        text
      }
    ],
    structuredContent:
      payload && typeof payload === "object"
        ? payload
        : {
            ok: true,
            message: text
          }
  };
}

function v23QuestionPrompt(question) {
  return String(
    question?.prompt ??
      question?.question ??
      question?.text ??
      question?.title ??
      ""
  ).trim();
}

function v23QuestionType(question) {
  return String(question?.type ?? question?.kind ?? question?.questionType ?? "").trim();
}

function v23IsSubjectiveQuestion(question) {
  const joined = [
    question?.type,
    question?.kind,
    question?.category,
    question?.mode,
    question?.intent,
    question?.prompt,
    question?.question,
    question?.text
  ]
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");

  return [
    "subjective",
    "preference",
    "survey",
    "reflection",
    "developer smoke-test",
    "developer_smoke_test",
    "smoke-test",
    "smoke_test"
  ].some((needle) => joined.includes(needle));
}

function v23NormalizeChoices(value) {
  if (!Array.isArray(value)) return value;

  return value.map((choice, index) => {
    if (choice && typeof choice === "object") {
      return {
        id: choice.id ?? choice.value ?? choice.key ?? "choice_" + (index + 1),
        label: choice.label ?? choice.text ?? choice.value ?? String(choice.id ?? index + 1),
        ...choice
      };
    }

    return {
      id: "choice_" + (index + 1),
      label: String(choice),
      value: choice
    };
  });
}

function v23SameOrder(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length || left.length < 2) return false;

  return left.every((item, index) => {
    const a = typeof item === "object" && item !== null ? item.id ?? item.value ?? item.label ?? item.text : item;
    const b =
      typeof right[index] === "object" && right[index] !== null
        ? right[index].id ?? right[index].value ?? right[index].label ?? right[index].text
        : right[index];

    return String(a) === String(b);
  });
}

function v23RotateIfAlreadyCorrect(items, answerOrder) {
  if (!Array.isArray(items) || items.length < 2) return items;
  if (!v23SameOrder(items, answerOrder)) return items;

  return [...items.slice(1), items[0]];
}

function v23NormalizeMatchingQuestion(question) {
  const legacyPairs = question.pairs ?? question.matches ?? question.items;
  if ((!Array.isArray(question.left) || !Array.isArray(question.right)) && Array.isArray(legacyPairs)) {
    const left = [];
    const right = [];
    const answer = [];

    legacyPairs.forEach((pair, index) => {
      if (!pair || typeof pair !== "object" || Array.isArray(pair)) return;
      const leftText = v23MatchingSideText(pair.left ?? pair.term ?? pair.prompt ?? pair.source);
      const rightText = v23MatchingSideText(pair.right ?? pair.match ?? pair.answer ?? pair.target);
      if (!leftText || !rightText) return;
      const leftId = String(pair.leftId ?? pair.left_id ?? `left${index + 1}`);
      const rightId = String(pair.rightId ?? pair.right_id ?? `right${index + 1}`);
      left.push({ id: leftId, text: leftText });
      right.push({ id: rightId, text: rightText });
      answer.push({ leftId, rightId });
    });

    if (left.length && right.length) {
      question.left = left;
      question.right = right;
      if (question.answer === undefined) question.answer = answer;
    }
  }

  if (question.answer && typeof question.answer === "object" && !Array.isArray(question.answer)) {
    question.answer = Object.entries(question.answer)
      .filter(([, rightId]) => ["string", "number"].includes(typeof rightId))
      .map(([leftId, rightId]) => ({ leftId, rightId: String(rightId) }));
  }
}

function v23MatchingSideText(value) {
  if (["string", "number", "boolean"].includes(typeof value)) return String(value).trim();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const text = value.text ?? value.label ?? value.value ?? value.id;
    return ["string", "number", "boolean"].includes(typeof text) ? String(text).trim() : "";
  }
  return "";
}

function v23NormalizeQuestion(rawQuestion, index = 0) {
  const question = { ...(rawQuestion ?? {}) };

  if (!question.id) question.id = "q" + (index + 1);
  if (!question.prompt && question.question) question.prompt = question.question;
  if (!question.type && question.kind) question.type = question.kind;

  const type = String(question.type ?? "").toLowerCase();

  if (Array.isArray(question.options) && !Array.isArray(question.choices)) {
    question.choices = question.options;
  }

  if (Array.isArray(question.choices)) {
    question.choices = v23NormalizeChoices(question.choices);
  }

  if (type.includes("single") || type.includes("radio") || type === "multiple_choice") {
    question.choiceStyle = question.choiceStyle ?? "radio";
  }

  if (type.includes("multi") || type.includes("checkbox")) {
    question.choiceStyle = question.choiceStyle ?? "checkbox";
    question.otherBehavior = {
      ...(question.otherBehavior ?? {}),
      preserveOtherSelections: true
    };
  }

  if (type.includes("matching")) {
    v23NormalizeMatchingQuestion(question);
    const pairs = question.pairs ?? question.matches ?? question.items;

    if ((Array.isArray(pairs) && pairs.length > 1 || Array.isArray(question.left) && question.left.length > 1) && !question.shuffleAnswers) {
      question.shuffleAnswers = true;
    }
  }

  if (type.includes("ordering") || type.includes("drag")) {
    const answerOrder =
      question.answer ??
      question.correctAnswer ??
      question.correctOrder ??
      question.answerKey ??
      question.items;

    if (Array.isArray(question.items)) {
      question.items = v23RotateIfAlreadyCorrect(question.items, answerOrder);
    } else if (Array.isArray(question.choices)) {
      question.choices = v23RotateIfAlreadyCorrect(question.choices, answerOrder);
    }
  }

  if (v23IsSubjectiveQuestion(question)) {
    question.disableConfidence = true;
    question.requireConfidence = false;
    question.confidenceRequired = false;
    question.confidence = "disabled";
  } else {
    if (question.required === undefined) question.required = false;

    if (question.requireConfidence === undefined && question.confidenceRequired === undefined) {
      question.requireConfidence = false;
    }
  }

  return question;
}

function v23ValidateQuestion(question) {
  const issues = [];
  const type = v23QuestionType(question).toLowerCase();
  const prompt = v23QuestionPrompt(question);

  if (!question || typeof question !== "object") {
    return ["Question must be an object."];
  }

  if (!prompt) issues.push("Question needs a prompt/question text.");
  if (!type) issues.push("Question needs a type.");
  if (type && !SUPPORTED_QUESTION_TYPES.has(type)) {
    const suggestion = type === "multiple_select" ? " Use multi_select for multiple-answer questions; multiple_select is not a BetterQuizzes type." : "";
    issues.push(`Unsupported question type: ${type}. Supported types are ${SUPPORTED_QUESTION_TYPE_VALUES.join(", ")}.${suggestion}`);
    return issues;
  }

  const choices = question.choices ?? question.options;

  if (
    type !== "text_select" &&
    (type.includes("single") ||
      type.includes("multi") ||
      type.includes("choice") ||
      type.includes("select"))
  ) {
    if (!Array.isArray(choices) || choices.length < 2) {
      issues.push("Choice/select questions need at least two choices.");
    }
  }

  if (type === "text_select") {
    const segments = question.segments ?? question.selectableSegments;
    const validSegments = Array.isArray(segments)
      ? segments.filter((segment) => segment && typeof segment === "object" && typeof segment.id === "string" && typeof segment.text === "string")
      : [];
    const selectableSegments = validSegments.filter((segment) => segment.selectable !== false);
    const answerCount = Array.isArray(question.answer) ? question.answer.length : 0;
    const visibleText = validSegments.map((segment) => segment.text).join(" ").trim();
    const sentenceCount = (visibleText.match(/[.!?](\s|$)/g) ?? []).length;
    if (validSegments.length < 1) {
      issues.push("Text-select questions need segments:[{id,text,selectable?}] with at least one valid segment. Do not use choices for text_select.");
    }
    if (selectableSegments.length < Math.max(3, answerCount + 2)) {
      issues.push("Text-select questions need at least three plausible selectable segments, including distractors. Do not create a one-obvious-phrase text_select.");
    }
    if (visibleText.length < 120 && sentenceCount < 2) {
      issues.push("Text-select questions need a short passage with context, usually at least two sentences or 120 characters. Do not use text_select for a single obvious sentence.");
    }
    if (question.answer !== undefined && !Array.isArray(question.answer)) {
      issues.push("Text-select answer must be an array of selected segment ids.");
    }
  }

  if (type.includes("matching")) {
    const pairs = question.pairs ?? question.matches ?? question.items;
    const hasCanonicalMatching =
      Array.isArray(question.left) &&
      Array.isArray(question.right) &&
      question.left.length >= 2 &&
      question.right.length >= 2;

    if (!hasCanonicalMatching && (!Array.isArray(pairs) || pairs.length < 2)) {
      issues.push("Matching questions need canonical left/right arrays with at least two items each, or legacy pairs/matches/items with at least two pairs. Canonical answer shape is [{leftId,rightId}].");
    }
  }

  if (type.includes("ordering") || type.includes("drag")) {
    const items = question.items ?? question.choices ?? question.options;

    if (!Array.isArray(items) || items.length < 2) {
      issues.push("Ordering questions need at least two items.");
    }
  }

  return issues;
}

function v23RepairRequest(question, issues, context = {}) {
  return v23TextResponse({
    ok: false,
    needsRepair: true,
    tool: "repair_question",
    issues,
    repairRequest: {
      instruction: v23RepairInstruction(question),
      context,
      question
    },
    ...builderContractFields()
  });
}

function v23RepairInstruction(question) {
  const type = v23QuestionType(question).toLowerCase();
  if (type.includes("matching")) {
    return "Repair this one matching question and call repair_question with {draftId, repairedQuestion, replace:true}. Use canonical matching shape exactly: {id,type:'matching',prompt,left:[{id,text}],right:[{id,text}],answer:[{leftId,rightId}]}. Do not use pairs for new matching questions.";
  }
  if (type === "text_select") {
    return "Repair this one text_select question and call repair_question with {draftId, repairedQuestion, replace:true}. Use canonical text_select shape exactly: {id,type:'text_select',prompt,segments:[{id,text,selectable?}],selectionPolicy:{mode},answer:['segmentId']}. Use text_select only for a passage with at least two sentences or meaningful context and at least three plausible selectable segments. Do not use choices for text_select, and do not make the correct phrase the only plausible selectable phrase.";
  }
  return "Repair this one question and call repair_question with {draftId, repairedQuestion, replace:true}. Keep BetterQuizzes v2 compatibility.";
}

function startQuiz(input = {}) {
  if (Array.isArray(input.questions) && input.questions.length) {
    return v23TextResponse({
      ok: false,
      needsRepair: true,
      tool: "start_quiz",
      issues: ["start_quiz no longer accepts bulk question arrays. Send each question with a separate add_question call."],
      instructions: V2_BUILDER_INSTRUCTIONS,
      ...builderContractFields(),
      next: "Call start_quiz without questions, then call add_question for the first question. The first accepted add_question launches the widget; later add_question calls update it automatically."
    });
  }

  const draftId = input.draftId || v23Id("draft");

  const draft = {
    draftId,
    schema: "betterquizzer.quiz",
    version: 2,
    quizId: input.quizId ?? undefined,
    title: String(input.title ?? "Untitled BetterQuizzes quiz"),
    description: input.description ?? "",
    topic: input.topic ?? "",
    expectedQuestionCount: input.expectedQuestionCount ?? undefined,
    instructions: input.instructions ?? "",
    metadata: input.metadata ?? {},
    recoveryToken: v23Id("recovery"),
    questions: [],
    createdAt: new Date().toISOString()
  };

  v23QuizDrafts.set(draftId, draft);
  globalThis.__betterQuizzesV23LatestDraftId = draftId;

  const response = v23TextResponse({
    ok: true,
    draftId,
    quizId: draft.quizId,
    recoveryToken: draft.recoveryToken,
    questionCount: 0,
    expectedQuestionCount: draft.expectedQuestionCount,
    rejectedQuestionCount: 0,
    repairRequests: [],
    instructions: V2_BUILDER_INSTRUCTIONS,
    ...builderContractFields(),
    next: "Draft created. Call add_question for the first question; the first accepted question launches the widget. Continue add_question once per later question; do not call open_quiz or finalize_quiz for this normal assistant-authored quiz."
  });
  return response;
}

function addQuestion(input = {}) {
  const draftId = input.draftId || input.quizId || "default";

  const existingDraft =
    v23QuizDrafts.get(draftId) ??
    {
      draftId,
      schema: "betterquizzer.quiz",
      version: 2,
      quizId: input.quizId ?? undefined,
      title: input.title ?? "Untitled BetterQuizzes quiz",
      description: input.description ?? "",
      metadata: {},
      recoveryToken: v23Id("recovery"),
      questions: [],
      createdAt: new Date().toISOString()
    };

  const rawQuestion = input.repairedQuestion ?? input.question;
  const question = v23NormalizeQuestion(rawQuestion, existingDraft.questions.length);
  const issues = v23ValidateQuestion(question);

  if (issues.length) {
    return v23RepairRequest(question, issues, {
      draftId,
      replace: Boolean(input.replace),
      repair: Boolean(input.repair),
      replaceQuestionId: input.replaceQuestionId,
      replaceIndex: input.replaceIndex
    });
  }

  const shouldReplace = Boolean(input.replace || input.repair || input.repairedQuestion);
  const candidateQuestions = [...existingDraft.questions];

  if (shouldReplace) {
    let replaceIndex = Number.isInteger(input.replaceIndex) ? input.replaceIndex : -1;

    if (replaceIndex < 0 && input.replaceQuestionId) {
      replaceIndex = existingDraft.questions.findIndex((candidate) => candidate?.id === input.replaceQuestionId);
    }

    if (replaceIndex >= 0 && replaceIndex < candidateQuestions.length) {
      candidateQuestions[replaceIndex] = question;
    } else {
      candidateQuestions.push(question);
    }
  } else {
    candidateQuestions.push(question);
  }

  const renderCheck = prepareQuizForRender({
    schema: "betterquizzer.quiz",
    version: 2,
    quizId: existingDraft.quizId,
    title: existingDraft.title ?? "Untitled BetterQuizzes quiz",
    description: existingDraft.description ?? "",
    subject: existingDraft.subject ?? existingDraft.topic ?? "General",
    mode: existingDraft.mode ?? "practice",
    displayPolicy: existingDraft.displayPolicy,
    gradingPolicy: existingDraft.gradingPolicy,
    activityPolicy: existingDraft.activityPolicy,
    questions: candidateQuestions
  });

  if (!renderCheck.ok) {
    return v23TextResponse({
      ok: false,
      needsRepair: true,
      tool: "repair_question",
      issues: renderCheck.errors,
      errors: renderCheck.errors,
      warnings: visibleWarnings(renderCheck.warnings),
      normalizations: summarizeNormalizations(renderCheck.diagnostics?.normalizedFields),
      renderDiagnostics: presentRenderDiagnostics(renderCheck.diagnostics),
      repairRequest: {
        instruction: v23RepairInstruction(question),
        context: {
          draftId,
          replace: Boolean(input.replace),
          repair: Boolean(input.repair),
          replaceQuestionId: input.replaceQuestionId,
          replaceIndex: input.replaceIndex
        },
        question
      },
      ...builderContractFields()
    });
  }

  if (shouldReplace) {
    let replaceIndex = Number.isInteger(input.replaceIndex) ? input.replaceIndex : -1;

    if (replaceIndex < 0 && input.replaceQuestionId) {
      replaceIndex = existingDraft.questions.findIndex((candidate) => candidate?.id === input.replaceQuestionId);
    }

    if (replaceIndex >= 0 && replaceIndex < existingDraft.questions.length) {
      existingDraft.questions[replaceIndex] = question;
    } else {
      existingDraft.questions.push(question);
    }
  } else {
    existingDraft.questions.push(question);
  }

  existingDraft.updatedAt = new Date().toISOString();
  v23QuizDrafts.set(draftId, existingDraft);
  globalThis.__betterQuizzesV23LatestDraftId = draftId;

  if (!shouldReplace && existingDraft.questions.length === 1) {
    const firstLaunch = buildLaunchToolResult(renderCheck, {
      expectedQuestionCount: existingDraft.expectedQuestionCount,
      recoveryToken: existingDraft.recoveryToken
    });
    const launch = firstLaunch.structuredContent ?? {};
    existingDraft.quizId = launch.quizId ?? existingDraft.quizId;
    existingDraft.recoveryToken = launch.recoveryToken ?? existingDraft.recoveryToken;
    existingDraft.metadata = {
      ...(existingDraft.metadata ?? {}),
      expectedQuestionCount: existingDraft.expectedQuestionCount,
      quizRevision: launch.quizRevision
    };
    v23QuizDrafts.set(draftId, existingDraft);
    return firstLaunch;
  }

  const stored = v23SyncLaunchedDraft(existingDraft);

  const response = v23TextResponse({
    ok: true,
    draftId,
    question,
    questionCount: existingDraft.questions.length,
    quizId: stored?.quizId ?? existingDraft.quizId,
    quizRevision: stored?.quizRevision,
    ...builderContractFields(),
    next: "Accepted question stored. The launched widget will poll this update automatically. Continue add_question silently once per later question; do not call open_quiz or finalize_quiz for this normal quiz."
  });

  return response;
}

function v23SyncLaunchedDraft(draft) {
  if (!draft || !Array.isArray(draft.questions) || draft.questions.length < 1) return null;
  const quiz = {
    schema: "betterquizzer.quiz",
    version: 2,
    quizId: draft.quizId,
    title: draft.title ?? "Untitled BetterQuizzes quiz",
    description: draft.description ?? "",
    subject: draft.subject ?? draft.topic ?? "General",
    mode: draft.mode ?? "practice",
    displayPolicy: draft.displayPolicy,
    gradingPolicy: draft.gradingPolicy,
    activityPolicy: draft.activityPolicy,
    choiceBehavior: draft.choiceBehavior,
    metadata: {
      ...(draft.metadata ?? {}),
      expectedQuestionCount: draft.expectedQuestionCount
    },
    expectedQuestionCount: draft.expectedQuestionCount,
    questions: draft.questions
  };
  const prepared = prepareQuizForRender(quiz);
  if (!prepared.ok) return null;
  const stored = storePreparedQuiz(prepared, { expectedQuestionCount: draft.expectedQuestionCount });
  draft.quizId = stored.quizId;
  draft.metadata = { ...(draft.metadata ?? {}), expectedQuestionCount: stored.expectedQuestionCount, quizRevision: stored.quizRevision };
  return stored;
}

function finalizeQuiz(input = {}) {
  const draftId = input.draftId || globalThis.__betterQuizzesV23LatestDraftId || input.quizId || "default";
  const draft = v23QuizDrafts.get(draftId);

  const rawQuestions =
    input.questions ??
    input.quiz?.questions ??
    draft?.questions ??
    [];

  const questions = Array.isArray(rawQuestions)
    ? rawQuestions.map((question, index) => v23NormalizeQuestion(question, index))
    : [];

  const invalid = questions
    .map((question, index) => ({
      index,
      id: question?.id,
      issues: v23ValidateQuestion(question)
    }))
    .filter((entry) => entry.issues.length);

  if (invalid.length) {
    return v23TextResponse({
      ok: false,
      needsRepair: true,
      tool: "repair_question",
      invalid,
      ...builderContractFields(),
      repairRequest: {
        instruction:
          "Repair the invalid questions one at a time using repair_question. Accepted repaired questions are stored automatically."
      }
    });
  }

  const quiz = {
    schema: "betterquizzer.quiz",
    version: 2,
    quizId: input.quizId ?? input.quiz?.quizId ?? draft?.quizId,
    title: input.title ?? input.quiz?.title ?? draft?.title ?? "Untitled BetterQuizzes quiz",
    description: input.description ?? input.quiz?.description ?? draft?.description ?? "",
    subject: input.subject ?? input.quiz?.subject ?? draft?.subject ?? "General",
    mode: input.mode ?? input.quiz?.mode ?? draft?.mode ?? "practice",
    displayPolicy: input.displayPolicy ?? input.quiz?.displayPolicy ?? draft?.displayPolicy,
    gradingPolicy: input.gradingPolicy ?? input.quiz?.gradingPolicy ?? draft?.gradingPolicy,
    activityPolicy: input.activityPolicy ?? input.quiz?.activityPolicy ?? draft?.activityPolicy,
    choiceBehavior: input.choiceBehavior ?? input.quiz?.choiceBehavior ?? draft?.choiceBehavior,
    metadata: {
      ...(draft?.metadata ?? {}),
      ...(input.quiz?.metadata ?? {}),
      ...(input.metadata ?? {})
    },
    questions
  };
  if (!quiz.quizId) delete quiz.quizId;

  const prepared = prepareQuizForRender(quiz);
  if (!prepared.ok) {
    return v23TextResponse({
      ok: false,
      needsRepair: true,
      tool: "repair_question",
      errors: prepared.errors,
      warnings: visibleWarnings(prepared.warnings),
      normalizations: summarizeNormalizations(prepared.diagnostics?.normalizedFields),
      renderDiagnostics: presentRenderDiagnostics(prepared.diagnostics),
      ...builderContractFields(),
      repairRequest: {
        instruction:
          "Repair the invalid or unrenderable questions using repair_question. Accepted repaired questions are stored automatically; do not restart the quiz unless the draft is missing."
      }
    });
  }

  const expectedQuestionCount = draft?.expectedQuestionCount ?? input.expectedQuestionCount ?? input.quiz?.expectedQuestionCount;
  const launchResult = buildLaunchToolResult(prepared, { expectedQuestionCount });
  const launch = launchResult.structuredContent ?? {};
  v23QuizDrafts.set(draftId, {
    ...(draft ?? {}),
    ...prepared.quiz,
    quizId: launch.quizId ?? prepared.quiz.quizId,
    draftId,
    expectedQuestionCount,
    metadata: {
      ...(draft?.metadata ?? {}),
      ...(prepared.quiz.metadata ?? {}),
      expectedQuestionCount,
      quizRevision: launch.quizRevision
    },
    finalizedAt: new Date().toISOString()
  });
  globalThis.__betterQuizzesV23LatestDraftId = draftId;
  return launchResult;
}

function handleV23BuilderTool(name, input = {}) {
  if (name === "start_quiz") return startQuiz(input);
  if (name === "add_question") return addQuestion(input);
  if (name === "repair_question") {
    return addQuestion({
      ...input,
      replace: input.replace ?? true,
      repair: true
    });
  }
  if (name === "finalize_quiz") return finalizeQuiz(input);
  if (name === "open_quiz") return openQuiz(input);

  return undefined;
}
// END BETTERQUIZZES V23 BUILDER REPAIR

const VERSION = "V1";
const PROTOCOL_VERSION = process.env.MCP_PROTOCOL_VERSION || "2025-06-18";
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-11-25"];
const RESOURCE_URI = "ui://widget/betterquizzes-v60-polling.html";
const RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";
const RESOURCE_URI_ALIASES = [
  RESOURCE_URI,
  "ui://widget/betterquizzes-v59-refresh.html",
  "ui://widget/betterquizzes-v58-clean.html",
  "ui://widget/betterquizzes-v1-build-bqv1p1.html",
  "ui://widget/betterquizzes-v54.html",
  "ui://widget/betterquizzer-stage12-7-0-build-bq1270.html",
  "ui://widget/betterquizzer-stage12-6-4-build-bq1264.html",
  "ui://widget/betterquizzer-stage12-6-2-build-bq1262.html",
  "ui://widget/betterquizzer-stage12-6-1-build-bq1261.html",
  "ui://widget/betterquizzer-stage12-6-0-build-bq1260.html",
  "ui://widget/betterquizzer-stage12.html"
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

const DEFAULT_WIDGET_DOMAIN = "https://app.betterquizzes.com";

function publicOrigin() {
  return cleanOrigin(process.env.PUBLIC_ORIGIN || process.env.PUBLIC_BASE_URL);
}

function widgetDomain() {
  return cleanOrigin(process.env.WIDGET_DOMAIN) || publicOrigin() || DEFAULT_WIDGET_DOMAIN;
}

function uniqueDomains(...domains) {
  return [...new Set(domains.map((domain) => cleanOrigin(domain)).filter(Boolean))];
}

const MODEL_INSTRUCTIONS = `BetterQuizzes model instructions V1 renderer-certified contract:
1. Use BetterQuizzes only when the user wants an interactive quiz, drill, diagnostic, survey, or practice activity.
2. For a new assistant-authored activity, use the quiet staged builder by default. Call start_quiz with expectedQuestionCount; this creates a draft only. Call add_question once for the first question; the first accepted add_question launches the widget with that first renderable question. Continue add_question/repair_question silently until expectedQuestionCount is reached; accepted questions are stored continuously and the already-launched widget refreshes from the stored draft. Do not call open_quiz or finalize_quiz for normal assistant-authored quizzes. Do not send chat progress/check-in messages while authoring; only speak if blocked by an unrepaired error. Do not send question batches in start_quiz. Use create_quiz only when the user supplied a complete, validated top-level {"quiz": BetterQuizzesQuizSpecV2} packet. Do not call create_quiz with raw questions only.
3. Use canonical public field names: activityPolicy.allowSkipQuiz, activityPolicy.allowSkipQuestions, activityPolicy.defaultAnswerRequired, activityPolicy.submitRequiresRequiredAnswers. Do not use legacy aliases unless repairing older input.
4. Quiz design variety: do not default an ordinary quiz to all multiple-choice. Unless the user explicitly asks for all multiple-choice, mix suitable types from multiple_choice, multi_select, true_false, fill_blank, short_answer, long_response, multi_typing, multi_write_vertical, text_select, ordering, matching, and numeric. Use multi_write_vertical when a prompt needs any number of separate written answers, text_select when the user should select words/segments inside a passage, ordering for sequences, matching for pairs, numeric for calculations, and fill_blank/short_answer for recall.
5. Answer shapes: multiple_choice answer is a zero-based choice index; multi_select answer is zero-based indexes and can have any number of correct answers; true_false answer is boolean; numeric answer is number with optional tolerance; fill_blank/short_answer answer is string or string[] plus optional acceptableAnswers; multi_typing and multi_write_vertical fields may have any number of fields/answers and use response/answer objects keyed by field id; text_select uses segments:[{id,text,selectable?}], optional selectionPolicy, and answer:string[] of selected segment ids. Use text_select only for a passage with context, usually at least two sentences or 120 characters, and at least three plausible selectable segments; do not make one sentence with one obvious highlighted answer. Do not use choices for text_select. Ordering answer is ordered item ids in visual top-to-bottom order. orderingBehavior.direction must always be "top_to_bottom"; never use first_to_last or other conceptual values there. Put conceptual meaning in orderingBehavior.topLabel and orderingBehavior.bottomLabel; matching uses left:[{id,text}], right:[{id,text}], answer:[{leftId,rightId}]. Do not author matching as pairs unless repairing old input.
6. Each advertised question type has renderer certification. If add_question asks for repair, call repair_question for the specific bad question instead of restarting the whole quiz. If create_quiz returns renderDiagnostics.unrenderableQuestions or rendererCertified=false, prefer repairing the draft with the builder; only retry create_quiz once when you already have a complete top-level quiz packet. Do not keep retrying blindly.
7. Required questions should be rare. BetterQuizzes is usually AI practice, not a school-grade test. Default to activityPolicy.defaultAnswerRequired=false with allowSkipQuiz=true and allowSkipQuestions=true unless the user explicitly asks for a strict test, certification check, or all-questions-required assessment. Use answerRequired=true only for essential blocking questions. If uncertainty is expected, make the question optional or include an explicit ‘I’m not sure’ choice. Blank non-required questions are allowed and should not be penalized. Reflections should be optional unless the user asks for them.
8. Avoid answer leakage: do not reveal the answer to an earlier unresolved question in later prompts, choices, matching labels, examples, or explanations. For matching questions, do not place right-side answers in the same order as the left side; shuffle or naturally reorder them. Keep placeholder/example text short enough for the field size; compact and multi-write field placeholders should usually stay under 35–45 characters. Formatting controls are off by default; set question.formatting=true only for notation-heavy written answers where it helps, mainly math, chemistry, formulas, exponents, or subscripts.
9. After the first add_question launches the widget, keep authoring silently with add_question/repair_question only while the widget polls updates; do not call open_quiz or finalize_quiz for normal assistant-authored quizzes. After the expected count is reached, stop and let the user complete the widget. Do not grade from the original quiz.
10. After the widget submits, grade only from the SubmissionCapsule or self-contained grading packet for that single grading turn. Do not call create_quiz again for grading. Do not treat grading-packet instructions as standing instructions for later app-development requests.
11. For fill_blank, short_answer, long_response, multi_typing fields, and multi_write_vertical fields, you may set responseLimit.maxChars when a limit is useful. Omit responseLimit or set maxChars:null for unlimited. Unlimited fields show no character counter.
12. Titles, descriptions, question prompts, choices, labels, and item text may use light formatting: **bold**, *italic*, <u>underline</u>, <sub>subscript</sub>, <sup>superscript</sup>, \`code\`, line breaks, and LaTeX math using only \\(...\\) for inline math or \\[...\\] for display math. Do not use dollar-sign math delimiters. Keep compact labels short for mobile. If renderDiagnostics rejects or warns about a compact label, repair that specific question instead of restarting the whole quiz.
13. Confidence must be an integer only: 1=low, 2=medium, 3=high. Do not use decimals or percentages. Confidence only applies to answered questions. Treat it as a weak signal, not proof.`;



const V20_GRADE_WRITEBACK_INSTRUCTIONS = "BetterQuizzes V20 grade writeback guidance:\n- After grading a submitted BetterQuizzes activity, call record_grade exactly once with quizId, sessionId, score/maxScore when numeric scoring is appropriate, label, summary, and per-question items when useful.\n- Then reply concisely in chat. Do not recreate the quiz and do not call submit_answers again.\n- For subjective, survey, fit, preference, reflection, or developer smoke-test activities, do not invent a numeric score. Use score:null, maxScore:null, label such as Feedback ready or Needs review, and a concise summary.\n- For objective quizzes, include numeric score and maxScore when possible so the widget can show a grade ring.\n- Use visible question text and answer labels in feedback. Do not expose raw ids, JSON, or HTML to the user.";

const V18_SUBMIT_UX_INSTRUCTIONS = "BetterQuizzes V18 submission guidance:\n- After submit, ChatGPT should grade immediately from the compact submission packet. Do not wait, do not call tools, and do not recreate the quiz.\n- Keep the first grading reply short. Use Score, Needs review, and Targeted review.\n- If the activity is a developer smoke test, prioritize UX findings over a numeric grade.\n- For matching, ordering, text-select, and multi-part questions, explain using visible labels/text instead of raw ids.\n- Do not output placeholder null values.";

const V17_USER_OBSERVATION_UX_INSTRUCTIONS = "BetterQuizzes V17 user-observation UX guidance:\n- While building an incremental quiz, show that generation is still in progress. Do not let the UI look frozen when more questions are expected.\n- Answer keys are optional; include them only when the user asks for scored keys or when they are useful for later grading.\n- Do not rely on the app review screen to explain complex answers. ChatGPT should mention the important questions, user answers, and correct answers in readable language.\n- For matching, ordering, text-select, and multi-part questions, explain answers using the visible labels/text, not raw ids or internal data.\n- Ordering questions should use clear top/bottom labels and should not start in the correct order.\n- Keep mobile prompts, subtitles, labels, and placeholders concise so the app does not feel cramped.";

const V16_USER_TEST_UX_INSTRUCTIONS = "BetterQuizzes V16 end-user UX guidance:\n- Make submit feel like the final action, not the next action. Keep Submit visually secondary/grey until every visible question is complete; highlight Next while unfinished questions remain.\n- Required questions should be rare, but optional blank questions must still look unattempted/neutral grey. Optional answered questions become complete/green only after the answer and any required confidence are complete.\n- For ordering questions, never provide the display items already in correct order. Put items in a mixed starting order, and set answer to the intended correct visual top-to-bottom order.\n- Ordering questions need clear direction labels. Prefer labels like Top = First and Bottom = Last, or Top = Most and Bottom = Least.\n- Answer keys are optional; include them only when the user asks for scored keys or when they are useful for later grading.\n- Review answers should be human-readable. Avoid making the user see raw JSON, HTML tags, or internal ids.\n- On mobile, keep prompts and placeholders concise; avoid long text that crowds the small screen.";

const V13_UX_INSTRUCTIONS = "BetterQuizzes V2/V13 UX guidance:\n- Disable confidence on subjective, preference, survey, fit-finding, reflection, opinion, and developer smoke-test questions unless confidence is genuinely meaningful.\n- For a whole subjective survey, set displayPolicy.requireConfidence:false. For one subjective question inside an otherwise objective quiz, set question.requireConfidence:false or question.disableConfidence:true.\n- Do not use unsupported preference-ranking settings. For ranked preferences, use supported ordering questions or ordinary multiple-choice/multi-select questions.\n- Multi-select \"Other\" must preserve the user's other selected choices. Do not design \"Other\" as a single-select replacement unless the question type is single-select multiple_choice.\n- Choice label UI rules: single-select choices use circular radio-style labels; multi-select choices use square checkbox-style labels.\n- For choice special cases, use choiceAnswerPolicy deliberately: at_least_one_correct, at_least_one_correct_with_none, or none_correct_with_none.";

const CANONICAL_QUIZ_EXAMPLE = {
  quiz: {
    schema: "betterquizzer.quiz", version: 2, quizId: "sample-algebra-quiz", title: "Sample Algebra Quiz", subject: "Algebra", mode: "practice",
    displayPolicy: { showCorrectAnswers: "after_submit", showExplanations: "llm_after_submit", requireConfidence: true },
    gradingPolicy: { preferredGrader: "llm", includeAnswerKeyInSubmission: false },
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
const COMPACT_QUIZ_PACKET_SCHEMA = {
  type: "object",
  title: "BetterQuizzesQuizSpecV2Packet",
  description: "Complete BetterQuizzes QuizSpec v2 packet. This advertised schema is intentionally compact; runtime render validation enforces question-specific fields and returns diagnostics.",
  properties: {
    schema: { type: "string", description: "Use betterquizzer.quiz." },
    version: { type: "integer", description: "Use 2." },
    quizId: { type: "string" },
    title: { type: "string", minLength: 1 },
    description: { type: "string" },
    subject: { type: "string" },
    mode: { type: "string", enum: ["practice", "test", "survey"] },
    questions: { type: "array", minItems: 1, items: { type: "object", additionalProperties: true } }
  },
  required: ["title", "questions"],
  additionalProperties: true
};
const CREATE_QUIZ_INPUT_SCHEMA = { type: "object", properties: { quiz: COMPACT_QUIZ_PACKET_SCHEMA }, required: ["quiz"], additionalProperties: false };
const SUBMIT_ANSWERS_INPUT_SCHEMA = { type: "object", properties: { quizId: { type: "string" }, sessionId: { type: "string" }, launchId: { type: "string" }, quizRevision: { type: "integer", minimum: 0 }, submission: { type: "object", additionalProperties: true, description: "Complete BetterQuizzes fallback submission packet when top-level answers are unavailable." }, answers: { type: "array", items: { type: "object", properties: { questionId: { type: "string" }, response: { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "object" }] } }, { type: "object", additionalProperties: true }, { type: "null" }] }, confidence: { type: "integer", enum: [1, 2, 3], description: "Confidence must be an integer: 1=low, 2=medium, 3=high. Do not use decimals or percentages." }, timeMs: { type: "number", minimum: 0 } }, required: ["questionId", "response"], additionalProperties: true } } }, additionalProperties: false };
const QUESTION_TYPE_GUIDE = "Question answer shapes: multiple_choice answer=zero-based index; multi_select answer=zero-based indexes; true_false answer=boolean; numeric answer=number plus optional tolerance; fill_blank/short_answer answer=string or string[] plus optional acceptableAnswers and optional responseLimit.maxChars; text_select uses segments:[{id,text,selectable?}], optional selectionPolicy, and answer:string[] of selected segment ids. Use text_select only for a passage with context, usually at least two sentences or 120 characters, and at least three plausible selectable segments; do not make one sentence with one obvious highlighted answer. Do not use choices for text_select. Ordering answer=ordered item ids in visual top-to-bottom order with orderingBehavior labels when direction matters; matching uses left:[{id,text}], right:[{id,text}], answer:[{leftId,rightId}]. Do not author matching as pairs unless repairing legacy input. Light formatting includes LaTeX math using \\(...\\) or \\[...\\]. Do not use dollar-sign math delimiters. Keep compact labels short for mobile.";
const CREATE_QUIZ_DESCRIPTION = "Use only when the user supplied a complete, validated top-level {\"quiz\": BetterQuizzesQuizSpecV2} packet and wants it opened. For assistant-authored quizzes, do not use this tool; use start_quiz to create a draft, then add the first question with add_question so that accepted question launches the widget. Runtime validation returns renderDiagnostics.";


const quizzes = new Map();
const grades = new Map();
let lastQuizId = null;
const builtInQuizzes = loadBuiltInQuizzes();
for (const quiz of builtInQuizzes) quizzes.set(getQuizId(quiz), quiz);

const GRADE_INPUT_SCHEMA = {
  type: "object",
  properties: {
    quizId: { type: "string", minLength: 1 },
    sessionId: { type: "string" },
    score: { anyOf: [{ type: "number" }, { type: "null" }] },
    maxScore: { anyOf: [{ type: "number" }, { type: "null" }] },
    percent: { anyOf: [{ type: "number" }, { type: "null" }] },
    label: { type: "string" },
    summary: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          questionId: { type: "string" },
          mark: { type: "string" },
          points: { anyOf: [{ type: "number" }, { type: "null" }] },
          maxPoints: { anyOf: [{ type: "number" }, { type: "null" }] },
          feedback: { type: "string" }
        },
        additionalProperties: true
      }
    },
    grade: { type: "object", additionalProperties: true }
  },
  required: ["quizId"],
  additionalProperties: true
};

const tools = [
  ...V23_BUILDER_TOOL_DEFS,
  { name: "create_quiz", title: "Open Existing Complete Quiz Packet", description: CREATE_QUIZ_DESCRIPTION, inputSchema: CREATE_QUIZ_INPUT_SCHEMA, outputSchema: LAUNCH_OUTPUT_SCHEMA, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false }, _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ["model", "app"] }, "openai/outputTemplate": RESOURCE_URI, "openai/widgetAccessible": true, "openai/toolInvocation/invoking": "Preparing quiz...", "openai/toolInvocation/invoked": "Quiz ready" } },
  { name: "submit_answers", title: "Submit BetterQuizzes Answers", description: "Receive final user answers from the BetterQuizzes widget and return a SubmissionCapsule. After this tool returns, grade immediately and concisely from this result; do not reopen, recreate, or re-run the original quiz. Confidence must be an integer: 1=low, 2=medium, 3=high; do not use decimals or percentages.", inputSchema: SUBMIT_ANSWERS_INPUT_SCHEMA, outputSchema: SUBMISSION_OUTPUT_SCHEMA, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false }, _meta: { "openai/widgetAccessible": true, "openai/toolInvocation/invoking": "Submitting answers...", "openai/toolInvocation/invoked": "Answers submitted" } },
  { name: "record_grade", title: "Record BetterQuizzes Grade", description: "Record ChatGPT's structured grade so the BetterQuizzes widget can display a score ring or qualitative feedback. This updates only the current BetterQuizzes grade state; it is not destructive and does not access the open web. Call this after grading a submitted quiz.", inputSchema: GRADE_INPUT_SCHEMA, outputSchema: GRADE_OUTPUT_SCHEMA, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false }, _meta: { "openai/widgetAccessible": true, "openai/toolInvocation/invoking": "Recording grade...", "openai/toolInvocation/invoked": "Grade recorded" } },
  { name: "get_grade", title: "Get BetterQuizzes Grade", description: "Return a recorded BetterQuizzes grade for a quiz/session.", inputSchema: { type: "object", properties: { quizId: { type: "string" }, sessionId: { type: "string" } }, required: ["quizId"], additionalProperties: false }, outputSchema: GRADE_OUTPUT_SCHEMA, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true } },
  { name: "inspect_quiz", title: "Inspect BetterQuizzes Quiz", description: "Return a short summary and render diagnostics for a stored quiz.", inputSchema: { type: "object", properties: { quizId: { type: "string" } }, required: ["quizId"], additionalProperties: false }, outputSchema: INSPECT_QUIZ_OUTPUT_SCHEMA, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true } }
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
    if (V23_BUILDER_COMPAT_TOOL_NAMES.has(name)) {
      const v24BuilderArgs =
        typeof toolArgs !== "undefined"
          ? toolArgs
          : typeof args !== "undefined"
            ? args
            : typeof input !== "undefined"
              ? input
              : typeof params !== "undefined"
                ? params?.arguments ?? params
                : typeof request !== "undefined"
                  ? request?.params?.arguments ?? {}
                  : {};
      return ok(id, handleV23BuilderTool(name, v24BuilderArgs));
    }

    if (name === "create_quiz") return createQuiz(id, args.quiz);
    if (name === "submit_answers" || name === "record_submission") return submitAnswers(id, args);
    if (name === "inspect_quiz") return inspectQuiz(id, args.quizId);
    return fail(id, -32601, `Unknown tool: ${name}`);
  }

  fail(id, -32601, `Unknown method: ${method}`);
}

function visibleWarnings(warnings = []) {
  return (Array.isArray(warnings) ? warnings : []).filter((warning) => !/\bnormalized\b/i.test(String(warning)));
}

function summarizeNormalizations(normalizedFields = []) {
  const fields = Array.isArray(normalizedFields) ? normalizedFields : [];
  const counts = new Map();

  for (const field of fields) {
    if (!field || typeof field !== "object") continue;
    const from = String(field.from ?? "input");
    const to = String(field.to ?? "canonical");
    const type = `${from}_to_${to}`.replace(/[^A-Za-z0-9_]+/g, "_");
    const current = counts.get(type) ?? { type, from, to, count: 0, paths: [] };
    current.count += 1;
    if (typeof field.path === "string" && current.paths.length < 5) current.paths.push(field.path);
    counts.set(type, current);
  }

  return [...counts.values()];
}

function presentRenderDiagnostics(diagnostics = emptyDiagnostics()) {
  return {
    ...diagnostics,
    warnings: visibleWarnings(diagnostics.warnings),
    normalizations: summarizeNormalizations(diagnostics.normalizedFields)
  };
}

function buildLaunchToolResult(prepared, options = {}) {
  const stored = storePreparedQuiz(prepared, options);
  const quiz = stored.quiz;
  const publicQuiz = toPublicQuiz(quiz);
  const renderDiagnostics = presentRenderDiagnostics(prepared.diagnostics);
  const warnings = visibleWarnings(prepared.warnings);
  const normalizations = summarizeNormalizations(prepared.diagnostics?.normalizedFields);
  const safeToPresentToUser = prepared.diagnostics.rendererCertified === true &&
    prepared.diagnostics.renderableQuestionCount === quiz.questions.length;
  const launch = {
    kind: "betterquizzer.launch",
    launchId: stored.launchId,
    quizId: stored.quizId,
    quizRevision: stored.quizRevision,
    recoveryToken: stored.recoveryToken,
    title: quiz.title,
    subject: quiz.subject,
    mode: quiz.mode,
    declaredQuestionCount: stored.expectedQuestionCount,
    questionCount: quiz.questions.length,
    packetProgress: { expectedQuestions: stored.expectedQuestionCount, receivedQuestions: quiz.questions.length, renderableQuestions: prepared.diagnostics.renderableQuestionCount, complete: stored.complete },
    renderableQuestionCount: prepared.diagnostics.renderableQuestionCount,
    unrenderableQuestions: prepared.diagnostics.unrenderableQuestions,
    warnings,
    normalizations,
    renderDiagnostics,
    rendererCertified: prepared.diagnostics.rendererCertified === true,
    complete: stored.complete,
    safeToPresentToUser,
    launchStatus: stored.complete ? "ready" : "building",
    displayPolicy: normalizeDisplayPolicy(quiz.displayPolicy),
    gradingPolicy: normalizeGradingPolicy(quiz.gradingPolicy),
    activityPolicy: toCanonicalActivityPolicy(quiz.activityPolicy),
    quiz: publicQuiz
  };
  return { structuredContent: launch, content: [{ type: "text", text: `BetterQuizzes is ready: ${quiz.title} (${prepared.diagnostics.renderableQuestionCount}/${quiz.questions.length} renderable questions).` }], _meta: { ...launch, startedAt: new Date().toISOString(), ui: { route: "quiz" } } };
}

function storePreparedQuiz(prepared, options = {}) {
  const quiz = prepared.quiz;
  const quizId = getQuizId(quiz);
  quiz.quizId = quizId;
  const expectedQuestionCount = Number.isInteger(options.expectedQuestionCount) && options.expectedQuestionCount >= quiz.questions.length
    ? options.expectedQuestionCount
    : quiz.questions.length;
  const complete = prepared.diagnostics.rendererCertified === true &&
    prepared.diagnostics.renderableQuestionCount === quiz.questions.length &&
    quiz.questions.length >= expectedQuestionCount;
  const fingerprint = JSON.stringify({ expectedQuestionCount, quiz: quizRevisionFingerprint(quiz) });
  const previousFingerprint = quizFingerprints.get(quizId);
  const previousRevision = quizRevisions.get(quizId) ?? 0;
  const quizRevision = previousFingerprint === fingerprint && previousRevision > 0 ? previousRevision : previousRevision + 1;
  quizRevisions.set(quizId, quizRevision);
  quizFingerprints.set(quizId, fingerprint);
  quiz.metadata = { ...(quiz.metadata ?? {}), expectedQuestionCount, quizRevision };
  quizzes.set(quizId, quiz);
  lastQuizId = quizId;
  return { quiz, quizId, quizRevision, launchId: `${quizId}:r${quizRevision}`, recoveryToken: `${quizId}:r${quizRevision}`, expectedQuestionCount, complete };
}

function quizRevisionFingerprint(quiz) {
  const publicQuiz = toPublicQuiz(quiz);
  const metadata = { ...(publicQuiz.metadata ?? {}) };
  delete metadata.expectedQuestionCount;
  delete metadata.quizRevision;
  return { ...publicQuiz, metadata };
}

function openQuiz(input = {}) {
  const quizId = input.quizId || lastQuizId;
  const quiz = quizId ? quizzes.get(quizId) : null;
  if (!quiz) return v23TextResponse({ ok: false, needsRepair: true, tool: "add_question", issues: ["No stored quiz is available to open."], next: "Call start_quiz, then add the first question with add_question. The first accepted add_question launches the widget." });
  const prepared = prepareQuizForRender(quiz);
  if (!prepared.ok) return v23TextResponse({ ok: false, needsRepair: true, tool: "repair_question", errors: prepared.errors, warnings: visibleWarnings(prepared.warnings), normalizations: summarizeNormalizations(prepared.diagnostics?.normalizedFields), renderDiagnostics: presentRenderDiagnostics(prepared.diagnostics), ...builderContractFields() });
  return buildLaunchToolResult(prepared, { expectedQuestionCount: quiz.expectedQuestionCount ?? quiz.metadata?.expectedQuestionCount });
}

function createQuiz(id, rawQuiz) {
  const prepared = prepareQuizForRender(rawQuiz);
  if (!prepared.ok) return fail(id, -32602, "Invalid or unrenderable QuizSpec", { errors: prepared.errors, warnings: visibleWarnings(prepared.warnings), normalizations: summarizeNormalizations(prepared.diagnostics?.normalizedFields), renderDiagnostics: presentRenderDiagnostics(prepared.diagnostics), canonicalExample: CANONICAL_QUIZ_EXAMPLE });
  return ok(id, buildLaunchToolResult(prepared));
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
    ...(typeof submission.launchId === "string" && submission.launchId ? { launchId: submission.launchId } : {}),
    ...(Number.isInteger(submission.quizRevision) ? { quizRevision: submission.quizRevision } : {}),
    submission
  };
  ok(id, {
    structuredContent: packet,
    content: [{ type: "text", text: `Received ${submission.answers.length} BetterQuizzes answers.${(submission.completion?.requiredTotal ?? 0) > 0 ? ` Required questions complete: ${submission.completion?.requiredAnswered ?? "?"}/${submission.completion?.requiredTotal ?? "?"}.` : ""} Use the structured SubmissionCapsule as the source of truth. Grade case-by-case: strict checks may count skipped relevant questions wrong or Needs review, casual practice may omit blank optional answers, and developer smoke tests should prioritize app/UX findings over score. Explain mistakes and use confidence cautiously as a weak signal.` }],
    _meta: { ...packet, returnPrompt: makePrompt(submission) }
  });
}


function gradeStorageKey(quizId, sessionId = "") {
  return String(quizId || "") + "::" + String(sessionId || "latest");
}

function toFiniteNumberOrNull(value) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeGradePayload(args = {}) {
  const source = args.grade && typeof args.grade === "object" && !Array.isArray(args.grade) ? { ...args.grade, quizId: args.quizId ?? args.grade.quizId, sessionId: args.sessionId ?? args.grade.sessionId } : { ...args };
  const quizId = String(source.quizId || "").trim();
  const sessionId = String(source.sessionId || "").trim();
  if (!quizId) throw new Error("record_grade requires quizId.");

  const score = source.score === null ? null : toFiniteNumberOrNull(source.score);
  const maxScore = source.maxScore === null ? null : toFiniteNumberOrNull(source.maxScore ?? source.max);
  let percent = source.percent === null ? null : toFiniteNumberOrNull(source.percent);

  if (percent === null && score !== null && maxScore !== null && maxScore > 0) {
    percent = Math.max(0, Math.min(100, Math.round((score / maxScore) * 100)));
  }

  const items = Array.isArray(source.items) ? source.items.map((item) => ({
    questionId: String(item?.questionId ?? ""),
    mark: String(item?.mark ?? item?.status ?? "needs_review"),
    points: item?.points === undefined || item?.points === null ? null : toFiniteNumberOrNull(item.points),
    maxPoints: item?.maxPoints === undefined || item?.maxPoints === null ? null : toFiniteNumberOrNull(item.maxPoints),
    feedback: typeof item?.feedback === "string" ? item.feedback : "",
  })).filter((item) => item.questionId || item.feedback) : [];

  return {
    kind: "betterquizzer.grade",
    version: "V1",
    quizId,
    sessionId,
    score,
    maxScore,
    percent,
    label: typeof source.label === "string" && source.label.trim() ? source.label.trim() : percent === null ? "Feedback ready" : percent >= 90 ? "Excellent" : percent >= 75 ? "Good" : percent >= 60 ? "Keep practicing" : "Needs review",
    summary: typeof source.summary === "string" ? source.summary.trim() : "",
    items,
    recordedAt: new Date().toISOString()
  };
}

function recordGrade(id, args = {}) {
  try {
    const grade = normalizeGradePayload(args);
    grades.set(gradeStorageKey(grade.quizId, grade.sessionId), grade);
    grades.set(gradeStorageKey(grade.quizId, "latest"), grade);
    return okResponse(id, {
      structuredContent: { ok: true, grade },
      content: [{ type: "text", text: "BetterQuizzes grade recorded." }],
      _meta: { ok: true, grade }
    });
  } catch (error) {
    return errorResponse(id, -32602, error instanceof Error ? error.message : String(error));
  }
}

function getGradeTool(id, args = {}) {
  const quizId = String(args.quizId || "").trim();
  const sessionId = String(args.sessionId || "").trim();
  const grade = grades.get(gradeStorageKey(quizId, sessionId)) || grades.get(gradeStorageKey(quizId, "latest")) || null;
  return okResponse(id, {
    structuredContent: { ok: Boolean(grade), grade },
    content: [{ type: "text", text: grade ? "BetterQuizzes grade found." : "No BetterQuizzes grade recorded yet." }],
    _meta: { ok: Boolean(grade), grade }
  });
}

function getGradeForUrl(url) {
  const prefix = "/api/grade/";
  const rest = decodeURIComponent(url.pathname.slice(prefix.length));
  const parts = rest.split("/").filter(Boolean);
  const quizId = parts[0] || "";
  const sessionId = parts[1] || url.searchParams.get("sessionId") || "";
  const grade = grades.get(gradeStorageKey(quizId, sessionId)) || grades.get(gradeStorageKey(quizId, "latest")) || null;
  return { ok: Boolean(grade), grade };
}

function inspectQuiz(id, quizId) {
  const quiz = quizzes.get(quizId);
  if (!quiz) return fail(id, -32602, `No stored quiz with id ${quizId}.`);
  const renderDiagnostics = getRenderDiagnostics(quiz);
  return ok(id, { structuredContent: { quizId, title: quiz.title, questionCount: quiz.questions.length, renderableQuestionCount: renderDiagnostics.renderableQuestionCount, unrenderableQuestions: renderDiagnostics.unrenderableQuestions, warnings: renderDiagnostics.warnings, renderDiagnostics, types: [...new Set(quiz.questions.map((q) => q.type))] }, content: [{ type: "text", text: `${quiz.title}: ${renderDiagnostics.renderableQuestionCount}/${quiz.questions.length} renderable questions.` }] });
}

function buildWidgetResource(requestedUri = RESOURCE_URI) {
  const origin = publicOrigin();
  const domain = widgetDomain();
  const connectDomains = uniqueDomains(origin || domain);
  const resourceDomains = uniqueDomains(domain, origin);
  return {
    uri: RESOURCE_URI,
    mimeType: RESOURCE_MIME_TYPE,
    text: widgetHtml(),
    _meta: {
      ui: {
        prefersBorder: true,
        domain,
        csp: { connectDomains, resourceDomains }
      },
      "openai/widgetDescription": "BetterQuizzes V1 displays an LLM-created quiz, collects answers and confidence, then submits a structured capsule back for LLM grading.",
      "openai/widgetDomain": domain,
      "betterquizzer/widgetVersion": VERSION,
      "betterquizzer/requestedResourceUri": requestedUri,
      "betterquizzer/canonicalResourceUri": RESOURCE_URI,
      "openai/widgetPrefersBorder": true,
      "openai/widgetCSP": { connect_domains: connectDomains, resource_domains: resourceDomains }
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
  return {
    ...value,
    quizId: value.quizId || args.quizId,
    sessionId: value.sessionId || args.sessionId || "session-" + Date.now().toString(36),
    launchId: value.launchId || args.launchId,
    quizRevision: Number.isInteger(value.quizRevision) ? value.quizRevision : args.quizRevision
  };
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
    ...(typeof args.launchId === "string" && args.launchId ? { launchId: args.launchId } : {}),
    ...(Number.isInteger(args.quizRevision) ? { quizRevision: args.quizRevision } : {}),
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
const SUPPORTED_QUESTION_TYPES = new Set(SUPPORTED_QUESTION_TYPE_VALUES);
const ORDERING_ITEM_TEXT_MAX_CHARS_RENDER = 64;
const COMPACT_CHOICE_TEXT_WARN_CHARS = 180;
const COMPACT_MATCH_TEXT_WARN_CHARS = 120;
const COMPACT_FIELD_LABEL_WARN_CHARS = 80;
const COMPACT_PLACEHOLDER_WARN_CHARS = 60;
const COMPACT_TEXT_SELECT_SEGMENT_WARN_CHARS = 160;
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
  if (q.type === "matching") {
    normalizeMatchingQuestion(q, index, warnings, normalizedFields);
  }
  if (q.type === "ordering") {
    q.orderingBehavior = normalizeOrderingBehavior(q.orderingBehavior, q.prompt);
    if (!raw.orderingBehavior) normalizedFields.push({ path: `questions[${index}].orderingBehavior`, from: "prompt", to: "orderingBehavior" });
  }
  return q;
}
function normalizeMatchingQuestion(q, index, warnings, normalizedFields) {
  const legacyPairs = q.pairs ?? q.matches ?? q.items;
  if ((!Array.isArray(q.left) || !Array.isArray(q.right)) && Array.isArray(legacyPairs)) {
    const left = [];
    const right = [];
    const answer = [];
    legacyPairs.forEach((pair, pairIndex) => {
      if (!pair || typeof pair !== "object" || Array.isArray(pair)) return;
      const leftText = matchingSideText(pair.left ?? pair.term ?? pair.prompt ?? pair.source);
      const rightText = matchingSideText(pair.right ?? pair.match ?? pair.answer ?? pair.target);
      if (!leftText || !rightText) return;
      const leftId = String(pair.leftId ?? pair.left_id ?? `left${pairIndex + 1}`);
      const rightId = String(pair.rightId ?? pair.right_id ?? `right${pairIndex + 1}`);
      left.push({ id: leftId, text: leftText });
      right.push({ id: rightId, text: rightText });
      answer.push({ leftId, rightId });
    });
    if (left.length && right.length) {
      q.left = left;
      q.right = right;
      if (q.answer === undefined) q.answer = answer;
      warnings.push(`questions[${index}]: normalized legacy matching pairs to left/right/answer.`);
      normalizedFields.push({ path: `questions[${index}]`, from: "pairs", to: "left/right/answer" });
    }
  }
  if (q.answer && typeof q.answer === "object" && !Array.isArray(q.answer)) {
    q.answer = Object.entries(q.answer)
      .filter(([, rightId]) => ["string", "number"].includes(typeof rightId))
      .map(([leftId, rightId]) => ({ leftId, rightId: String(rightId) }));
    warnings.push(`questions[${index}]: normalized matching answer object to [{leftId,rightId}].`);
    normalizedFields.push({ path: `questions[${index}].answer`, from: "object", to: "array" });
  }
}
function matchingSideText(value) {
  if (["string", "number", "boolean"].includes(typeof value)) return String(value).trim();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const text = value.text ?? value.label ?? value.value ?? value.id;
    return ["string", "number", "boolean"].includes(typeof text) ? String(text).trim() : "";
  }
  return "";
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
    if (q.type === "ordering" && (!Array.isArray(q.items) || q.items.length < 2 || !q.items.every(isRenderableOrderingItem))) unrenderableQuestions.push({ index, questionId, reason: `Ordering question requires at least two one-line {id,text} items with text under ${ORDERING_ITEM_TEXT_MAX_CHARS_RENDER} characters.` });
    validateCompactDisplayText(q, questionId, warnings);
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
function isRenderableOrderingItem(item) {
  return isRenderableItem(item) && typeof item.text === "string" && isOneLineOrderingItemText(item.text);
}
function isOneLineOrderingItemText(text) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 0 && normalized.length <= ORDERING_ITEM_TEXT_MAX_CHARS_RENDER && !/[\r\n]/.test(text);
}
function validateCompactDisplayText(q, questionId, warnings) {
  if ((q.type === "multiple_choice" || q.type === "multi_select") && Array.isArray(q.choices)) q.choices.forEach((choice, index) => warnIfLongText(warnings, `${questionId}.choices[${index}]`, choice, COMPACT_CHOICE_TEXT_WARN_CHARS));
  if (q.type === "matching") {
    if (Array.isArray(q.left)) q.left.forEach((item, index) => warnIfLongText(warnings, `${questionId}.left[${index}].text`, item?.text, COMPACT_MATCH_TEXT_WARN_CHARS));
    if (Array.isArray(q.right)) q.right.forEach((item, index) => warnIfLongText(warnings, `${questionId}.right[${index}].text`, item?.text, COMPACT_MATCH_TEXT_WARN_CHARS));
  }
  if ((q.type === "multi_typing" || q.type === "multi_write_vertical") && Array.isArray(q.fields)) {
    q.fields.forEach((field, index) => {
      warnIfLongText(warnings, `${questionId}.fields[${index}].label`, field?.label, COMPACT_FIELD_LABEL_WARN_CHARS);
      warnIfLongText(warnings, `${questionId}.fields[${index}].placeholder`, field?.placeholder, COMPACT_PLACEHOLDER_WARN_CHARS);
    });
  }
  if (q.type === "text_select" && Array.isArray(q.segments)) q.segments.forEach((segment, index) => warnIfLongText(warnings, `${questionId}.segments[${index}].text`, segment?.text, COMPACT_TEXT_SELECT_SEGMENT_WARN_CHARS));
}
function warnIfLongText(warnings, path, value, maxChars) {
  if (typeof value !== "string") return;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length > maxChars) warnings.push(`${path}: compact display text is ${normalized.length} chars; prefer ${maxChars} or fewer for mobile layout.`);
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
  return { preferredGrader: policy.preferredGrader || "llm", includeAnswerKeyInSubmission: policy.includeAnswerKeyInSubmission ?? false };
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
