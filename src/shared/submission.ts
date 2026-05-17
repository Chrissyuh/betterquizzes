import { normalizeActivityPolicy, normalizeDisplayPolicy, normalizeGradingPolicy } from "./schemas";
import type {
  AnswerKeyEntry,
  AnswerRecord,
  ActivityPolicy,
  DisplayPolicy,
  GradingPolicy,
  MatchingPair,
  Question,
  QuestionSnapshot,
  QuizSession,
  QuizSpec,
  SubmissionCapsule,
  SubmissionCompletionSummary,
} from "./types";

export function getQuizId(quiz: QuizSpec): string {
  return quiz.quizId ?? slugify(quiz.title);
}

export function createId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export function createSession(quiz: QuizSpec, answers: AnswerRecord[], startedAt: string, submittedAt = new Date().toISOString()): QuizSession {
  return {
    schema: "betterquizzer.session",
    version: 2,
    sessionId: createId("session"),
    quizId: getQuizId(quiz),
    startedAt,
    submittedAt,
    mode: quiz.mode,
    answers,
  };
}

export function createSubmissionCapsule(quiz: QuizSpec, session: QuizSession): SubmissionCapsule {
  const displayPolicy = normalizeDisplayPolicy(quiz.displayPolicy);
  const gradingPolicy = normalizeGradingPolicy(quiz.gradingPolicy);
  const activityPolicy = normalizeActivityPolicy(quiz.activityPolicy);
  const answerKey = gradingPolicy.includeAnswerKeyInSubmission === false ? [] : buildAnswerKey(quiz.questions);
  const completion = buildCompletionSummary(quiz, session.answers, displayPolicy, activityPolicy);

  return {
    schema: "betterquizzer.submission",
    version: 2,
    quizId: getQuizId(quiz),
    sessionId: session.sessionId,
    title: quiz.title,
    subject: quiz.subject,
    mode: quiz.mode,
    submittedAt: session.submittedAt ?? new Date().toISOString(),
    displayPolicy,
    gradingPolicy,
    activityPolicy,
    completion,
    status: {
      localSaved: true,
      hostSubmitted: false,
      followUpRequested: false,
      duplicateSubmission: false,
      warnings: completion.isComplete ? [] : ["Submission is incomplete."],
    },
    questions: quiz.questions.map(questionToSnapshot),
    answers: session.answers,
    ...(answerKey.length > 0 ? { answerKey } : {}),
    llmInstructions: buildLlmInstructions(quiz, displayPolicy, gradingPolicy, activityPolicy),
  };
}

export function buildLlmReturnPrompt(submission: SubmissionCapsule): string {
  return [
    "I completed a BetterQuizzes activity.",
    "",
    "Please grade it using the SubmissionCapsule as the source of truth, explain mistakes, use confidence cautiously as a weak signal, and give me a targeted follow-up review.",
    "",
    `Submission: ${submission.quizId} / ${submission.sessionId}`,
    `Completion: ${submission.completion.requiredAnswered}/${submission.completion.requiredTotal} required answered; missing required: ${submission.completion.missingRequiredQuestionIds.join(", ") || "none"}; missing confidence: ${submission.completion.missingRequiredConfidenceIds.join(", ") || "none"}.`,
    "The structured SubmissionCapsule is returned by the BetterQuizzes tool result; use it as the source of truth. Do not recreate the quiz or assume blank non-required questions are wrong.",
    "Confidence values are integers only: 1=low, 2=medium, 3=high. Do not use decimals or percentages.",
  ].join("\n");
}


export function buildCompletionSummary(quiz: QuizSpec, answers: AnswerRecord[], displayPolicy = normalizeDisplayPolicy(quiz.displayPolicy), activityPolicy = normalizeActivityPolicy(quiz.activityPolicy)): SubmissionCompletionSummary {
  const answerMap = new Map(answers.map((answer) => [answer.questionId, answer]));
  const requiredQuestions = quiz.questions.filter((question) => isQuestionRequired(question, activityPolicy));
  const optionalQuestions = quiz.questions.filter((question) => !isQuestionRequired(question, activityPolicy));
  const missingRequiredQuestionIds: string[] = [];
  const missingRequiredConfidenceIds: string[] = [];

  for (const question of requiredQuestions) {
    const answer = answerMap.get(question.id);
    if (!answerHasResponseForQuestion(question, answer)) missingRequiredQuestionIds.push(question.id);
    if (questionRequiresConfidence(question, displayPolicy) && answerHasResponseForQuestion(question, answer) && !isValidConfidenceValue(answer?.confidence)) missingRequiredConfidenceIds.push(question.id);
  }

  const requiredAnswered = requiredQuestions.length - missingRequiredQuestionIds.length;
  const optionalAnswered = optionalQuestions.filter((question) => answerHasResponseForQuestion(question, answerMap.get(question.id))).length;

  return {
    requiredTotal: requiredQuestions.length,
    requiredAnswered,
    optionalTotal: optionalQuestions.length,
    optionalAnswered,
    missingRequiredQuestionIds,
    missingRequiredConfidenceIds,
    isComplete: missingRequiredQuestionIds.length === 0 && missingRequiredConfidenceIds.length === 0,
  };
}

export 

function questionRequiresConfidence(question: Question, displayPolicy: DisplayPolicy): boolean {
  const record = question as Question & {
    requireConfidence?: boolean;
    confidenceRequired?: boolean;
    disableConfidence?: boolean;
    confidence?: boolean | "required" | "optional" | "disabled";
  };
  if (record.disableConfidence === true) return false;
  if (record.confidence === false || record.confidence === "disabled") return false;
  if (record.confidence === "optional") return false;
  if (record.confidence === "required" || record.requireConfidence === true || record.confidenceRequired === true) return true;
  if (record.requireConfidence === false) return false;
  if (record.confidenceRequired === false) return false;
  return displayPolicy.requireConfidence;
}

function isValidConfidenceValue(value: unknown): value is 1 | 2 | 3 {
  return value === 1 || value === 2 || value === 3;
}
function answerHasResponseForQuestion(question: Question, answer: AnswerRecord | undefined): boolean {
  if (!answerHasResponse(answer)) return false;
  const response = answer?.response;
  if (question.type === "numeric") return (typeof response === "number" && Number.isFinite(response)) || (typeof response === "string" && response.trim().length > 0);
  if (question.type === "ordering") return Array.isArray(response) && response.filter((item) => typeof item === "string").length >= question.items.length;
  if (question.type === "matching") {
    if (!Array.isArray(response)) return false;
    const rightIds = new Set(question.right.map((item) => item.id));
    return question.left.every((left) => response.some((pair) => pair && typeof pair === "object" && (pair as MatchingPair).leftId === left.id && rightIds.has((pair as MatchingPair).rightId)));
  }
  if (question.type === "multi_typing" || question.type === "multi_write_vertical") {
    if (!response || typeof response !== "object" || Array.isArray(response) || "kind" in response) return false;
    const record = response as Record<string, unknown>;
    return question.fields.every((field) => typeof record[field.id] === "string" && String(record[field.id]).trim().length > 0);
  }
  if (question.type === "text_select") {
    if (!Array.isArray(response) || !response.every((item) => typeof item === "string")) return false;
    return isTextSelectComplete(question, response);
  }
  if (question.type === "multi_select") return Array.isArray(response) && response.length > 0 || Boolean(response && typeof response === "object" && !Array.isArray(response) && (response as { kind?: unknown; text?: unknown; selections?: unknown }).kind === "other" && (typeof (response as { text?: unknown }).text === "string" && String((response as { text?: unknown }).text).trim().length > 0 || Array.isArray((response as { selections?: unknown }).selections) && ((response as { selections?: unknown[] }).selections ?? []).length > 0));
  return true;
}

function isTextSelectComplete(question: Extract<Question, { type: "text_select" }>, selected: string[]): boolean {
  const selectableIds = new Set(question.segments.filter((segment) => segment.selectable !== false).map((segment) => segment.id));
  const cleanSelected = selected.filter((id) => selectableIds.has(id));
  const policy = question.selectionPolicy ?? {};
  const count = typeof policy.count === "number" && Number.isInteger(policy.count) ? policy.count : undefined;
  const min = typeof policy.min === "number" && Number.isInteger(policy.min) ? policy.min : undefined;
  const max = typeof policy.max === "number" && Number.isInteger(policy.max) ? policy.max : undefined;
  if (policy.mode === "exact_count" || count !== undefined) return cleanSelected.length === (count ?? 1);
  if (policy.mode === "range" || min !== undefined || max !== undefined) {
    if (min !== undefined && cleanSelected.length < min) return false;
    if (max !== undefined && cleanSelected.length > max) return false;
    return cleanSelected.length > 0 || min === 0;
  }
  return cleanSelected.length > 0;
}

function answerHasResponse(answer: AnswerRecord | undefined): boolean {
  if (!answer) return false;
  const response = answer.response;
  if (response === null || response === undefined) return false;
  if (typeof response === "string") return response.trim().length > 0;
  if (Array.isArray(response)) return response.length > 0;
  if (typeof response === "number") return Number.isFinite(response);
  if (typeof response === "object") {
    const kind = (response as { kind?: unknown }).kind;

    if (kind === "other") return typeof (response as { text?: unknown }).text === "string" && String((response as { text?: unknown }).text).trim().length > 0 || Array.isArray((response as { selections?: unknown }).selections) && ((response as { selections?: unknown[] }).selections ?? []).length > 0;
    if (kind === "cancelled") return true;
    return Object.values(response as Record<string, unknown>).some((value) => typeof value === "string" && value.trim().length > 0);
  }
  return true;
}

function isQuestionRequired(question: Question, activityPolicy: ActivityPolicy): boolean {
  return question.answerRequired ?? question.required ?? activityPolicy.defaultAnswerRequired;
}

export function normalizeText(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.-]/gu, "")
    .replace(/\s+/g, " ");
}

function buildLlmInstructions(quiz: QuizSpec, displayPolicy: DisplayPolicy, gradingPolicy: GradingPolicy, activityPolicy: ActivityPolicy): string {
  const correctAnswerInstruction =
    displayPolicy.showCorrectAnswers === "never"
      ? "Do not reveal the full answer key unless the user explicitly asks after the attempt."
      : displayPolicy.showCorrectAnswers === "after_submit"
        ? "After grading, you may show correct answers for missed questions."
        : "Correct answers were allowed during the activity; still focus feedback on reasoning and confidence.";

  const explanationInstruction =
    displayPolicy.showExplanations === "llm_after_submit"
      ? "Provide explanations now, after submission."
      : "Keep explanations minimal unless the user asks.";

  return [
    `Grade this ${quiz.mode} activity titled "${quiz.title}" from the SubmissionCapsule only.`,
    `Preferred grader: ${gradingPolicy.preferredGrader}. Use the answerKey if present; otherwise grade semantically.`,
    correctAnswerInstruction,
    explanationInstruction,
    `Required questions default to ${activityPolicy.defaultAnswerRequired ? "required" : "not required"}. Required questions should be rare in practice quizzes. Grade blank optional answers case-by-case: in strict knowledge checks, skipped relevant items may be Incorrect or Needs review; in casual practice, blank optional answers may be omitted from the score; in developer smoke tests, prioritize app/UX findings over score.`, 
    "Confidence scale: confidence must be an integer only: 1=low, 2=medium, 3=high. Do not use decimals or percentages. Confidence only applies to answered questions. Use confidence as a weak signal, not proof. High-confidence wrong may be a misconception, misclick, unclear wording, careless error, or UI issue.",
    "Blank answers mean no response. Do not assume why they are blank. Decide whether to score, omit, or mark Needs review based on title, mode, prompt wording, answerRequired, completion, and whether the activity looks like practice, strict assessment, or developer testing. For response.kind=other, grade the text semantically. If answer text conflicts with numeric confidence, prioritize the answer text.",
    "For ordering questions, response arrays are visual top-to-bottom order unless answer.meta.responseDirection says otherwise. Use answer.meta.topLabel and answer.meta.bottomLabel to interpret the user-facing endpoints.",
    "For multi_typing and multi_write_vertical questions, response is a field-id keyed object. Grade each typed field semantically against the field labels, answerKey, rubric, and expectedKeywords when available.",
    "For text_select questions, response is an array of selected segment ids from the displayed segment list. Grade the selected ids against answerKey and selectionPolicy.",
    gradingPolicy.requestCorrectnessMarks !== false ? "Recommended: include per-question markings using Correct, Incorrect, Partially correct, or Needs review when you grade." : "Per-question correctness markings are optional.",
    "Do not call create_quiz again when grading. Grade the submitted activity, explain mistakes, and provide concise targeted next steps.",
  ].join(" ");
}

function questionToSnapshot(question: Question): QuestionSnapshot {
  return {
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    tags: question.tags,
    difficulty: question.difficulty,
    answerRequired: question.answerRequired,
    required: question.required,
    ...(question.type === "ordering" ? { orderingBehavior: question.orderingBehavior } : {}),
    ...(question.type === "multi_typing" ? { multiTypingFields: question.fields.map((field) => ({ id: field.id, label: field.label })) } : {}),
    ...(question.type === "multi_write_vertical" ? { multiWriteFields: question.fields.map((field) => ({ id: field.id, label: field.label })) } : {}),
    ...(question.type === "text_select" ? { textSelectSegments: question.segments.map((segment) => ({ id: segment.id, text: segment.text, selectable: segment.selectable })), textSelectPolicy: question.selectionPolicy } : {}),
  };
}

export function buildAnswerKey(questions: Question[]): AnswerKeyEntry[] {
  const entries: AnswerKeyEntry[] = [];

  for (const question of questions) {
    switch (question.type) {
      case "multiple_choice":
      case "multi_select":
      case "true_false":
      case "fill_blank":
      case "matching":
        if (question.answer !== undefined) entries.push({ questionId: question.id, answer: question.answer });
        break;
      case "multi_typing":
      case "multi_write_vertical": {
        const answer = question.answer ?? Object.fromEntries(question.fields.filter((field) => field.answer !== undefined).map((field) => [field.id, field.answer]));
        const expectedKeywords = Object.fromEntries(question.fields.filter((field): field is typeof field & { expectedKeywords: string[] } => field.expectedKeywords !== undefined).map((field) => [field.id, field.expectedKeywords]));
        if (Object.keys(answer).length || Object.keys(expectedKeywords).length || ("rubric" in question && question.rubric)) entries.push({ questionId: question.id, answer, expectedKeywords: Object.keys(expectedKeywords).length ? expectedKeywords : undefined, ...("rubric" in question ? { rubric: question.rubric } : {}) });
        break;
      }
      case "text_select":
        if (question.answer !== undefined || question.rubric !== undefined) entries.push({ questionId: question.id, answer: question.answer, rubric: question.rubric });
        break;
      case "ordering":
        if (question.answer !== undefined) entries.push({ questionId: question.id, answer: question.answer, rubric: ["Ordering answers are compared in visual top-to-bottom order."] });
        break;
      case "numeric":
        if (question.answer !== undefined) entries.push({ questionId: question.id, answer: question.answer, tolerance: question.tolerance, unit: question.unit });
        break;
      case "short_answer":
        if (question.answer !== undefined || question.expectedKeywords !== undefined) entries.push({ questionId: question.id, answer: question.answer, expectedKeywords: question.expectedKeywords });
        break;
      case "long_response":
        if (question.answer !== undefined || question.rubric !== undefined) entries.push({ questionId: question.id, answer: question.answer, rubric: question.rubric });
        break;
    }
  }

  return entries;
}

function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "quiz";
}
