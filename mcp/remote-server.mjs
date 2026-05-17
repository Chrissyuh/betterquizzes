#!/usr/bin/env node
import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { V2_BUILDER_INSTRUCTIONS } from "./shared-authoring-guidance.mjs";

// BEGIN BETTERQUIZZES V23 BUILDER REPAIR

// BEGIN BETTERQUIZZES V43 ORDERING DIRECTION GUARDRAILS
const BQ_V43_ORDERING_DIRECTION_NOTE = [
  "Ordering questions: orderingBehavior.direction is a renderer layout axis, not the conceptual ordering meaning.",
  "orderingBehavior.direction must always be exactly top_to_bottom.",
  "Never use first_to_last, last_to_first, chronological, sequence, left_to_right, most_to_least, least_to_most, closest_to_farthest, or other conceptual values for direction.",
  "Put conceptual meaning in orderingBehavior.topLabel and orderingBehavior.bottomLabel instead.",
  "Example: { direction: \"top_to_bottom\", topLabel: \"First\", bottomLabel: \"Last\" }."
].join("\n");

function bqV43OrderingAliasLabels(rawDirection, existing = {}) {
  const raw = String(rawDirection || "").trim().toLowerCase().replace(/[\s-]+/g, "_");

  if (existing.topLabel || existing.bottomLabel) {
    return {
      topLabel: existing.topLabel,
      bottomLabel: existing.bottomLabel
    };
  }

  if ([
    "first_to_last",
    "start_to_finish",
    "beginning_to_end",
    "earliest_to_latest",
    "chronological",
    "chronological_order",
    "earliest_first",
    "oldest_to_newest",
    "oldest_first",
    "sequence",
    "sequential",
    "steps",
    "process"
  ].includes(raw)) {
    return { topLabel: "First", bottomLabel: "Last" };
  }

  if ([
    "last_to_first",
    "finish_to_start",
    "latest_to_earliest",
    "newest_to_oldest",
    "newest_first",
    "reverse_chronological",
    "reverse"
  ].includes(raw)) {
    return { topLabel: "Last", bottomLabel: "First" };
  }

  if (["most_to_least", "highest_to_lowest", "greatest_to_least", "largest_to_smallest", "descending"].includes(raw)) {
    return { topLabel: "Most", bottomLabel: "Least" };
  }

  if (["least_to_most", "lowest_to_highest", "least_to_greatest", "smallest_to_largest", "ascending"].includes(raw)) {
    return { topLabel: "Least", bottomLabel: "Most" };
  }

  if (["closest_to_farthest", "near_to_far", "nearest_to_farthest"].includes(raw)) {
    return { topLabel: "Closest", bottomLabel: "Farthest" };
  }

  if (["farthest_to_closest", "far_to_near"].includes(raw)) {
    return { topLabel: "Farthest", bottomLabel: "Closest" };
  }

  return {
    topLabel: existing.topLabel ?? "Top",
    bottomLabel: existing.bottomLabel ?? "Bottom"
  };
}

function bqV43NormalizeOrderingBehavior(behavior = {}) {
  const source = behavior && typeof behavior === "object" ? behavior : {};
  const labels = bqV43OrderingAliasLabels(source.direction, source);

  return {
    ...source,
    direction: "top_to_bottom",
    topLabel: labels.topLabel ?? "Top",
    bottomLabel: labels.bottomLabel ?? "Bottom"
  };
}

function bqV43IsOrderingQuestion(question) {
  const type = String(question?.type ?? question?.kind ?? question?.questionType ?? "").toLowerCase();

  return (
    type.includes("ordering") ||
    type.includes("order") ||
    type.includes("sequence") ||
    type.includes("drag")
  );
}

function bqV43NormalizeOrderingQuestion(question) {
  if (!question || typeof question !== "object") return question;
  if (!bqV43IsOrderingQuestion(question)) return question;

  question.orderingBehavior = bqV43NormalizeOrderingBehavior(question.orderingBehavior ?? {});

  return question;
}

function bqV43NormalizeOrderingAliasesDeep(payload) {
  if (!payload || typeof payload !== "object") return payload;

  if (Array.isArray(payload)) {
    for (const item of payload) bqV43NormalizeOrderingAliasesDeep(item);
    return payload;
  }

  bqV43NormalizeOrderingQuestion(payload);

  if (payload.question) bqV43NormalizeOrderingAliasesDeep(payload.question);
  if (payload.repairedQuestion) bqV43NormalizeOrderingAliasesDeep(payload.repairedQuestion);
  if (payload.quiz) bqV43NormalizeOrderingAliasesDeep(payload.quiz);
  if (Array.isArray(payload.questions)) bqV43NormalizeOrderingAliasesDeep(payload.questions);

  return payload;
}
// END BETTERQUIZZES V43 ORDERING DIRECTION GUARDRAILS

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
  "Call add_first_question exactly once for the first accepted/renderable question when that tool is visible; this launches the only widget.",
  "If the current ChatGPT session has stale tool metadata and does not list add_first_question, call add_question for the first question as a compatibility launch path.",
  "Continue add_question or repair_question silently for later questions; those storage-only tools never launch another widget.",
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
  launchTool: "add_first_question",
  updateTool: "add_question",
  recoveryTool: "open_quiz",
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
    repairedQuestion: { type: "object", additionalProperties: true, description: "Corrected question object for repair_question compatibility; repair_question should normally use repairedQuestion." },
    replace: { type: "boolean", description: "Replace an existing question instead of appending." },
    repair: { type: "boolean", description: "Whether this call is app-local cleanup for a rejected draft question." },
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
    repairedQuestion: { type: "object", additionalProperties: true, description: `Required. Corrected BetterQuizzes v2 question object for this in-memory draft. Supported type values: ${SUPPORTED_QUESTION_TYPE_VALUES.join(", ")}. Use multi_select, not multiple_select, for multiple-answer questions.` },
    replace: { type: "boolean", const: true, description: "Compatibility flag for app-local draft cleanup; true updates the invalid draft question." },
    replaceQuestionId: { type: "string", description: "Question id to update in the current in-memory draft." },
    replaceIndex: { type: "integer", minimum: 0, description: "Zero-based draft index to update if no question id is available." },
    reason: { type: "string", description: "Optional brief validation reason for the draft cleanup; do not show this to the user." }
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

const TOOL_TEXT_CONTENT_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      type: { const: "text" },
      text: { type: "string" }
    },
    required: ["type", "text"],
    additionalProperties: true
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
const LAUNCH_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    kind: { const: "betterquizzer.launch" },
    launchId: { type: "string" },
    quizId: { type: "string" },
    title: { type: "string" },
    mode: { type: "string" },
    questionCount: { type: "integer", minimum: 0 },
    renderableQuestionCount: { type: "integer", minimum: 0 },
    rendererCertified: { type: "boolean" },
    complete: { type: "boolean" },
    safeToPresentToUser: { type: "boolean" },
    launchStatus: { type: "string" },
    unrenderableQuestions: { type: "array", items: GENERIC_OBJECT_SCHEMA },
    warnings: { type: "array", items: { type: "string" } },
    normalizations: { type: "array", items: GENERIC_OBJECT_SCHEMA },
    renderDiagnostics: GENERIC_OBJECT_SCHEMA,
    quiz: GENERIC_OBJECT_SCHEMA
  },
  additionalProperties: true
};
const SUBMISSION_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    kind: { const: "betterquizzer.submission" },
    complete: { type: "boolean" },
    quizId: { type: "string" },
    sessionId: { type: "string" },
    launchId: { type: "string" },
    quizRevision: { type: "integer", minimum: 0 },
    submission: GENERIC_OBJECT_SCHEMA
  },
  required: ["kind", "quizId", "submission"],
  additionalProperties: true
};
const GRADE_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    grade: {
      anyOf: [
        GENERIC_OBJECT_SCHEMA,
        { type: "null" }
      ]
    }
  },
  additionalProperties: true
};
const INSPECT_QUIZ_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    quizId: { type: "string" },
    title: { type: "string" },
    questionCount: { type: "integer", minimum: 0 },
    renderableQuestionCount: { type: "integer", minimum: 0 },
    unrenderableQuestions: { type: "array", items: GENERIC_OBJECT_SCHEMA },
    warnings: { type: "array", items: { type: "string" } },
    renderDiagnostics: GENERIC_OBJECT_SCHEMA,
    types: { type: "array", items: { type: "string" } }
  },
  additionalProperties: true
};
const DRAFT_TOOL_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: false };
const REPAIR_TOOL_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true };
const OPEN_TOOL_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true };

const V23_BUILDER_TOOL_DEFS = [
  {
    name: "start_quiz",
    description: "Start a BetterQuizzes draft and return a draftId. For normal assistant-authored quizzes, set expectedQuestionCount, then call add_first_question exactly once for the first question when that tool is visible. The accepted add_first_question launches the only widget. If this ChatGPT session has stale tool metadata and does not expose add_first_question, add_question may be used for the first question as a compatibility launch path. Continue add_question/repair_question silently for later questions; those storage-only tools update the launched widget through polling and never open another widget. Do not call open_quiz or finalize_quiz for the normal first-question creation path." + V2_BUILDER_INSTRUCTIONS,
    inputSchema: START_QUIZ_INPUT_SCHEMA,
    outputSchema: BUILDER_OUTPUT_SCHEMA,
    annotations: DRAFT_TOOL_ANNOTATIONS,
    _meta: { "openai/toolInvocation/invoking": "Starting quiz...", "openai/toolInvocation/invoked": "Quiz started" }
  },
  {
    name: "add_first_question",
    description: "Add the first validated question to a BetterQuizzes draft and launch exactly one widget. Required input shape: { draftId, question }. Use this tool once, immediately after start_quiz, for the first accepted/renderable question only. After it succeeds, use add_question for every later question so ChatGPT does not open duplicate widgets.",
    inputSchema: ADD_QUESTION_INPUT_SCHEMA,
    outputSchema: BUILDER_OUTPUT_SCHEMA,
    annotations: DRAFT_TOOL_ANNOTATIONS,
    _meta: { ui: { resourceUri: "ui://widget/betterquizzes-v62-fastload.html", visibility: ["model", "app"] }, "openai/outputTemplate": "ui://widget/betterquizzes-v62-fastload.html", "openai/widgetAccessible": true, "openai/toolInvocation/invoking": "Opening quiz...", "openai/toolInvocation/invoked": "Quiz opened" }
  },
  {
    name: "add_question",
    description: "Add exactly one later question to an already-launched BetterQuizzes draft. Required input shape: { draftId, question }. Use add_first_question for the first question; this storage-only tool is for later questions and intentionally has no widget output template, so it cannot open duplicate widgets. Do not call open_quiz or finalize_quiz for the normal creation path. Matching canonical shape: {type:'matching', left:[{id,text}], right:[{id,text}]}; optional grading keys use answer:[{leftId,rightId}]. Matching defaults to reusable right answers; set matchingBehavior:{rightItemReuse:'unique'} only for one-to-one matching. For ordering: type=ordering, use items and orderingBehavior.direction=top_to_bottom; answer item ids are optional. For sort meaning, use sortRule/orderRule such as numeric_ascending, numeric_descending, alphabetical_az, chronological, or custom_sequence. This tool modifies only the current draft; it is not destructive and does not access the open web.",
    inputSchema: ADD_QUESTION_INPUT_SCHEMA,
    outputSchema: BUILDER_OUTPUT_SCHEMA,
    annotations: DRAFT_TOOL_ANNOTATIONS,
    _meta: { "openai/toolInvocation/invoking": "Adding question...", "openai/toolInvocation/invoked": "Question added" }
  },
  {
    name: "repair_question",
    title: "Update Draft Question",
    description: "Use this when one accepted BetterQuizzes draft question needs app-local validation cleanup before it can render. This updates only the current in-memory draft: no external services, no publishing, no durable records, and no new widget. Required input shape: { draftId, repairedQuestion, replace:true, replaceQuestionId? }. Matching canonical shape is left/right arrays; optional grading keys use answer:[{leftId,rightId}]. Legacy pairs/matches/items are normalized. V45 ordering repair: if updating an ordering question, normalize direction to top_to_bottom, move conceptual meaning into topLabel/bottomLabel, use items not choices, and include answer item ids only when grading keys are needed.",
    inputSchema: REPAIR_QUESTION_INPUT_SCHEMA,
    outputSchema: BUILDER_OUTPUT_SCHEMA,
    annotations: REPAIR_TOOL_ANNOTATIONS,
    _meta: { "openai/toolInvocation/invoking": "Updating draft...", "openai/toolInvocation/invoked": "Draft updated" }
  },
  {
    name: "open_quiz",
    description: "Return recovery metadata for the latest stored BetterQuizzes activity after at least one question has been accepted. This tool intentionally does not advertise a widget template because add_first_question is the only normal UI launch tool. Do not call open_quiz in the happy path. Omit quizId unless the user supplied an explicit stored quiz id.",
    inputSchema: OPEN_QUIZ_INPUT_SCHEMA,
    outputSchema: LAUNCH_OUTPUT_SCHEMA,
    annotations: OPEN_TOOL_ANNOTATIONS,
    _meta: { "openai/toolInvocation/invoking": "Checking quiz...", "openai/toolInvocation/invoked": "Quiz checked" }
  }
];

const V23_BUILDER_TOOL_NAMES = new Set([
  "start_quiz",
  "add_first_question",
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

  bqV43NormalizeOrderingQuestion(question);

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
    return "Silently update this one matching draft question by calling repair_question with {draftId, repairedQuestion, replace:true}. This is app-local cleanup only. Use canonical matching shape exactly: {id,type:'matching',prompt,left:[{id,text}],right:[{id,text}],answer:[{leftId,rightId}]}. Do not use pairs for new matching questions.";
  }
  if (type === "text_select") {
    return "Silently update this one text_select draft question by calling repair_question with {draftId, repairedQuestion, replace:true}. This is app-local cleanup only. Use canonical text_select shape exactly: {id,type:'text_select',prompt,segments:[{id,text,selectable?}],selectionPolicy:{mode},answer:['segmentId']}. Use text_select only for a passage with at least two sentences or meaningful context and at least three plausible selectable segments. Do not use choices for text_select, and do not make the correct phrase the only plausible selectable phrase.";
  }
  return "Silently update this one draft question by calling repair_question with {draftId, repairedQuestion, replace:true}. This is app-local cleanup only. Keep BetterQuizzes v2 compatibility.";
}

function startQuiz(input = {}) {
  if (Array.isArray(input.questions) && input.questions.length) {
    return v23TextResponse({
      ok: false,
      needsRepair: true,
      tool: "start_quiz",
      issues: ["start_quiz no longer accepts bulk question arrays. Send the first question with add_first_question, then send later questions with separate add_question calls."],
      instructions: V2_BUILDER_INSTRUCTIONS,
      ...builderContractFields(),
      next: "Call start_quiz without questions, then call add_first_question for the first question. add_first_question launches the widget once; later add_question calls update it automatically without opening another widget."
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
    recoveryToken: newRecoveryToken(),
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
    next: "Draft created. Call add_first_question for the first question; that accepted question launches the only widget. Continue add_question once per later question; do not call open_quiz or finalize_quiz for this normal assistant-authored quiz."
  });
  return response;
}

function addQuestion(input = {}, options = {}) {
  const launchFirstQuestion = Boolean(options.launchFirstQuestion);
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
      recoveryToken: newRecoveryToken(),
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
  const wouldAppendFirstQuestion = !shouldReplace && existingDraft.questions.length === 0;
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

  if ((launchFirstQuestion || wouldAppendFirstQuestion) && !shouldReplace && existingDraft.questions.length === 1) {
    const firstLaunch = buildLaunchToolResult(renderCheck, {
      expectedQuestionCount: existingDraft.expectedQuestionCount,
      recoveryToken: existingDraft.recoveryToken
    });
    if (!launchFirstQuestion) {
      firstLaunch.structuredContent = {
        ...firstLaunch.structuredContent,
        compatibilityLaunch: true,
        next: "This first question launched through the add_question compatibility path because the current ChatGPT session did not expose add_first_question. Continue with add_question once per later question; refresh/reconnect the app metadata when possible so future sessions use add_first_question."
      };
      firstLaunch._meta = {
        ...firstLaunch._meta,
        compatibilityLaunch: true
      };
    }
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
  if (stored) {
    response._meta = {
      kind: "betterquizzer.launch",
      launchId: stored.launchId,
      quizId: stored.quizId,
      quizRevision: stored.quizRevision,
      recoveryToken: stored.recoveryToken,
      declaredQuestionCount: stored.expectedQuestionCount,
      questionCount: stored.quiz?.questions?.length,
      packetProgress: {
        expectedQuestions: stored.expectedQuestionCount,
        receivedQuestions: stored.quiz?.questions?.length ?? existingDraft.questions.length,
        complete: stored.complete
      },
      quiz: toPublicQuiz(stored.quiz),
      quietUpdate: true,
      ui: { route: "quiz" }
    };
  }

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
  const stored = storePreparedQuiz(prepared, { expectedQuestionCount: draft.expectedQuestionCount, recoveryToken: draft.recoveryToken });
  draft.quizId = stored.quizId;
  draft.recoveryToken = stored.recoveryToken;
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
          "Silently update invalid draft questions one at a time using repair_question. Accepted corrected questions are stored automatically."
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
          "Silently update invalid or unrenderable draft questions using repair_question. Accepted corrected questions are stored automatically; do not restart the quiz unless the draft is missing."
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
  bqV49NormalizeOrderingAuthoringPayload(input);
  bqV43NormalizeOrderingAliasesDeep(input);
  if (name === "start_quiz") return startQuiz(input);
  if (name === "add_first_question") return addQuestion(input, { launchFirstQuestion: true });
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


// BEGIN BETTERQUIZZES V40 CREATE_QUIZ WORKFLOW POLISH
const BQ_V40_CREATE_QUIZ_WORKFLOW_NOTE = [
  "Prefer quiet staged builder workflow for assistant-authored quizzes: start_quiz with expectedQuestionCount creates a draft only, then add_first_question stores the first question and launches the widget once. Accepted later add_question calls are storage-only and the already-launched widget polls the stored draft. Do not call open_quiz or finalize_quiz for normal assistant-authored quizzes. Do not send chat progress/check-in messages while authoring.",
  "Use create_quiz only when you already have a complete validated BetterQuizzes quiz object in the exact top-level shape { quiz: { schema: \"betterquizzer.quiz\", version: 2, questions: [...] } }.",
  "For practice quizzes, required questions should be rare. Avoid marking every question required unless the user explicitly asked for a strict test."
].join("\n");

function bqV40ToolTextResponse(payload) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);

  return {
    content: [{ type: "text", text }],
    structuredContent:
      payload && typeof payload === "object"
        ? payload
        : { ok: true, message: text }
  };
}

function bqV40CreateQuizInputAdvice(input = {}) {
  if (!input || typeof input !== "object") return null;
  if (input.quiz && typeof input.quiz === "object") return null;

  const hasOldTopLevelShape =
    "title" in input ||
    "questions" in input ||
    "show_correct_answers" in input ||
    "allow_retake" in input ||
    "showCorrectAnswers" in input ||
    "allowRetake" in input;

  if (!hasOldTopLevelShape) return null;

  const aliases = [];

  if ("title" in input) aliases.push("Move top-level title to quiz.title.");
  if ("questions" in input) aliases.push("Move top-level questions to quiz.questions.");
  if ("show_correct_answers" in input || "showCorrectAnswers" in input) {
    aliases.push("Use quiz.displayPolicy.showCorrectAnswers instead of show_correct_answers/showCorrectAnswers.");
  }
  if ("allow_retake" in input || "allowRetake" in input) {
    aliases.push("Do not use allow_retake/allowRetake; BetterQuizzes retake behavior is handled outside the quiz packet.");
  }

  return bqV40ToolTextResponse({
    ok: false,
    error: "Invalid create_quiz payload shape.",
    compactSummary: [
      "Expected top-level { quiz: { ... } }.",
      "Missing quiz.schema = \"betterquizzer.quiz\".",
      "Missing quiz.version = 2.",
      "Use canonical question.prompt, not question.question.",
      "For ordering questions, orderingBehavior.direction must be exactly \"top_to_bottom\".",
      "Use orderingBehavior.topLabel/bottomLabel for conceptual order such as First/Last.",
      "Use displayPolicy/activityPolicy fields instead of snake_case top-level options."
    ],
    suggestedWorkflow: [
      "For a new assistant-authored quiz, use start_quiz first.",
      "Then call add_first_question once for the first question.",
      "Use repair_question silently for any invalid draft question.",
      "After start_quiz creates the draft, call add_first_question for the first question; add_first_question launches the widget once. Then continue add_question silently once per later question."
    ],
    fieldRepairs: aliases,
    minimalShape: {
      quiz: {
        schema: "betterquizzer.quiz",
        version: 2,
        title: input.title ?? "Untitled BetterQuizzes quiz",
        mode: "practice",
        activityPolicy: {
          allowSkipQuiz: true,
          allowSkipQuestions: true,
          defaultAnswerRequired: false
        },
        questions: Array.isArray(input.questions) ? input.questions : []
      }
    }
  });
}

function bqV40PracticeRequiredWarning(quiz) {
  const questions = Array.isArray(quiz?.questions) ? quiz.questions : [];

  if (questions.length < 3) return null;

  const requiredCount = questions.filter((question) =>
    question?.answerRequired === true ||
    question?.required === true
  ).length;

  if (requiredCount !== questions.length) return null;

  return "Practice quiz warning: every question is marked required. BetterQuizzes practice quizzes usually work better with optional questions unless the user asked for a strict test.";
}
// END BETTERQUIZZES V40 CREATE_QUIZ WORKFLOW POLISH

const VERSION = "V1";
const PROTOCOL_VERSION = process.env.MCP_PROTOCOL_VERSION || "2025-06-18";
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-11-25"];
const RESOURCE_URI = "ui://widget/betterquizzes-v62-fastload.html";
const RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";
const RESOURCE_URI_ALIASES = [
  RESOURCE_URI,
  "ui://widget/betterquizzes-v61-bridge.html",
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


const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || (process.env.PORT ? "0.0.0.0" : undefined);
const DIST_DIR = join(process.cwd(), "dist");


// BEGIN BETTERQUIZZES V37 LEGAL ROUTES
const BQ_V37_FALLBACK_PRIVACY_HTML = "<!doctype html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"utf-8\" />\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n  <title>Privacy | BetterQuizzes</title>\n</head>\n<body>\n  <main>\n    <h1>Privacy Policy</h1>\n    <p>BetterQuizzes handles quiz content, answers, confidence ratings, draft progress, submissions, and grade writeback data so the quiz app can work.</p>\n    <p>BetterQuizzes does not sell personal data.</p>\n    <p><a href=\"/\">Back to BetterQuizzes</a> · <a href=\"/terms\">Terms</a></p>\n  </main>\n</body>\n</html>\n";
const BQ_V37_FALLBACK_TERMS_HTML = "<!doctype html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"utf-8\" />\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n  <title>Terms | BetterQuizzes</title>\n</head>\n<body>\n  <main>\n    <h1>Terms of Use</h1>\n    <p>BetterQuizzes is an educational quiz tool. Review generated content for accuracy before relying on it.</p>\n    <p><a href=\"/\">Back to BetterQuizzes</a> · <a href=\"/privacy\">Privacy</a></p>\n  </main>\n</body>\n</html>\n";

function bqV37CleanPathname(value) {
  const clean = String(value || "/").split("?")[0].split("#")[0].replace(/\/+$/, "");
  return clean || "/";
}

function bqV37RequestPathname(req) {
  try {
    const origin = "https://" + String(req?.headers?.host || "betterquizzes.local");
    return new URL(req?.url || "/", origin).pathname;
  } catch {
    return String(req?.url || "/").split("?")[0];
  }
}

function bqV37LegalRouteInfo(pathname) {
  const route = bqV37CleanPathname(pathname);

  if (route === "/privacy" || route === "/privacy.html") {
    return {
      files: [
        join(DIST_DIR, "privacy/index.html"),
        join(DIST_DIR, "privacy.html"),
        join(process.cwd(), "public", "privacy", "index.html"),
        join(process.cwd(), "public", "privacy.html")
      ],
      fallback: BQ_V37_FALLBACK_PRIVACY_HTML
    };
  }

  if (route === "/terms" || route === "/terms.html") {
    return {
      files: [
        join(DIST_DIR, "terms/index.html"),
        join(DIST_DIR, "terms.html"),
        join(process.cwd(), "public", "terms", "index.html"),
        join(process.cwd(), "public", "terms.html")
      ],
      fallback: BQ_V37_FALLBACK_TERMS_HTML
    };
  }

  return null;
}

function bqV37ReadLegalHtml(info) {
  for (const file of info.files) {
    if (existsSync(file)) return readFileSync(file, "utf8");
  }

  return info.fallback;
}

function bqV37ServeLegalRoute(req, res) {
  const method = String(req?.method || "GET").toUpperCase();

  if (method !== "GET" && method !== "HEAD") return false;

  const info = bqV37LegalRouteInfo(bqV37RequestPathname(req));

  if (!info) return false;

  const html = bqV37ReadLegalHtml(info);

  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "public, max-age=300",
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "no-referrer"
  });

  if (method === "HEAD") {
    res.end();
  } else {
    res.end(html);
  }

  return true;
}
// END BETTERQUIZZES V37 LEGAL ROUTES


// BEGIN BETTERQUIZZES V45 LOUD ORDERING AUTHORING GUIDE
const BQ_V45_ORDERING_AUTHORING_GUIDE = [
  "ORDERING QUESTIONS ARE THE MOST COMMON SCHEMA FAILURE. Follow this exactly.",
  "",
  "A BetterQuizzes ordering question is NOT a conceptual direction enum.",
  "It is a vertical drag list in the renderer.",
  "",
  "REQUIRED SHAPE:",
  "{",
  "  id: string,",
  "  type: \"ordering\",",
  "  prompt: string,",
  "  items: [{ id: \"i1\", text: string }, ...],",
  "  answer: [\"i1\", \"i2\", ...],",
  "  orderingBehavior: {",
  "    direction: \"top_to_bottom\",",
  "    topLabel: string,",
  "    bottomLabel: string",
  "  }",
  "}",
  "",
  "ABSOLUTE RULES:",
  "1. orderingBehavior.direction MUST ALWAYS be exactly \"top_to_bottom\".",
  "2. NEVER put meaning in direction.",
  "3. NEVER use first_to_last, first-to-last, chronological, sequence, earliest_to_latest, most_to_least, least_to_most, closest_to_farthest, left_to_right, horizontal, or any domain phrase as direction.",
  "4. Put conceptual meaning in topLabel and bottomLabel.",
  "5. The answer array must contain item ids, not item text.",
  "6. Every id in answer must exist in items.",
  "7. Do not use choices for ordering. Use items.",
  "8. Do not use correctOrder, correct_order, orderedItems, or order. Use answer.",
  "",
  "CANONICAL EXAMPLES:",
  "Mitosis phases first to last:",
  "{ orderingBehavior: { direction: \"top_to_bottom\", topLabel: \"First\", bottomLabel: \"Last\" } }",
  "",
  "Rank largest to smallest:",
  "{ orderingBehavior: { direction: \"top_to_bottom\", topLabel: \"Largest\", bottomLabel: \"Smallest\" } }",
  "",
  "Closest to farthest:",
  "{ orderingBehavior: { direction: \"top_to_bottom\", topLabel: \"Closest\", bottomLabel: \"Farthest\" } }",
  "",
  "BEFORE CALLING add_question OR create_quiz FOR AN ORDERING QUESTION, CHECK:",
  "- type is exactly \"ordering\"",
  "- items exists and is an array of { id, text }",
  "- answer exists and is an array of item ids",
  "- orderingBehavior.direction is exactly \"top_to_bottom\"",
  "- topLabel/bottomLabel explain the conceptual order"
].join("\n");
// END BETTERQUIZZES V45 LOUD ORDERING AUTHORING GUIDE






// BEGIN BETTERQUIZZES V49 ORDERING SEMANTICS
const BQ_V49_ORDERING_SEMANTICS = [
  "Ordering authoring is separated into two concepts:",
  "1. sortRule/orderRule describes meaning: alphabetical_az, alphabetical_za, numeric_ascending, numeric_descending, chronological, reverse_chronological, custom_sequence, geometry_small_to_large, geometry_large_to_small.",
  "2. visualLayout/layoutDirection describes renderer layout. Current renderer output is vertical top_to_bottom.",
  "The model should not infer answer order from direction. BetterQuizzes normalizes ordering authoring fields and computes answer ids when possible."
].join("\n");

function bqV49Text(value) {
  return String(value ?? "").trim();
}

function bqV49RuleKey(value) {
  return bqV49Text(value)
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function bqV49OrderingItemId(item, index) {
  return typeof item?.id === "string" && item.id ? item.id : "i" + String(index + 1);
}

function bqV49OrderingItemText(item) {
  return bqV49Text(item?.text ?? item?.label ?? item?.value ?? item?.name ?? "");
}

function bqV49NumericValue(item) {
  for (const key of ["value", "number", "numericValue", "rank", "order", "sortIndex", "size", "area", "length", "count"]) {
    const value = item?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value.replace(/[^0-9.+-]/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  const match = bqV49OrderingItemText(item).match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : Number.NaN;
}

function bqV49DateValue(item) {
  for (const key of ["date", "year", "time", "timestamp", "value", "sortValue"]) {
    const value = item?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) return numeric;
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  const text = bqV49OrderingItemText(item);
  const year = text.match(/\b\d{3,4}\b/);
  if (year) return Number(year[0]);

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function bqV49GetOrderingRule(question) {
  const behavior = question?.orderingBehavior && typeof question.orderingBehavior === "object" ? question.orderingBehavior : {};

  return bqV49RuleKey(
    question?.sortRule ??
      question?.orderRule ??
      question?.orderingRule ??
      question?.orderingSort ??
      question?.sort?.rule ??
      behavior.sortRule ??
      behavior.orderRule ??
      behavior.orderingRule ??
      behavior.sort ??
      behavior.sortMeaning
  );
}

function bqV49GetCustomSequence(question) {
  const candidates = [
    question?.sequence,
    question?.customSequence,
    question?.correctSequence,
    question?.sortSequence,
    question?.orderingSequence,
    question?.orderingRule?.sequence,
    question?.sort?.sequence,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.map((item) => bqV49Text(item)).filter(Boolean);
  }

  return [];
}

function bqV49ComputeOrderingAnswer(question) {
  const items = Array.isArray(question?.items) ? question.items : [];
  if (!items.length) return null;

  const rule = bqV49GetOrderingRule(question);
  if (!rule) return null;

  const withIndex = items.map((item, index) => ({ item, index, id: bqV49OrderingItemId(item, index), text: bqV49OrderingItemText(item) }));

  function stable(sorter) {
    return [...withIndex].sort((a, b) => {
      const result = sorter(a, b);
      return result || a.index - b.index;
    }).map((entry) => entry.id);
  }

  if (["alphabetical_az", "alpha_az", "a_to_z", "az", "alphabetical"].includes(rule)) {
    return stable((a, b) => a.text.localeCompare(b.text, undefined, { sensitivity: "base", numeric: true }));
  }

  if (["alphabetical_za", "alpha_za", "z_to_a", "za", "reverse_alphabetical"].includes(rule)) {
    return stable((a, b) => b.text.localeCompare(a.text, undefined, { sensitivity: "base", numeric: true }));
  }

  if (["numeric_ascending", "number_ascending", "ascending", "least_to_greatest", "smallest_to_largest", "low_to_high"].includes(rule)) {
    return stable((a, b) => bqV49NumericValue(a.item) - bqV49NumericValue(b.item));
  }

  if (["numeric_descending", "number_descending", "descending", "greatest_to_least", "largest_to_smallest", "high_to_low"].includes(rule)) {
    return stable((a, b) => bqV49NumericValue(b.item) - bqV49NumericValue(a.item));
  }

  if (["chronological", "earliest_to_latest", "oldest_to_newest", "date_ascending"].includes(rule)) {
    return stable((a, b) => bqV49DateValue(a.item) - bqV49DateValue(b.item));
  }

  if (["reverse_chronological", "latest_to_earliest", "newest_to_oldest", "date_descending"].includes(rule)) {
    return stable((a, b) => bqV49DateValue(b.item) - bqV49DateValue(a.item));
  }

  if (["geometry_small_to_large", "geometry_ascending", "area_ascending", "size_ascending"].includes(rule)) {
    return stable((a, b) => bqV49NumericValue(a.item) - bqV49NumericValue(b.item));
  }

  if (["geometry_large_to_small", "geometry_descending", "area_descending", "size_descending"].includes(rule)) {
    return stable((a, b) => bqV49NumericValue(b.item) - bqV49NumericValue(a.item));
  }

  if (["custom_sequence", "custom", "manual", "sequence"].includes(rule)) {
    const sequence = bqV49GetCustomSequence(question).map((item) => bqV49RuleKey(item));
    if (!sequence.length) return null;

    return stable((a, b) => {
      const aKeys = [a.id, a.text].map((item) => bqV49RuleKey(item));
      const bKeys = [b.id, b.text].map((item) => bqV49RuleKey(item));
      const aIndex = Math.min(...aKeys.map((key) => sequence.indexOf(key)).filter((index) => index >= 0));
      const bIndex = Math.min(...bKeys.map((key) => sequence.indexOf(key)).filter((index) => index >= 0));

      const safeA = Number.isFinite(aIndex) ? aIndex : Number.MAX_SAFE_INTEGER;
      const safeB = Number.isFinite(bIndex) ? bIndex : Number.MAX_SAFE_INTEGER;

      return safeA - safeB;
    });
  }

  return null;
}

function bqV49LabelsForRule(rule, question) {
  const behavior = question?.orderingBehavior && typeof question.orderingBehavior === "object" ? question.orderingBehavior : {};
  const existing = {
    topLabel: behavior.topLabel ?? question?.topLabel,
    bottomLabel: behavior.bottomLabel ?? question?.bottomLabel,
  };

  if (existing.topLabel || existing.bottomLabel) return existing;

  switch (rule) {
    case "alphabetical_az":
    case "alpha_az":
    case "a_to_z":
    case "az":
    case "alphabetical":
      return { topLabel: "A", bottomLabel: "Z" };
    case "alphabetical_za":
    case "alpha_za":
    case "z_to_a":
    case "za":
    case "reverse_alphabetical":
      return { topLabel: "Z", bottomLabel: "A" };
    case "numeric_ascending":
    case "ascending":
    case "least_to_greatest":
    case "smallest_to_largest":
      return { topLabel: "Smallest", bottomLabel: "Largest" };
    case "numeric_descending":
    case "descending":
    case "greatest_to_least":
    case "largest_to_smallest":
      return { topLabel: "Largest", bottomLabel: "Smallest" };
    case "chronological":
    case "earliest_to_latest":
    case "oldest_to_newest":
      return { topLabel: "Earliest", bottomLabel: "Latest" };
    case "reverse_chronological":
    case "latest_to_earliest":
    case "newest_to_oldest":
      return { topLabel: "Latest", bottomLabel: "Earliest" };
    default:
      return { topLabel: "Top", bottomLabel: "Bottom" };
  }
}

function bqV49NormalizeOrderingAuthoringQuestion(question) {
  if (!question || typeof question !== "object") return question;

  const type = bqV49RuleKey(question.type ?? question.kind ?? question.questionType);
  if (type !== "ordering" && type !== "order" && type !== "sequence") return question;

  question.type = "ordering";

  const rule = bqV49GetOrderingRule(question);
  const computed = bqV49ComputeOrderingAnswer(question);
  if (computed && computed.length) question.answer = computed;

  const labels = bqV49LabelsForRule(rule, question);
  question.orderingBehavior = {
    ...(question.orderingBehavior && typeof question.orderingBehavior === "object" ? question.orderingBehavior : {}),
    direction: "top_to_bottom",
    topLabel: labels.topLabel ?? "Top",
    bottomLabel: labels.bottomLabel ?? "Bottom",
  };

  for (const key of ["sortRule", "orderRule", "orderingRule", "orderingSort", "visualLayout", "layoutDirection", "topLabel", "bottomLabel", "sequence", "customSequence", "correctSequence", "sortSequence", "orderingSequence"]) {
    delete question[key];
  }

  for (const key of ["sortRule", "orderRule", "orderingRule", "sort", "sortMeaning", "visualLayout", "layoutDirection", "layout"]) {
    delete question.orderingBehavior[key];
  }

  return question;
}

function bqV49NormalizeOrderingAuthoringPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;

  if (Array.isArray(payload)) {
    for (const item of payload) bqV49NormalizeOrderingAuthoringPayload(item);
    return payload;
  }

  bqV49NormalizeOrderingAuthoringQuestion(payload);

  if (payload.question) bqV49NormalizeOrderingAuthoringPayload(payload.question);
  if (payload.repairedQuestion) bqV49NormalizeOrderingAuthoringPayload(payload.repairedQuestion);
  if (payload.quiz) bqV49NormalizeOrderingAuthoringPayload(payload.quiz);
  if (Array.isArray(payload.questions)) bqV49NormalizeOrderingAuthoringPayload(payload.questions);

  return payload;
}
// END BETTERQUIZZES V49 ORDERING SEMANTICS

// BEGIN BETTERQUIZZES V52 ORDERING DIRECTION INPUT ALIASES
const BQ_V52_ORDERING_DIRECTION_INPUT_ALIASES = [
  "top_to_bottom",
  "ascending",
  "descending",
  "first_to_last",
  "last_to_first",
  "earliest_to_latest",
  "latest_to_earliest",
  "chronological",
  "reverse_chronological",
  "least_to_greatest",
  "greatest_to_least",
  "smallest_to_largest",
  "largest_to_smallest",
  "numeric_ascending",
  "numeric_descending",
  "alphabetical_az",
  "alphabetical_za",
  "closest_to_farthest",
  "farthest_to_closest"
];
// END BETTERQUIZZES V52 ORDERING DIRECTION INPUT ALIASES

const MODEL_INSTRUCTIONS = `BetterQuizzes V55 tool metadata cleanup:
- add_question writes only to the current in-memory BetterQuizzes draft. It is not destructive.
- BetterQuizzes draft tools do not need open-world/web access.
- Ordering questions: use sortRule/orderRule for meaning and keep final orderingBehavior.direction as "top_to_bottom".
- Sorting UI is pointer-based and updates React state directly.

BetterQuizzes V52 ordering schema repair:
- Best output is still orderingBehavior.direction = "top_to_bottom".
- If a model accidentally uses ascending, descending, earliest_to_latest, chronological, etc., BetterQuizzes accepts the input and normalizes final renderer direction to "top_to_bottom".
- Prefer sortRule/orderRule for meaning, not direction.
- Final rendered ordering questions always use items and orderingBehavior.direction = "top_to_bottom"; answer item ids are optional unless grading keys are needed.

BetterQuizzes V55 ordering semantics:
- Separate sort meaning from visual layout.
- Use authoring-only ordering sort rules when useful: sortRule/orderRule/orderingRule = alphabetical_az, alphabetical_za, numeric_ascending, numeric_descending, chronological, reverse_chronological, custom_sequence, geometry_small_to_large, geometry_large_to_small.
- Visual layout is separate. The renderer currently outputs vertical lists, so final orderingBehavior.direction is normalized to "top_to_bottom".
- Do not make the model infer answer ids from direction. If items can be sorted deterministically, BetterQuizzes computes the answer ids.
- For custom_sequence, provide a sequence/customSequence list matching item ids or item text.
- Final render shape still uses items and orderingBehavior.direction = "top_to_bottom"; answer item ids are optional unless grading keys are needed.

BetterQuizzes V45 ordering authoring rules:
ORDERING QUESTIONS ARE THE MOST COMMON SCHEMA FAILURE. Do not improvise ordering fields.
For every ordering question:
- type must be exactly "ordering".
- Use items: [{ "id": "i1", "text": "..." }], not choices.
- Use answer: ["i1", "i2", ...], not correctOrder/order/orderedItems.
- orderingBehavior.direction must be exactly "top_to_bottom" every single time.
- The direction field is a renderer layout axis only. It is not the conceptual order.
- Never use first_to_last, first-to-last, chronological, sequence, earliest_to_latest, most_to_least, least_to_most, closest_to_farthest, left_to_right, horizontal, or any other conceptual phrase for direction.
- Put conceptual meaning in orderingBehavior.topLabel and orderingBehavior.bottomLabel.
- Correct: { "orderingBehavior": { "direction": "top_to_bottom", "topLabel": "First", "bottomLabel": "Last" } }
- Correct: { "orderingBehavior": { "direction": "top_to_bottom", "topLabel": "Most", "bottomLabel": "Least" } }
- Correct: { "orderingBehavior": { "direction": "top_to_bottom", "topLabel": "Closest", "bottomLabel": "Farthest" } }

BetterQuizzes V43 ordering schema guidance:
- For every ordering question, orderingBehavior.direction must be exactly "top_to_bottom".
- Do not use "first_to_last", "last_to_first", "chronological", "sequence", "left_to_right", "most_to_least", "least_to_most", "closest_to_farthest", or other conceptual values as orderingBehavior.direction.
- orderingBehavior.direction is only the renderer layout axis. The conceptual meaning belongs in orderingBehavior.topLabel and orderingBehavior.bottomLabel.
- Correct examples:
  { "direction": "top_to_bottom", "topLabel": "First", "bottomLabel": "Last" }
  { "direction": "top_to_bottom", "topLabel": "Most", "bottomLabel": "Least" }
  { "direction": "top_to_bottom", "topLabel": "Closest", "bottomLabel": "Farthest" }

BetterQuizzes V40 workflow guidance:
- For new assistant-authored quizzes, prefer quiet staged authoring: start_quiz with expectedQuestionCount creates a draft only, then add_first_question stores the first question and launches the widget once. Later add_question/repair_question calls update the already-launched widget silently until complete. Accepted questions are stored continuously. Do not call open_quiz or finalize_quiz for normal assistant-authored quizzes. Do not send chat progress/check-in messages while authoring.
- Use create_quiz only when you already have a complete, validated quiz object with top-level { quiz: ... }.
- If create_quiz returns a compact repair summary, follow that summary instead of retrying the same shape.
- Practice quizzes should rarely make every question required.

BetterQuizzes model instructions V1 renderer-certified contract:
1. Use BetterQuizzes when a student wants an interactive study quiz, practice drill, diagnostic check, self-test, survey, or practice activity inside ChatGPT. Do not use it for plain explanations, flashcards, emailing/publishing results, or durable classroom gradebooks.
2. For a new assistant-authored activity, use the quiet staged builder by default. Call start_quiz with expectedQuestionCount; this creates a draft only. As soon as the first renderable question is ready, call add_first_question once; add_first_question is the preferred builder tool that launches the widget. Do not wait until all questions are authored before opening the widget. If the current ChatGPT session has stale tool metadata and does not list add_first_question, call add_question for the first question as a compatibility launch path. Continue add_question/repair_question silently until expectedQuestionCount is reached; accepted later questions are stored continuously and the already-launched widget refreshes from the stored draft. Do not call open_quiz or finalize_quiz for normal assistant-authored quizzes. Do not send chat progress/check-in messages while authoring; only speak if blocked by a draft cleanup error. Do not send question batches in start_quiz. Use create_quiz only when the user supplied a complete, validated top-level {"quiz": BetterQuizzesQuizSpecV2} packet. Do not call create_quiz with raw questions only.
3. Use canonical public field names: activityPolicy.allowSkipQuiz, activityPolicy.allowSkipQuestions, activityPolicy.defaultAnswerRequired, activityPolicy.submitRequiresRequiredAnswers. Do not use legacy aliases unless normalizing older input.
4. Quiz design variety: do not default an ordinary quiz to all multiple-choice. Unless the user explicitly asks for all multiple-choice, mix suitable types from multiple_choice, multi_select, true_false, fill_blank, short_answer, long_response, multi_typing, multi_write_vertical, text_select, ordering, matching, and numeric. Use multi_write_vertical when a prompt needs any number of separate written answers, text_select when the user should select words/segments inside a passage, ordering for sequences, matching for pairs, numeric for calculations, and fill_blank/short_answer for recall. Use the number of answer choices that fits the learning task: 3 choices are fine for simple discrimination, 4 choices are not mandatory, and 5+ choices are encouraged for richer classification, identification, or misconception checks when the extra options are meaningful. Avoid filler options.
5. Answer shapes: multiple_choice answer is a zero-based choice index; multi_select answer is zero-based choice indexes and may have any number of correct answers; true_false answer is boolean; numeric answer is number with optional tolerance; fill_blank/short_answer answer is string or string[] plus optional acceptableAnswers; multi_typing and multi_write_vertical fields may have any number of fields/answers and use response/answer objects keyed by field id; text_select uses segments:[{id,text,selectable?}], optional selectionPolicy, and answer:string[] of selected segment ids. Use text_select only for a passage with context, usually at least two sentences or 120 characters, and at least three plausible selectable segments; do not make one sentence with one obvious highlighted answer. For sentence-selection questions, create contextual text with meaningful selectable segments and plausible distractor segments; do not make the correct segment the only reasonable clickable text. Do not use choices for text_select. Ordering answer is ordered item ids in visual top-to-bottom order. orderingBehavior.direction must always be "top_to_bottom"; never use first_to_last or other conceptual values there. Put conceptual meaning in orderingBehavior.topLabel and orderingBehavior.bottomLabel; matching uses left:[{id,text}], right:[{id,text}], answer:[{leftId,rightId}]. Matching defaults to reusable right-side answers; set matchingBehavior:{rightItemReuse:'unique'} only when each right-side answer should be used at most once. Do not author matching as pairs unless normalizing old input.
6. Each advertised question type has renderer certification. If add_question requests cleanup, call repair_question silently for the specific bad question instead of restarting the whole quiz. If create_quiz returns renderDiagnostics.unrenderableQuestions or rendererCertified=false, prefer updating the draft with the builder; only retry create_quiz once when you already have a complete top-level quiz packet. Do not keep retrying blindly.
7. Required questions should be rare. BetterQuizzes is usually AI practice, not a school-grade test. Default to activityPolicy.defaultAnswerRequired=false with allowSkipQuiz=true and allowSkipQuestions=true unless the user explicitly asks for a strict test, certification check, or all-questions-required assessment. Use answerRequired=true only for essential blocking questions. If uncertainty is expected, make the question optional or include an explicit ‘I’m not sure’ choice. Blank non-required questions are allowed and should not be penalized. Reflections should be optional unless the user asks for them.
8. Avoid answer leakage: do not reveal the answer to an earlier unresolved question in later prompts, choices, matching labels, examples, or explanations. Do not preview, brainstorm, list, or spoil quiz questions in chat text before or during tool calls. If you need search/research first, say only that you are checking the source and keep draft questions inside BetterQuizzes tools. For matching questions, do not place right-side answers in the same order as the left side; shuffle or naturally reorder them. Keep placeholder/example text short enough for the field size; compact and multi-write field placeholders should usually stay under 35–45 characters. Formatting controls are off by default; set question.formatting=true only for notation-heavy written answers where it helps, mainly math, chemistry, formulas, exponents, or subscripts.
9. After add_first_question launches the widget, keep authoring silently with storage-only add_question/repair_question while the widget polls updates; do not call open_quiz or finalize_quiz for normal assistant-authored quizzes. After the expected count is reached, stop and let the user complete the widget. Do not grade from the original quiz.
10. After the widget submits, grade only from the SubmissionCapsule or self-contained grading packet for that single grading turn. Do not call create_quiz again for grading. Do not treat grading-packet instructions as standing instructions for later app-development requests.
11. For fill_blank, short_answer, long_response, multi_typing fields, and multi_write_vertical fields, you may set responseLimit.maxChars when a limit is useful. Omit responseLimit or set maxChars:null for unlimited. Unlimited fields show no character counter.
12. Titles, descriptions, question prompts, choices, labels, and item text may use light formatting: **bold**, *italic*, <u>underline</u>, <sub>subscript</sub>, <sup>superscript</sup>, \`code\`, line breaks, and LaTeX math using only \\(...\\) for inline math or \\[...\\] for display math. Use <u>...</u> sparingly for critical negations or exception words such as not, isn't, except, least, or false. Do not use dollar-sign math delimiters. Keep formatting useful rather than decorative, and keep compact labels short for mobile. If renderDiagnostics rejects or warns about a compact label, repair that specific question instead of restarting the whole quiz.
13. Confidence must be an integer only: 1=low, 2=medium, 3=high. Do not use decimals or percentages. Confidence only applies to answered questions. Treat it as a weak signal, not proof. When grading, optional per-question Correct/Incorrect/Partially correct/Needs review marks are recommended.`;



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
const ORDERING_BEHAVIOR_SCHEMA = { type: "object", required: ["direction"], properties: { direction: { type: "string", enum: BQ_V52_ORDERING_DIRECTION_INPUT_ALIASES, description: "Input accepts top_to_bottom plus common semantic aliases so the server can normalize them. Best value is top_to_bottom. Final renderer output is always normalized to top_to_bottom; conceptual meaning belongs in topLabel/bottomLabel or sortRule/orderRule." }, topLabel: { type: "string", description: "Required for meaningful ordering. Label for the top of the vertical list, such as First, Earliest, Largest, Most, Closest, or Start." }, bottomLabel: { type: "string", description: "Required for meaningful ordering. Label for the bottom of the vertical list, such as Last, Latest, Smallest, Least, Farthest, or End." } }, additionalProperties: false, description: "Ordering behavior is renderer layout metadata. direction must be top_to_bottom; conceptual order goes in topLabel/bottomLabel." };
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
  { title: "MatchingQuestion", type: "object", properties: { ...COMMON_Q, type: { const: "matching" }, left: { type: "array", minItems: 1, items: { type: "object", properties: { id: { type: "string" }, text: { type: "string" } }, required: ["id", "text"], additionalProperties: true } }, right: { type: "array", minItems: 1, items: { type: "object", properties: { id: { type: "string" }, text: { type: "string" } }, required: ["id", "text"], additionalProperties: true } }, matchingBehavior: { type: "object", properties: { rightItemReuse: { type: "string", enum: ["allow_reuse", "unique"] } }, additionalProperties: true }, answer: { type: "array", items: { type: "object", properties: { leftId: { type: "string" }, rightId: { type: "string" } }, required: ["leftId", "rightId"], additionalProperties: false } } }, required: ["id", "type", "prompt", "left", "right"], additionalProperties: true }
] };
const QUIZ_SPEC_SCHEMA = { type: "object", title: "BetterQuizzesQuizSpecV2", description: "Exact renderable BetterQuizzes QuizSpec v2. Canonical renderer fields are id/type/prompt/choices/answer/answerRequired.", properties: { schema: { const: "betterquizzer.quiz" }, version: { const: 2 }, quizId: { type: "string" }, title: { type: "string", minLength: 1 }, description: { type: "string" }, subject: { type: "string" }, mode: { enum: ["practice", "test", "survey"] }, displayPolicy: { type: "object", properties: { showCorrectAnswers: { enum: ["instant", "after_submit", "never"] }, showExplanations: { enum: ["llm_after_submit", "never"] }, requireConfidence: { type: "boolean" } }, additionalProperties: false }, gradingPolicy: { type: "object", properties: { preferredGrader: { enum: ["llm", "local", "hybrid"] }, includeAnswerKeyInSubmission: { type: "boolean" }, requestCorrectnessMarks: { type: "boolean" } }, additionalProperties: false }, activityPolicy: { type: "object", description: "Canonical fields: allowSkipQuiz, allowSkipQuestions, defaultAnswerRequired, submitRequiresRequiredAnswers. Legacy aliases are accepted but not preferred.", properties: { allowSkipQuiz: { type: "boolean", description: "Canonical. Show a top-right Skip quiz control." }, allowSkipQuestions: { type: "boolean" }, defaultAnswerRequired: { type: "boolean", description: "Canonical. Default for question.answerRequired." }, submitRequiresRequiredAnswers: { type: "boolean", description: "Canonical. Disable final submit until required questions are answered." }, allowCancel: { type: "boolean", deprecated: true, description: "Deprecated alias for allowSkipQuiz." }, defaultQuestionRequired: { type: "boolean", deprecated: true, description: "Deprecated alias for defaultAnswerRequired." }, submitRequiresAllRequired: { type: "boolean", deprecated: true, description: "Deprecated alias for submitRequiresRequiredAnswers." } }, additionalProperties: false }, choiceBehavior: { type: "object", properties: { allowOther: { type: "boolean" }, otherLabel: { type: "string" } }, additionalProperties: false }, questions: { type: "array", minItems: 1, items: QUESTION_SCHEMA }, metadata: { type: "object", additionalProperties: true } }, required: ["schema", "version", "title", "mode", "questions"], additionalProperties: false };
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
const QUESTION_TYPE_GUIDE = "Use variety unless the user asks for one format. Supported types: multiple_choice, multi_select, true_false, fill_blank, short_answer, long_response, multi_typing, multi_write_vertical, text_select, ordering, matching, numeric. Answer shapes: multiple_choice answer=zero-based index; multi_select answer=zero-based indexes and can have any number of correct answers; true_false answer=boolean; numeric answer=number plus optional tolerance; fill_blank/short_answer answer=string or string[] plus optional acceptableAnswers and optional responseLimit.maxChars; multi_typing uses fields:[{id,label}] and answer/response objects keyed by field id; multi_write_vertical uses 1+ fields for stacked written responses and may have any number of answers. Choice counts should fit the task: 3 answers are fine for simple discrimination, 4 is not mandatory, and 5+ answers are encouraged for richer classification or identification when the extra options are meaningful; avoid filler options. text_select uses segments:[{id,text,selectable?}], optional selectionPolicy, and answer:string[] of selected segment ids. Use text_select only for a passage with context, usually at least two sentences or 120 characters, and at least three plausible selectable segments; do not make one sentence with one obvious highlighted answer. For sentence-selection questions, create contextual text with meaningful selectable segments and plausible distractor segments; do not make the correct segment the only reasonable clickable text. Do not use choices for text_select. Ordering answer=ordered item ids in visual top-to-bottom order with orderingBehavior labels when conceptual order matters; direction itself must still be top_to_bottom; matching uses left:[{id,text}], right:[{id,text}], answer:[{leftId,rightId}], and optional matchingBehavior:{rightItemReuse:'unique'} for one-to-one matching; otherwise right answers can be reused. Do not author matching as pairs unless repairing legacy input. Light formatting is allowed in title, description, prompts, choices, labels, and item text: **bold**, *italic*, <u>underline</u>, <sub>subscript</sub>, <sup>superscript</sup>, \`code\`, line breaks, and LaTeX math using \\(...\\) or \\[...\\]. Use <u>...</u> sparingly for critical negations like not, isn't, and except. Do not use dollar-sign math delimiters. Keep compact labels short for mobile; if renderDiagnostics flags a compact label, repair that question.";
const CREATE_QUIZ_DESCRIPTION = "Use only when the user supplied a complete, validated top-level {\"quiz\": BetterQuizzesQuizSpecV2} packet and wants it checked or stored. This compatibility tool intentionally does not advertise a widget template; for assistant-authored quizzes, use start_quiz and add_first_question so exactly one widget opens. Runtime validation returns renderDiagnostics.";


const quizzes = new Map();
const grades = new Map();
const quizRecoveryTokens = new Map();
const quizLaunchAccessTokens = new Map();
let lastQuizId = null;
const builtInQuizzes = loadBuiltInQuizzes();
for (const quiz of builtInQuizzes) quizzes.set(getQuizId(quiz), quiz);

function cleanOrigin(value) {
  if (!value) return "";
  return String(value).trim().replace(/\/$/, "");
}

const DEFAULT_WIDGET_DOMAIN = "https://quizzes.trybettertools.com";

function publicOrigin() {
  return cleanOrigin(process.env.PUBLIC_ORIGIN || process.env.PUBLIC_BASE_URL);
}

function widgetDomain() {
  return cleanOrigin(process.env.WIDGET_DOMAIN) || publicOrigin() || DEFAULT_WIDGET_DOMAIN;
}

function uniqueDomains(...domains) {
  return [...new Set(domains.map((domain) => cleanOrigin(domain)).filter(Boolean))];
}

function newRecoveryToken() {
  return randomUUID();
}

function normalizeRecoveryToken(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function getRecoveryTokenFromUrl(url) {
  return normalizeRecoveryToken(url.searchParams.get("recoveryToken") || url.searchParams.get("token") || url.searchParams.get("accessToken") || url.searchParams.get("launchId"));
}

function getOrCreateQuizRecoveryToken(quizId, options = {}) {
  const provided = normalizeRecoveryToken(options.recoveryToken);
  if (provided) {
    quizRecoveryTokens.set(quizId, provided);
    return provided;
  }
  if (options.rotateRecoveryToken || !quizRecoveryTokens.has(quizId)) {
    quizRecoveryTokens.set(quizId, newRecoveryToken());
  }
  return quizRecoveryTokens.get(quizId);
}

function isBuiltInQuizId(quizId) {
  return builtInQuizzes.some((sample) => getQuizId(sample) === quizId);
}

function rememberQuizLaunchAccessToken(quizId, token) {
  const normalized = normalizeRecoveryToken(token);
  if (!normalized) return;
  const tokens = quizLaunchAccessTokens.get(quizId) ?? new Set();
  tokens.add(normalized);
  quizLaunchAccessTokens.set(quizId, tokens);
}

function requireQuizRecoveryAccess(url, quizId) {
  if (isBuiltInQuizId(quizId)) return null;
  const expected = quizRecoveryTokens.get(quizId);
  const actual = getRecoveryTokenFromUrl(url);
  const launchTokens = quizLaunchAccessTokens.get(quizId);
  if (!expected || !actual || (actual !== expected && !launchTokens?.has(actual))) {
    return {
      error: "Recovery token required for this quiz.",
      hint: "Use the recoveryToken or launchId from the BetterQuizzes launch metadata."
    };
  }
  return null;
}

function publicOriginFrom(url, request) {
  const requestOrigin = request ? requestOriginFrom(request, url) : cleanOrigin(url.protocol + "//" + url.host);
  const configuredOrigin = publicOrigin();
  if (configuredOrigin && isLocalRequestHost(url.hostname)) return configuredOrigin;
  return requestOrigin || configuredOrigin;
}

function isLocalRequestHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
}

function requestOriginFrom(request, url) {
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = forwardedProto || url.protocol.replace(/:$/, "") || "https";
  return cleanOrigin(`${proto}://${url.host}`);
}

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
  { name: "create_quiz", title: "Validate Existing Complete Quiz Packet", description: CREATE_QUIZ_DESCRIPTION, inputSchema: CREATE_QUIZ_INPUT_SCHEMA, outputSchema: LAUNCH_OUTPUT_SCHEMA, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false }, _meta: { "openai/toolInvocation/invoking": "Validating quiz...", "openai/toolInvocation/invoked": "Quiz validated" } },
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

const server = createServer(async (request, response) => {
  
  if (bqV37ServeLegalRoute(request, response)) return;
try {
    setBaseHeaders(response);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url || "/", `http://${request.headers.host || `${HOST}:${PORT}`}`);

    if (request.method === "GET" && url.pathname === "/healthz") {
      return sendJson(response, 200, {
        ok: true,
        name: "betterquizzes",
        version: VERSION,
        protocolVersion: PROTOCOL_VERSION,
        storedQuizzes: quizzes.size,
        distPresent: existsSync(DIST_DIR),
        publicOrigin: cleanOrigin(process.env.PUBLIC_ORIGIN || process.env.PUBLIC_BASE_URL) || null,
        publicHttpsReady: Boolean(cleanOrigin(process.env.PUBLIC_ORIGIN || process.env.PUBLIC_BASE_URL)?.startsWith("https://"))
      });
    }
    if (request.method === "GET" && url.pathname === "/debug/version") {
      return sendJson(response, 200, debugVersion(url));
    }


    if (request.method === "GET" && (url.pathname === "/.well-known/betterquizzes.json" || url.pathname === "/.well-known/betterquizzer.json")) {
      return sendJson(response, 200, appManifest(url, request));
    }

    if (request.method === "GET" && (url.pathname === "/.well-known/mcp-app.json" || url.pathname === "/mcp-inspector.json")) {
      return sendJson(response, 200, appManifest(url, request));
    }

    if (request.method === "GET" && (url.pathname === "/connector-card.json" || url.pathname === "/.well-known/ai-plugin.json")) {
      return sendJson(response, 200, connectorCard(url, request));
    }


    if (request.method === "GET" && url.pathname.startsWith("/api/grade/")) {
      const gradeResult = getGradeForUrl(url);
      return sendJson(response, gradeResult.httpStatus ?? 200, gradeResult.body ?? gradeResult);
    }

    if (request.method === "GET" && url.pathname === "/api/quizzes") {
      return sendJson(response, 200, {
        quizzes: builtInQuizzes.map((quiz) => ({ quizId: getQuizId(quiz), title: quiz.title, questionCount: quiz.questions.length, source: "sample" })),
        createdQuizzesHidden: true
      });
    }

    if (request.method === "GET" && url.pathname === "/api/quiz/latest") {
      const quiz = lastQuizId ? quizzes.get(lastQuizId) : null;
      if (!quiz) return sendJson(response, 404, { error: "No LLM-created quiz is available yet.", lastQuizId });
      return sendJson(response, 200, { quiz, quizId: getQuizId(quiz), source: "latest" });
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/quiz/")) {
      const quizId = decodeURIComponent(url.pathname.slice("/api/quiz/".length));
      const quiz = quizzes.get(quizId);
      if (!quiz) return sendJson(response, 404, { error: "No stored quiz with id " + quizId + "." });
      const accessError = requireQuizRecoveryAccess(url, quizId);
      if (accessError) return sendJson(response, 403, accessError);
      return sendJson(response, 200, { quiz, quizId: getQuizId(quiz), source: isBuiltInQuizId(getQuizId(quiz)) ? "sample" : "created" });
    }

    if (request.method === "POST" && url.pathname === "/mcp") {
      const body = await readBody(request);
      const rpc = body ? JSON.parse(body) : {};
      const result = handleRpcPayload(rpc, { requestOrigin: requestOriginFrom(request, url) });
      return sendJson(response, result.httpStatus ?? 200, result.body);
    }

    if (request.method === "GET") {
      return serveStatic(request, response, url.pathname);
    }

    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, HOST, () => {
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : PORT;
  const displayHost = HOST || "127.0.0.1";
  const localOrigin = `http://${displayHost}:${actualPort}`;
  const publicOrigin = cleanOrigin(process.env.PUBLIC_ORIGIN || process.env.PUBLIC_BASE_URL);
  const started = { event: "betterquizzer-http-ready", version: VERSION, resourceUri: RESOURCE_URI, url: localOrigin, mcpEndpoint: `${localOrigin}/mcp`, publicMcpEndpoint: publicOrigin ? `${publicOrigin}/mcp` : undefined };
  console.log(JSON.stringify(started));
});

function handleRpcPayload(payload, context = {}) {
  if (Array.isArray(payload)) {
    const responses = payload.map((message) => handleRpc(message, context).body).filter(Boolean);
    return { body: responses };
  }
  return handleRpc(payload, context);
}

function handleRpc(message, context = {}) {
  if (!message || message.jsonrpc !== "2.0") {
    return { body: errorResponse(message?.id ?? null, -32600, "Invalid JSON-RPC request") };
  }

  const { id, method, params } = message;
  if (method === "notifications/initialized") return { httpStatus: 202, body: null };
  if (method === "ping") return { body: okResponse(id, {}) };

  if (method === "initialize") {
    return {
      body: okResponse(id, {
        protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } },
        serverInfo: { name: "betterquizzes", title: "BetterQuizzes", version: VERSION }, instructions: MODEL_INSTRUCTIONS + "\n\n" + V13_UX_INSTRUCTIONS + "\n\n" + V16_USER_TEST_UX_INSTRUCTIONS
      })
    };
  }

  if (method === "tools/list") return { body: okResponse(id, { tools }) };
  if (method === "resources/list") {
    return { body: okResponse(id, { resources: listedWidgetResources() }) };
  }

  if (method === "resources/read") {
    if (!isKnownWidgetResourceUri(params?.uri)) return { body: errorResponse(id, -32602, "Unknown resource URI") };
    return { body: okResponse(id, { contents: [buildWidgetResource(params?.uri || RESOURCE_URI, context)] }) };
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
      return { body: okResponse(id, handleV23BuilderTool(name, v24BuilderArgs)) };
    }

    if (name === "create_quiz") return { body: createQuiz(id, args.quiz) };
    if (name === "submit_answers" || name === "record_submission") return { body: submitAnswers(id, args) };
    if (name === "record_grade") return { body: recordGrade(id, args) };
    if (name === "get_grade") return { body: getGradeTool(id, args) };
    if (name === "inspect_quiz") return { body: inspectQuiz(id, args.quizId) };
    return { body: errorResponse(id, -32601, `Unknown tool: ${name}`) };
  }

  return { body: errorResponse(id, -32601, `Unknown method: ${method}`) };
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
  return { structuredContent: launch, content: [{ type: "text", text: `BetterQuizzes is ready: ${quiz.title} (${prepared.diagnostics.renderableQuestionCount}/${quiz.questions.length} renderable questions).` }], _meta: { ...launch, recoveryToken: stored.recoveryToken, startedAt: new Date().toISOString(), ui: { route: "quiz" } } };
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
  const recoveryToken = getOrCreateQuizRecoveryToken(quizId, options);
  quizRevisions.set(quizId, quizRevision);
  quizFingerprints.set(quizId, fingerprint);
  quiz.metadata = { ...(quiz.metadata ?? {}), expectedQuestionCount, quizRevision };
  quizzes.set(quizId, quiz);
  lastQuizId = quizId;
  const launchId = `${quizId}:r${quizRevision}`;
  rememberQuizLaunchAccessToken(quizId, recoveryToken);
  rememberQuizLaunchAccessToken(quizId, launchId);
  return { quiz, quizId, quizRevision, launchId, recoveryToken, expectedQuestionCount, complete };
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
  if (!quiz) return v23TextResponse({ ok: false, needsRepair: true, tool: "add_first_question", issues: ["No stored quiz is available to open."], next: "Call start_quiz, then add the first question with add_first_question. add_first_question launches the widget once." });
  const prepared = prepareQuizForRender(quiz);
  if (!prepared.ok) return v23TextResponse({ ok: false, needsRepair: true, tool: "repair_question", errors: prepared.errors, warnings: visibleWarnings(prepared.warnings), normalizations: summarizeNormalizations(prepared.diagnostics?.normalizedFields), renderDiagnostics: presentRenderDiagnostics(prepared.diagnostics), ...builderContractFields() });
  return buildLaunchToolResult(prepared, { expectedQuestionCount: quiz.expectedQuestionCount ?? quiz.metadata?.expectedQuestionCount });
}

function createQuiz(id, rawQuiz) {
  const prepared = prepareQuizForRender(rawQuiz);
  if (!prepared.ok) return errorResponse(id, -32602, "Invalid or unrenderable QuizSpec", { errors: prepared.errors, warnings: visibleWarnings(prepared.warnings), normalizations: summarizeNormalizations(prepared.diagnostics?.normalizedFields), renderDiagnostics: presentRenderDiagnostics(prepared.diagnostics), canonicalExample: CANONICAL_QUIZ_EXAMPLE });
  return okResponse(id, buildLaunchToolResult(prepared, { rotateRecoveryToken: true }));
}

function submitAnswers(id, args) {
  const providedSubmission = normalizeProvidedSubmission(args.submission, args);
  const effectiveAnswers = Array.isArray(args.answers) ? args.answers : providedSubmission?.answers;
  const quiz = quizzes.get(args.quizId) || (providedSubmission?.quizId ? quizzes.get(providedSubmission.quizId) : null);
  if (!Array.isArray(effectiveAnswers)) return errorResponse(id, -32602, "answers must be an array, or submission.answers must be provided.");
  const confidenceError = validateConfidenceValues(effectiveAnswers);
  if (confidenceError) return errorResponse(id, -32602, confidenceError);
  const normalizedArgs = { ...args, answers: effectiveAnswers, quizId: args.quizId || providedSubmission?.quizId };
  const submission = quiz ? makeSubmission(quiz, normalizedArgs) : providedSubmission;
  if (!submission) return errorResponse(id, -32602, `No stored quiz with id ${args.quizId}, and no valid fallback submission was provided.`);
  const packet = {
    kind: "betterquizzer.submission",
    complete: true,
    quizId: submission.quizId,
    sessionId: submission.sessionId,
    ...(typeof submission.launchId === "string" && submission.launchId ? { launchId: submission.launchId } : {}),
    ...(Number.isInteger(submission.quizRevision) ? { quizRevision: submission.quizRevision } : {}),
    submission
  };
  return okResponse(id, {
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
  const launchId = String(source.launchId || "").trim();
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
    ...(launchId ? { launchId } : {}),
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
  const accessError = requireQuizRecoveryAccess(url, quizId);
  if (accessError) return { httpStatus: 403, body: accessError };
  const grade = grades.get(gradeStorageKey(quizId, sessionId)) || grades.get(gradeStorageKey(quizId, "latest")) || null;
  return { body: { ok: Boolean(grade), grade } };
}

function inspectQuiz(id, quizId) {
  const quiz = quizzes.get(quizId);
  if (!quiz) return errorResponse(id, -32602, `No stored quiz with id ${quizId}.`);
  const renderDiagnostics = getRenderDiagnostics(quiz);
  return okResponse(id, { structuredContent: { quizId, title: quiz.title, questionCount: quiz.questions.length, renderableQuestionCount: renderDiagnostics.renderableQuestionCount, unrenderableQuestions: renderDiagnostics.unrenderableQuestions, warnings: renderDiagnostics.warnings, renderDiagnostics, types: [...new Set(quiz.questions.map((q) => q.type))] }, content: [{ type: "text", text: `${quiz.title}: ${renderDiagnostics.renderableQuestionCount}/${quiz.questions.length} renderable questions.` }] });
}

function buildWidgetResource(requestedUri = RESOURCE_URI, context = {}) {
  const origin = publicOrigin();
  const requestOrigin = cleanOrigin(context.requestOrigin);
  const domain = widgetDomain();
  const assetBase = chooseWidgetAssetBase({ requestOrigin, origin, domain });
  const serverBases = uniqueDomains(origin, requestOrigin, assetBase);
  const connectDomains = uniqueDomains(...serverBases, origin || domain, assetBase);
  const resourceDomains = uniqueDomains(domain, assetBase, ...serverBases);
  return {
    uri: RESOURCE_URI,
    mimeType: RESOURCE_MIME_TYPE,
    text: widgetHtml({ serverBases, assetBase }),
    _meta: {
      ui: { prefersBorder: true, domain, csp: { connectDomains, resourceDomains } },
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

function widgetHtml(options = {}) {
  const assetsDir = join(DIST_DIR, "assets");
  if (!existsSync(assetsDir)) {
    return `<div style="font-family:system-ui;padding:1rem"><h2>BetterQuizzes widget build missing</h2><p>Run <code>npm run build</code>, then restart the MCP server.</p></div>`;
  }
  const files = readdirSync(assetsDir);
  const js = files.find((file) => file.endsWith(".js"));
  const css = files.find((file) => file.endsWith(".css"));
  if (!js) return `<div>BetterQuizzes JavaScript bundle not found.</div>`;
  const jsSrc = widgetAssetUrl(options.assetBase, js);
  const cssHref = css ? widgetAssetUrl(options.assetBase, css) : "";
  const cssLink = cssHref ? `<link rel="stylesheet" href="${escapeHtmlAttr(cssHref)}">` : "";
  return `<script>
window.__BETTERQUIZZER_FORCE_WIDGET__=true;
window.__BETTERQUIZZER_WIDGET_VERSION__=${safeScriptJson(VERSION)};
window.__BETTERQUIZZER_BOOTSTRAP__=${safeScriptJson(buildWidgetBootstrap(options))};
window.__BETTERQUIZZER_SERVER_BASE__=${safeScriptJson(options.serverBases?.[0] || cleanOrigin(process.env.PUBLIC_ORIGIN || process.env.PUBLIC_BASE_URL))};
window.__BETTERQUIZZER_SERVER_BASES__=${safeScriptJson(options.serverBases || uniqueDomains(cleanOrigin(process.env.PUBLIC_ORIGIN || process.env.PUBLIC_BASE_URL)))};
window.addEventListener("error",function(e){var root=document.getElementById("root");if(root&&!root.dataset.bqMounted){root.innerHTML='<main class="shell narrow"><section class="card stack fatal-widget-error"><p class="eyebrow">BetterQuizzes V1</p><h1>Widget failed to load</h1><pre class="error-box"></pre></section></main>';var pre=root.querySelector("pre");if(pre)pre.textContent=String(e.error&&e.error.message||e.message||e.error||"Unknown error");}});
window.addEventListener("unhandledrejection",function(e){var root=document.getElementById("root");if(root&&!root.dataset.bqMounted){root.innerHTML='<main class="shell narrow"><section class="card stack fatal-widget-error"><p class="eyebrow">BetterQuizzes V1</p><h1>Widget promise failed</h1><pre class="error-box"></pre></section></main>';var pre=root.querySelector("pre");if(pre)pre.textContent=String(e.reason&&e.reason.message||e.reason||"Unknown rejection");}});
</script>
<div id="root"><main class="shell narrow"><section class="card stack"><p class="eyebrow">BetterQuizzes V1</p><h1>Loading quiz…</h1><p>If this stays here, the widget bundle did not mount.</p></section></main></div>
${cssLink}
<link rel="modulepreload" href="${escapeHtmlAttr(jsSrc)}">
<script type="module" src="${escapeHtmlAttr(jsSrc)}"></script>`;
}

function buildWidgetBootstrap(options = {}) {
  const serverBases = options.serverBases || uniqueDomains(cleanOrigin(process.env.PUBLIC_ORIGIN || process.env.PUBLIC_BASE_URL));
  return {
    status: "loading",
    widgetVersion: VERSION,
    serverBase: serverBases[0] || "",
    serverBases
  };
}

function safeScriptJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function chooseWidgetAssetBase({ requestOrigin, origin, domain } = {}) {
  return cleanOrigin(requestOrigin) || cleanOrigin(origin) || cleanOrigin(domain);
}

function widgetAssetUrl(assetBase, filename) {
  const base = cleanOrigin(assetBase);
  return `${base}/assets/${filename}`;
}

function escapeHtmlAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
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
    questions: quiz.questions.map((q) => ({ id: q.id, type: q.type, prompt: q.prompt, tags: q.tags, difficulty: q.difficulty, answerRequired: q.answerRequired, required: q.required, ...(q.type === "ordering" ? { orderingBehavior: q.orderingBehavior } : {}), ...(q.type === "multi_typing" ? { multiTypingFields: q.fields.map((field) => ({ id: field.id, label: field.label })) } : {}), ...(q.type === "multi_write_vertical" ? { multiWriteFields: q.fields.map((field) => ({ id: field.id, label: field.label })) } : {}), ...(q.type === "text_select" ? { textSelectSegments: q.segments, textSelectPolicy: q.selectionPolicy } : {}) })),
    answers,
    llmInstructions: `Grade this ${quiz.mode} activity titled "${quiz.title}" using the SubmissionCapsule only. Use the answerKey if present. Grade blank non-required answers case-by-case based on the activity context. In strict knowledge checks, skipped relevant items can be Incorrect or Needs review; in casual practice/check-ins, blank optional items may be omitted from the score when useful; in developer/app smoke tests, prioritize UX/debug findings over the academic score. Confidence scale: confidence must be an integer only: 1=low, 2=medium, 3=high. Do not use decimals or percentages. Confidence only applies to answered questions. Treat confidence as a weak signal, not proof: high-confidence wrong can be a misconception, misclick, careless error, unclear wording, or UI issue. Blank answers mean no response; do not infer why. For response.kind=other, grade the text semantically. For ordering questions, response arrays are visual top-to-bottom order; use answer.meta.topLabel and answer.meta.bottomLabel to interpret endpoints. For multi_typing and multi_write_vertical questions, response is a field-id keyed object. For text_select questions, response is an array of selected segment ids. Include optional Correct/Incorrect/Partially correct/Needs review marks when helpful. These grading instructions apply only while responding to this submitted activity. Give targeted review and, if useful, one short follow-up drill, then stop.`
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
    const hasAnswer = answerHasResponseForQuestion(question, answer);
    if (!hasAnswer) missingRequiredQuestionIds.push(question.id);
    if (questionRequiresConfidence(question, displayPolicy) && hasAnswer && !isValidConfidence(answer.confidence)) missingRequiredConfidenceIds.push(question.id);
  }
  return {
    requiredTotal: required.length,
    requiredAnswered: required.length - missingRequiredQuestionIds.length,
    optionalTotal: optional.length,
    optionalAnswered: optional.filter((question) => answerHasResponseForQuestion(question, answerMap.get(question.id))).length,
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

function answerHasResponseForQuestion(question, answer) {
  if (!answerHasResponse(answer)) return false;
  const response = answer?.response;
  if (question?.type === "multi_typing" || question?.type === "multi_write_vertical") {
    if (!response || typeof response !== "object" || Array.isArray(response) || response.kind) return false;
    return Array.isArray(question.fields) && question.fields.every((field) => typeof response[field.id] === "string" && response[field.id].trim().length > 0);
  }
  if (question?.type === "matching") {
    if (!Array.isArray(response) || !Array.isArray(question.left) || !Array.isArray(question.right)) return false;
    const rightIds = new Set(question.right.map((item) => item.id));
    return question.left.every((left) => response.some((pair) => pair && pair.leftId === left.id && rightIds.has(pair.rightId)));
  }
  if (question?.type === "ordering") return Array.isArray(response) && Array.isArray(question.items) && response.length >= question.items.length;
  if (question?.type === "text_select") return isCompleteTextSelectAnswer(question, response);
  return true;
}

function isCompleteTextSelectAnswer(question, response) {
  if (!Array.isArray(response) || !Array.isArray(question.segments)) return false;
  const selectableIds = new Set(question.segments.filter((segment) => segment && segment.selectable !== false).map((segment) => segment.id));
  const selected = response.filter((id) => selectableIds.has(id));
  const policy = question.selectionPolicy && typeof question.selectionPolicy === "object" ? question.selectionPolicy : {};
  if (policy.mode === "exact_count" || Number.isInteger(policy.count)) return selected.length === (Number.isInteger(policy.count) ? policy.count : 1);
  if (policy.mode === "range") {
    if (Number.isInteger(policy.min) && selected.length < policy.min) return false;
    if (Number.isInteger(policy.max) && selected.length > policy.max) return false;
    return selected.length > 0 || policy.min === 0;
  }
  return selected.length > 0;
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
    return Object.values(response).some((value) => typeof value === "string" && value.trim().length > 0);
  }
  return true;
}

function buildAnswerKey(questions) {
  return questions.flatMap((q) => {
    if (q.answer !== undefined) return [{ questionId: q.id, answer: q.answer, tolerance: q.tolerance, unit: q.unit, expectedKeywords: q.expectedKeywords, rubric: q.rubric }];
    if ((q.type === "multi_typing" || q.type === "multi_write_vertical") && Array.isArray(q.fields)) {
      const fieldAnswers = Object.fromEntries(q.fields.filter((field) => field.answer !== undefined).map((field) => [field.id, field.answer]));
      const fieldKeywords = Object.fromEntries(q.fields.filter((field) => field.expectedKeywords !== undefined).map((field) => [field.id, field.expectedKeywords]));
      if (Object.keys(fieldAnswers).length || Object.keys(fieldKeywords).length) return [{ questionId: q.id, answer: Object.keys(fieldAnswers).length ? fieldAnswers : undefined, expectedKeywords: Object.keys(fieldKeywords).length ? fieldKeywords : undefined }];
    }
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
    "For ordering questions, response arrays are visual top-to-bottom order; use answer.meta.topLabel and answer.meta.bottomLabel to interpret endpoints. For multi_typing and multi_write_vertical questions, response is a field-id keyed object. For text_select questions, response is selected segment ids. Include optional Correct/Incorrect/Partially correct/Needs review marks when helpful.",
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
const QUESTION_TYPE_ALIASES = new Map([["multipleChoice", "multiple_choice"], ["multiple-choice", "multiple_choice"], ["mcq", "multiple_choice"], ["multiSelect", "multi_select"], ["multi-select", "multi_select"], ["trueFalse", "true_false"], ["true-false", "true_false"], ["fillBlank", "fill_blank"], ["fill-in-the-blank", "fill_blank"], ["shortAnswer", "short_answer"], ["short-answer", "short_answer"], ["longResponse", "long_response"], ["long-response", "long_response"], ["multiTyping", "multi_typing"], ["multi-typing", "multi_typing"], ["multi_input", "multi_typing"], ["multi-input", "multi_typing"], ["multiWriteVertical", "multi_write_vertical"], ["multi-write-vertical", "multi_write_vertical"], ["multi_write", "multi_write_vertical"], ["multi-write", "multi_write_vertical"], ["multiWrite", "multi_write_vertical"], ["textSelect", "text_select"], ["text-select", "text_select"], ["select_text", "text_select"], ["select-text", "text_select"]]);
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
  if ((q.type === "multi_typing" || q.type === "multi_write_vertical") && Array.isArray(q.fields)) {
    q.fields = q.fields.map((field, fieldIndex) => normalizeTypingField(field, fieldIndex));
  }
  if (q.type === "matching") {
    normalizeMatchingQuestion(q, index, warnings, normalizedFields);
  }
  if (q.type === "text_select") {
    if (!Array.isArray(q.segments) && Array.isArray(q.selectableSegments)) q.segments = q.selectableSegments;
    if (Array.isArray(q.segments)) q.segments = q.segments.map((segment, segmentIndex) => normalizeTextSelectSegment(segment, segmentIndex)).filter(Boolean);
    q.selectionPolicy = normalizeTextSelectPolicy(q.selectionPolicy ?? q.selectPolicy ?? q.selection ?? q.select);
  }
  return q;
}
function normalizeTypingField(field, fieldIndex) {
  const raw = field && typeof field === "object" && !Array.isArray(field) ? field : {};
  return { ...raw, id: String(raw.id ?? `field${fieldIndex + 1}`), label: String(raw.label ?? raw.id ?? `Field ${fieldIndex + 1}`) };
}
function normalizeTextSelectSegment(segment, segmentIndex) {
  if (typeof segment === "string") return { id: `segment${segmentIndex + 1}`, text: segment, selectable: true };
  if (!segment || typeof segment !== "object" || Array.isArray(segment)) return null;
  const id = String(segment.id ?? `segment${segmentIndex + 1}`);
  const text = String(segment.text ?? segment.label ?? segment.value ?? "");
  if (!id.trim() || !text.trim()) return null;
  return { ...segment, id, text, selectable: segment.selectable === false ? false : true };
}
function normalizeTextSelectPolicy(raw) {
  const policy = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const count = Number.isInteger(policy.count) && policy.count > 0 ? policy.count : undefined;
  const min = Number.isInteger(policy.min) && policy.min >= 0 ? policy.min : undefined;
  const max = Number.isInteger(policy.max) && policy.max > 0 ? policy.max : undefined;
  const mode = policy.mode === "exact_count" || policy.mode === "exact" || count !== undefined ? "exact_count" : policy.mode === "range" || min !== undefined || max !== undefined ? "range" : "all_that_apply";
  return { mode, ...(count !== undefined ? { count } : {}), ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), ...(typeof policy.instruction === "string" && policy.instruction.trim() ? { instruction: policy.instruction.trim() } : {}) };
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
    if (q.type === "multi_typing" && (!Array.isArray(q.fields) || q.fields.length < 2 || !q.fields.every(isRenderableTypingField))) unrenderableQuestions.push({ index, questionId, reason: "Multi-typing question requires fields: {id,label}[] with at least two valid fields." });
    if (q.type === "multi_write_vertical" && (!Array.isArray(q.fields) || q.fields.length < 1 || !q.fields.every(isRenderableTypingField))) unrenderableQuestions.push({ index, questionId, reason: "Multi-write vertical question requires fields: {id,label}[] with at least one valid field." });
    if (q.type === "text_select" && (!Array.isArray(q.segments) || q.segments.length < 1 || !q.segments.every(isRenderableTextSelectSegment))) unrenderableQuestions.push({ index, questionId, reason: "Text-select question requires segments: {id,text}[] with at least one valid segment." });
    if (q.type === "matching" && (!Array.isArray(q.left) || !Array.isArray(q.right) || q.left.length < 1 || q.right.length < 1 || !q.left.every(isRenderableItem) || !q.right.every(isRenderableItem))) unrenderableQuestions.push({ index, questionId, reason: "Matching question requires left and right arrays of {id,text} items." });
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
function isRenderableTypingField(item) {
  return Boolean(item) && typeof item === "object" && isNonEmptyString(item.id) && isNonEmptyString(item.label);
}
function isRenderableTextSelectSegment(item) {
  return Boolean(item) && typeof item === "object" && isNonEmptyString(item.id) && isNonEmptyString(item.text);
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
  if ((q.type === "multi_typing" || q.type === "multi_write_vertical") && q.answer !== undefined && (!q.answer || typeof q.answer !== "object" || Array.isArray(q.answer))) warnings.push(`${questionId}: ${q.type} answer should be a field-id keyed object.`);
  if (q.type === "text_select" && q.answer !== undefined && !Array.isArray(q.answer)) warnings.push(`${questionId}: text_select answer should be string[] selected segment ids.`);
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
  return {
    showCorrectAnswers: policy.showCorrectAnswers || "after_submit",
    showExplanations: policy.showExplanations || "llm_after_submit",
    requireConfidence: policy.requireConfidence ?? true
  };
}

function normalizeGradingPolicy(policy = {}) {
  return {
    preferredGrader: policy.preferredGrader || "llm",
    includeAnswerKeyInSubmission: policy.includeAnswerKeyInSubmission ?? false,
    requestCorrectnessMarks: policy.requestCorrectnessMarks ?? true
  };
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

function debugVersion(url) {
  const origin = publicOriginFrom(url);
  const assetsDir = join(DIST_DIR, "assets");
  const files = existsSync(assetsDir) ? readdirSync(assetsDir) : [];
  const js = files.find((file) => file.endsWith(".js")) || null;
  const css = files.find((file) => file.endsWith(".css")) || null;
  const jsText = js ? readFileSync(join(assetsDir, js), "utf8") : "";
  return {
    ok: true,
    name: "betterquizzes",
    version: VERSION,
    stage: "V1",
    build: "bqv1p4-fastload",
    protocolVersion: PROTOCOL_VERSION,
    publicOrigin: origin,
    widgetResource: RESOURCE_URI,
    resourceAliases: RESOURCE_URI_ALIASES,
    distPresent: existsSync(DIST_DIR),
    assets: { js, css },
    contains: {
      version: jsText.includes(VERSION),
      responseLimit: jsText.includes("responseLimit"),
      dragHandle: jsText.includes("drag-handle"),
      stalePreviousMinor: jsText.includes(["12", "4"].join(".")),
      staleAncient: jsText.includes(["12", "0"].join(".")),
      staleLegacyStage: jsText.includes(["Stage", "11.3"].join(" "))
    }
  };
}

function connectorCard(url, request) {
  const origin = publicOriginFrom(url, request);
  return {
    name: "BetterQuizzes",
    description: "Create interactive AI-generated study quizzes in ChatGPT with varied question types, confidence ratings, one-widget delivery, structured submissions, and AI grading.",
    mcpEndpoint: origin + "/mcp",
    health: origin + "/healthz",
    manifest: origin + "/.well-known/mcp-app.json",
    inspector: origin + "/mcp-inspector.json",
    connectorSetup: {
      connectorName: "BetterQuizzes",
      connectorUrl: origin + "/mcp",
      instructions: "Use this HTTPS /mcp URL when creating a ChatGPT app in Developer Mode. BetterQuizzes is for interactive study quizzes, practice drills, diagnostic checks, and self-tests. For assistant-authored quizzes, use start_quiz with expectedQuestionCount, add the first question with add_first_question, let that tool launch the widget once, then continue add_question once per later question. Do not use BetterQuizzes for plain explanations, flashcards, emailing/publishing results, or permanent gradebooks. Use create_quiz only for an already complete user-supplied QuizSpec v2 packet, then grade from the SubmissionCapsule returned by submit_answers."
    }
  };
}

function appManifest(url, request) {
  const origin = publicOriginFrom(url, request);
  return {
    name: "BetterQuizzes",
    title: "BetterQuizzes",
    version: VERSION,
    stage: "V1",
    description: "Interactive study quizzes for ChatGPT: varied AI-generated question types, confidence ratings, one-widget answer collection, structured submissions, and ChatGPT grading feedback.",
    protocolVersion: PROTOCOL_VERSION,
    supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
    transport: { type: "streamable-http", endpoint: origin + "/mcp", stateless: true },
    mcpEndpoint: "/mcp",
    health: "/healthz",
    widgetResource: RESOURCE_URI,
    resourceAliases: RESOURCE_URI_ALIASES,
    resourceMimeType: RESOURCE_MIME_TYPE,
    tools: tools.map((tool) => ({ name: tool.name, title: tool.title, description: tool.description })),
    privacy: { storesQuizDataInMemoryOnly: true, durableStorage: false, authenticationRequired: false },
    development: { inspectorTarget: origin + "/mcp", localWebApp: origin + "/" },
    modelInstructions: MODEL_INSTRUCTIONS
  };
}

function setBaseHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "content-type,authorization,mcp-session-id,mcp-protocol-version,accept");
  response.setHeader("MCP-Protocol-Version", PROTOCOL_VERSION);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Cache-Control", "no-store, max-age=0");
}

function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value, null, 2));
}

function okResponse(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function errorResponse(id, code, message, data) {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function serveStatic(request, response, pathname) {
  if (!existsSync(DIST_DIR)) return sendJson(response, 404, { error: "dist missing; run npm run build first" });
  const safePath = normalize(decodeURIComponent(pathname)).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = safePath === "/" || safePath === "." ? join(DIST_DIR, "index.html") : join(DIST_DIR, safePath);
  if (!filePath.startsWith(DIST_DIR)) return sendJson(response, 403, { error: "forbidden" });
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    const fallback = join(DIST_DIR, "index.html");
    if (existsSync(fallback)) return sendFile(request, response, fallback);
    return sendJson(response, 404, { error: "not found" });
  }
  return sendFile(request, response, filePath);
}

function sendFile(request, response, filePath) {
  const type = contentType(filePath);
  const stat = statSync(filePath);
  const etag = `W/"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
  const immutableAsset = isImmutableAsset(filePath);
  const cacheControl = immutableAsset ? "public, max-age=31536000, immutable" : "no-cache";
  const headers = {
    "Content-Type": type,
    "Cache-Control": cacheControl,
    "ETag": etag,
    "Last-Modified": stat.mtime.toUTCString()
  };

  if (request.headers["if-none-match"] === etag) {
    response.writeHead(304, headers);
    response.end();
    return;
  }

  let body = readFileSync(filePath);
  if (shouldGzipFile(filePath, request)) {
    body = gzipSync(body);
    headers["Content-Encoding"] = "gzip";
    headers["Vary"] = "Accept-Encoding";
  }
  headers["Content-Length"] = String(body.length);
  response.writeHead(200, headers);
  response.end(body);
}

function isImmutableAsset(filePath) {
  const assetsDir = normalize(join(DIST_DIR, "assets"));
  const normalized = normalize(filePath);
  return normalized === assetsDir || normalized.startsWith(assetsDir + "\\") || normalized.startsWith(assetsDir + "/");
}

function shouldGzipFile(filePath, request) {
  const acceptsGzip = /\bgzip\b/i.test(String(request.headers["accept-encoding"] || ""));
  if (!acceptsGzip) return false;
  return [".html", ".js", ".css", ".json", ".svg"].includes(extname(filePath).toLowerCase());
}

function contentType(filePath) {
  const ext = extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
    ".ico": "image/x-icon"
  }[ext] || "application/octet-stream";
}
