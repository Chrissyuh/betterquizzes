import {
  normalizeActivityPolicy,
  normalizeDisplayPolicy,
  normalizeGradingPolicy,
  validateQuizSpec,
} from "./schemas";
import type { ActivityPolicy, DisplayPolicy, GradingPolicy, QuestionType, QuizSpec } from "./types";

export type RenderNormalizedField = {
  path: string;
  from: string | null;
  to: string;
};

export type UnrenderableQuestion = {
  index: number;
  questionId: string;
  reason: string;
};

export type RenderDiagnostics = {
  questionCount: number;
  renderableQuestionCount: number;
  unrenderableQuestions: UnrenderableQuestion[];
  warnings: string[];
  rendererCertified: boolean;
  componentByQuestion: Record<string, string>;
  normalizedFields: RenderNormalizedField[];
};

export type RenderContractResult = {
  ok: boolean;
  quiz: QuizSpec;
  errors: string[];
  warnings: string[];
  diagnostics: RenderDiagnostics;
};

const SUPPORTED_QUESTION_TYPES = new Set<QuestionType>([
  "multiple_choice",
  "multi_select",
  "true_false",
  "fill_blank",
  "short_answer",
  "long_response",
  "multi_typing",
  "multi_write_vertical",
  "text_select",
  "matching",
  "ordering",
  "numeric",
]);

const QUESTION_TYPE_ALIASES = new Map<string, QuestionType>([
  ["multipleChoice", "multiple_choice"],
  ["multiple-choice", "multiple_choice"],
  ["mcq", "multiple_choice"],
  ["multiSelect", "multi_select"],
  ["multi-select", "multi_select"],
  ["trueFalse", "true_false"],
  ["true-false", "true_false"],
  ["fillBlank", "fill_blank"],
  ["fill-in-the-blank", "fill_blank"],
  ["shortAnswer", "short_answer"],
  ["short-answer", "short_answer"],
  ["longResponse", "long_response"],
  ["long-response", "long_response"],
  ["multiTyping", "multi_typing"],
  ["multi-typing", "multi_typing"],
  ["multi_input", "multi_typing"],
  ["multi-input", "multi_typing"],
  ["multiWriteVertical", "multi_write_vertical"],
  ["multi-write-vertical", "multi_write_vertical"],
  ["multi_write", "multi_write_vertical"],
  ["multi-write", "multi_write_vertical"],
  ["multiWrite", "multi_write_vertical"],
  ["textSelect", "text_select"],
  ["text-select", "text_select"],
  ["select_text", "text_select"],
  ["select-text", "text_select"],
]);

type MutableRecord = Record<string, unknown>;

type NormalizedChoices = {
  ids: string[];
  texts: string[];
};

export function normalizeQuizForRender(rawQuiz: unknown): QuizSpec {
  return prepareQuizForRender(rawQuiz).quiz;
}

export function prepareQuizForRender(input: unknown): RenderContractResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const normalizedFields: RenderNormalizedField[] = [];

  if (!isRecord(input)) {
    const diagnostics = emptyDiagnostics();
    return {
      ok: false,
      quiz: emptyQuiz(),
      errors: ["quiz must be an object in the tool argument shape { quiz: { ... } }."],
      warnings,
      diagnostics,
    };
  }

  const quiz = clone(input) as MutableRecord;
  if (quiz.schema !== "betterquizzer.quiz") errors.push("quiz.schema must be betterquizzer.quiz");
  if (quiz.version !== 2) errors.push("quiz.version must be 2");
  if (!isNonEmptyString(quiz.title)) errors.push("quiz.title must be a non-empty string");
  if (!["practice", "test", "survey"].includes(String(quiz.mode))) errors.push("quiz.mode must be practice, test, or survey");
  if (!Array.isArray(quiz.questions) || quiz.questions.length === 0) errors.push("quiz.questions must be a non-empty array");

  quiz.displayPolicy = normalizeDisplayPolicy(asPartial<DisplayPolicy>(quiz.displayPolicy));
  quiz.gradingPolicy = normalizeGradingPolicy(asPartial<GradingPolicy>(quiz.gradingPolicy));
  quiz.activityPolicy = normalizeActivityPolicy(asPartial<ActivityPolicy>(quiz.activityPolicy));

  const ids = new Set<string>();
  if (Array.isArray(quiz.questions)) {
    const normalizedQuestions = quiz.questions.map((raw, index) => normalizeQuestion(raw, index, warnings, normalizedFields));
    quiz.questions = normalizedQuestions;
    for (const [index, rawQuestion] of normalizedQuestions.entries()) {
      if (!isRecord(rawQuestion)) {
        errors.push(`questions[${index}] must be an object.`);
        continue;
      }
      if (!isNonEmptyString(rawQuestion.id)) {
        errors.push(`questions[${index}].id must be a non-empty string.`);
      } else if (ids.has(rawQuestion.id)) {
        errors.push(`duplicate question id ${rawQuestion.id}`);
      } else {
        ids.add(rawQuestion.id);
      }
      if (!isNonEmptyString(rawQuestion.prompt)) errors.push(`questions[${index}].prompt must be a non-empty string.`);
      if (!SUPPORTED_QUESTION_TYPES.has(String(rawQuestion.type) as QuestionType)) errors.push(`questions[${index}].type unsupported: ${String(rawQuestion.type)}`);
    }
  }

  const normalizedQuiz = quiz as QuizSpec;
  const schemaValidation = validateQuizSpec(normalizedQuiz);
  if (!schemaValidation.ok) {
    for (const error of schemaValidation.errors) {
      if (!errors.includes(error)) errors.push(error);
    }
  }

  const diagnostics = getRenderDiagnostics(normalizedQuiz, warnings, normalizedFields);
  for (const item of diagnostics.unrenderableQuestions) {
    const error = `${item.questionId || item.index}: ${item.reason}`;
    if (!errors.includes(error)) errors.push(error);
  }

  return {
    ok: errors.length === 0 && diagnostics.rendererCertified,
    quiz: normalizedQuiz,
    errors,
    warnings: diagnostics.warnings,
    diagnostics,
  };
}

export function validateRenderableQuiz(quiz: unknown): RenderDiagnostics {
  return getRenderDiagnostics(quiz);
}

export function getRenderDiagnostics(quiz: unknown, inheritedWarnings: string[] = [], normalizedFields: RenderNormalizedField[] = []): RenderDiagnostics {
  const warnings = [...inheritedWarnings];
  const unrenderableQuestions: UnrenderableQuestion[] = [];
  const componentByQuestion: Record<string, string> = {};
  const answerKeyWarnings: string[] = [];
  const questions = isRecord(quiz) && Array.isArray(quiz.questions) ? quiz.questions : [];

  questions.forEach((rawQuestion, index) => {
    const questionId = isRecord(rawQuestion) && isNonEmptyString(rawQuestion.id) ? rawQuestion.id : `questions[${index}]`;
    if (!isRecord(rawQuestion)) {
      unrenderableQuestions.push({ index, questionId, reason: "Question is not an object." });
      return;
    }
    if (!isNonEmptyString(rawQuestion.id)) unrenderableQuestions.push({ index, questionId, reason: "Missing required field: id." });
    if (!isNonEmptyString(rawQuestion.prompt)) unrenderableQuestions.push({ index, questionId, reason: "Missing required field: prompt." });
    if (!SUPPORTED_QUESTION_TYPES.has(String(rawQuestion.type) as QuestionType)) {
      unrenderableQuestions.push({ index, questionId, reason: `Unsupported type: ${String(rawQuestion.type)}.` });
      return;
    }

    const type = rawQuestion.type as QuestionType;
    componentByQuestion[questionId] = rendererComponentForType(type);
    if ((type === "multiple_choice" || type === "multi_select") && !hasRenderableChoices(rawQuestion.choices)) {
      unrenderableQuestions.push({ index, questionId, reason: "Choice question requires choices: string[] with at least one non-empty choice." });
    }
    if (type === "multi_typing" && (!Array.isArray((rawQuestion as { fields?: unknown }).fields) || (rawQuestion as { fields?: unknown[] }).fields!.length < 2 || !(rawQuestion as { fields?: unknown[] }).fields!.every(isRenderableTypingField))) {
      unrenderableQuestions.push({ index, questionId, reason: "Multi-typing question requires fields: {id,label}[] with at least two valid fields." });
    }
    if (type === "multi_write_vertical" && (!Array.isArray((rawQuestion as { fields?: unknown }).fields) || (rawQuestion as { fields?: unknown[] }).fields!.length < 1 || !(rawQuestion as { fields?: unknown[] }).fields!.every(isRenderableTypingField))) {
      unrenderableQuestions.push({ index, questionId, reason: "Multi-write vertical question requires fields: {id,label}[] with at least one valid field." });
    }
    if (type === "text_select" && (!Array.isArray((rawQuestion as { segments?: unknown }).segments) || (rawQuestion as { segments?: unknown[] }).segments!.length < 1 || !(rawQuestion as { segments?: unknown[] }).segments!.every(isRenderableTextSelectSegment))) {
      unrenderableQuestions.push({ index, questionId, reason: "Text-select question requires segments: {id,text,selectable?}[] with at least one valid segment." });
    }
    if (type === "matching" && (!Array.isArray(rawQuestion.left) || !Array.isArray(rawQuestion.right) || rawQuestion.left.length < 1 || rawQuestion.right.length < 1 || !rawQuestion.left.every(isRenderableItem) || !rawQuestion.right.every(isRenderableItem))) {
      unrenderableQuestions.push({ index, questionId, reason: "Matching question requires left and right arrays of {id,text} items." });
    }
    if (type === "ordering" && (!Array.isArray(rawQuestion.items) || rawQuestion.items.length < 2 || !rawQuestion.items.every(isRenderableItem))) {
      unrenderableQuestions.push({ index, questionId, reason: "Ordering question requires items: {id,text}[] with at least two valid items." });
    }
    validateAnswerShape(rawQuestion, questionId, answerKeyWarnings);
  });

  return {
    questionCount: questions.length,
    renderableQuestionCount: Math.max(0, questions.length - unrenderableQuestions.length),
    unrenderableQuestions,
    warnings: [...warnings, ...answerKeyWarnings],
    rendererCertified: questions.length > 0 && unrenderableQuestions.length === 0,
    componentByQuestion,
    normalizedFields,
  };
}

export function formatRenderContractIssue(result: Pick<RenderContractResult, "errors" | "diagnostics" | "warnings">): string {
  const lines = ["Quiz setup issue"];
  if (result.errors.length) lines.push("Errors:", ...result.errors.map((error) => `- ${error}`));
  if (result.diagnostics.unrenderableQuestions.length) {
    lines.push(
      "Unrenderable questions:",
      ...result.diagnostics.unrenderableQuestions.map((item) => `- ${item.questionId}: ${item.reason}`),
    );
  }
  if (result.warnings.length) lines.push("Warnings:", ...result.warnings.map((warning) => `- ${warning}`));
  return lines.join("\n");
}

function normalizeQuestion(raw: unknown, index: number, warnings: string[], normalizedFields: RenderNormalizedField[]): unknown {
  if (!isRecord(raw)) return raw;
  const question: MutableRecord = { ...raw };

  if (!question.id && question.questionId !== undefined) {
    question.id = String(question.questionId);
    warnings.push(`questions[${index}]: normalized questionId to id.`);
    normalizedFields.push({ path: `questions[${index}]`, from: "questionId", to: "id" });
  }

  if (!question.prompt) {
    const promptAliasName = question.stem !== undefined ? "stem" : question.question !== undefined ? "question" : question.text !== undefined ? "text" : question.title !== undefined ? "title" : null;
    const promptAlias = question.stem ?? question.question ?? question.text ?? question.title;
    if (typeof promptAlias === "string") {
      question.prompt = promptAlias;
      warnings.push(`questions[${index}]: normalized ${promptAliasName} to prompt.`);
      normalizedFields.push({ path: `questions[${index}]`, from: promptAliasName, to: "prompt" });
    }
  }

  if (typeof question.type === "string" && QUESTION_TYPE_ALIASES.has(question.type)) {
    const fromType = question.type;
    question.type = QUESTION_TYPE_ALIASES.get(question.type);
    warnings.push(`questions[${index}]: normalized question type alias ${fromType} to ${String(question.type)}.`);
    normalizedFields.push({ path: `questions[${index}].type`, from: fromType, to: String(question.type) });
  }

  if (question.answerRequired === undefined && question.required !== undefined) {
    question.answerRequired = question.required;
    normalizedFields.push({ path: `questions[${index}]`, from: "required", to: "answerRequired" });
  }

  if (question.answer === undefined) {
    if (question.correctAnswer !== undefined) {
      question.answer = question.correctAnswer;
      warnings.push(`questions[${index}]: normalized correctAnswer to answer.`);
      normalizedFields.push({ path: `questions[${index}]`, from: "correctAnswer", to: "answer" });
    } else if (question.answerKey !== undefined) {
      question.answer = question.answerKey;
      warnings.push(`questions[${index}]: normalized answerKey to answer.`);
      normalizedFields.push({ path: `questions[${index}]`, from: "answerKey", to: "answer" });
    }
  }

  if (question.answer === undefined && Array.isArray(question.acceptedAnswers) && (question.type === "fill_blank" || question.type === "short_answer")) {
    question.answer = question.acceptedAnswers;
    warnings.push(`questions[${index}]: normalized acceptedAnswers to answer.`);
    normalizedFields.push({ path: `questions[${index}]`, from: "acceptedAnswers", to: "answer" });
  }

  if ((question.type === "multiple_choice" || question.type === "multi_select") && !question.choices && question.options) {
    question.choices = question.options;
    warnings.push(`questions[${index}]: normalized options to choices.`);
    normalizedFields.push({ path: `questions[${index}]`, from: "options", to: "choices" });
  }

  if ((question.type === "multiple_choice" || question.type === "multi_select") && Array.isArray(question.choices)) {
    const normalized = normalizeChoices(question.choices, index, warnings);
    question.choices = normalized.texts;
    if (question.type === "multiple_choice" && question.answer !== undefined) {
      question.answer = normalizeChoiceAnswer(question.answer, normalized, warnings, index);
    }
    if (question.type === "multi_select" && Array.isArray(question.answer)) {
      question.answer = question.answer
        .map((answer) => normalizeChoiceAnswer(answer, normalized, warnings, index))
        .filter((value): value is number => Number.isInteger(value));
    }
  }

  if ((question.type === "multi_typing" || question.type === "multi_write_vertical") && Array.isArray(question.fields)) {
    question.fields = question.fields.map((field, fieldIndex) => normalizeTypingField(field, fieldIndex));
  }

  if (question.type === "text_select") {
    if (!Array.isArray(question.segments) && Array.isArray(question.selectableSegments)) {
      question.segments = question.selectableSegments;
      warnings.push(`questions[${index}]: normalized selectableSegments to segments.`);
      normalizedFields.push({ path: `questions[${index}]`, from: "selectableSegments", to: "segments" });
    }
    if (Array.isArray(question.segments)) question.segments = normalizeTextSelectSegments(question.segments);
    question.selectionPolicy = normalizeTextSelectPolicy(question.selectionPolicy ?? question.selectPolicy ?? question.selection ?? question.select);
    if (!isRecord(raw.selectionPolicy)) normalizedFields.push({ path: `questions[${index}].selectionPolicy`, from: null, to: "selectionPolicy" });
  }

  if (question.type === "ordering") {
    const normalizedOrdering = normalizeOrderingBehavior(question.orderingBehavior, question.prompt);
    question.orderingBehavior = normalizedOrdering;
    if (!isRecord(raw) || !isRecord(raw.orderingBehavior)) {
      normalizedFields.push({ path: `questions[${index}].orderingBehavior`, from: "prompt", to: "orderingBehavior" });
    }
  }

  return question;
}

function normalizeTypingField(field: unknown, fieldIndex: number): unknown {
  if (!isRecord(field)) return field;
  return {
    ...field,
    id: String(field.id ?? `field${fieldIndex + 1}`),
    label: String(field.label ?? field.id ?? `Field ${fieldIndex + 1}`),
  };
}

function normalizeTextSelectSegments(segments: unknown[]): unknown[] {
  return segments.map((segment, segmentIndex) => {
    if (typeof segment === "string") return { id: `segment${segmentIndex + 1}`, text: segment, selectable: true };
    if (!isRecord(segment)) return segment;
    return {
      ...segment,
      id: String(segment.id ?? `segment${segmentIndex + 1}`),
      text: String(segment.text ?? segment.label ?? segment.value ?? ""),
      selectable: segment.selectable === false ? false : true,
    };
  });
}

function normalizeTextSelectPolicy(raw: unknown): { mode: "exact_count" | "all_that_apply" | "range"; count?: number; min?: number; max?: number; instruction?: string } {
  const record = isRecord(raw) ? raw : {};
  const rawMode = String(record.mode ?? record.kind ?? record.selectionMode ?? "");
  const count = toPositiveInteger(record.count ?? record.selectCount ?? record.requiredSelections);
  const min = toNonNegativeInteger(record.min ?? record.minSelections);
  const max = toPositiveInteger(record.max ?? record.maxSelections);
  const mode = rawMode === "exact_count" || rawMode === "exact" || count !== undefined
    ? "exact_count"
    : rawMode === "range" || min !== undefined || max !== undefined
      ? "range"
      : "all_that_apply";
  const instruction = typeof record.instruction === "string" && record.instruction.trim() ? record.instruction.trim() : undefined;
  return { mode, ...(count !== undefined ? { count } : {}), ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), ...(instruction ? { instruction } : {}) };
}

function toPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function toNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function normalizeChoices(choices: unknown[], index: number, warnings: string[]): NormalizedChoices {
  const ids: string[] = [];
  const texts: string[] = [];

  choices.forEach((choice, choiceIndex) => {
    if (typeof choice === "string") {
      if (choice.trim()) {
        texts.push(choice);
        ids.push(String.fromCharCode(65 + choiceIndex));
      }
      return;
    }
    if (isRecord(choice)) {
      const id = choice.id != null ? String(choice.id) : String.fromCharCode(65 + choiceIndex);
      const text = choice.text ?? choice.label ?? choice.value ?? choice.id;
      if (["string", "number", "boolean"].includes(typeof text) && String(text).trim()) {
        texts.push(String(text));
        ids.push(id);
        warnings.push(`questions[${index}].choices[${choiceIndex}]: normalized object choice to text string.`);
      }
    }
  });

  return { ids, texts };
}

function normalizeChoiceAnswer(answer: unknown, normalizedChoices: NormalizedChoices, warnings: string[], questionIndex: number): unknown {
  if (typeof answer === "number" && Number.isInteger(answer)) return answer;
  if (typeof answer !== "string") return answer;

  const trimmed = answer.trim();
  const letterIndex = /^[A-Za-z]$/.test(trimmed) ? trimmed.toUpperCase().charCodeAt(0) - 65 : -1;
  if (letterIndex >= 0 && letterIndex < normalizedChoices.texts.length) {
    warnings.push(`questions[${questionIndex}]: normalized letter answer ${trimmed} to zero-based index ${letterIndex}.`);
    return letterIndex;
  }

  const idIndex = normalizedChoices.ids.findIndex((id) => id === trimmed);
  if (idIndex >= 0) {
    warnings.push(`questions[${questionIndex}]: normalized choice id answer ${trimmed} to zero-based index ${idIndex}.`);
    return idIndex;
  }

  const textIndex = normalizedChoices.texts.findIndex((text) => text.trim().toLowerCase() === trimmed.toLowerCase());
  if (textIndex >= 0) {
    warnings.push(`questions[${questionIndex}]: normalized answer text to zero-based index ${textIndex}.`);
    return textIndex;
  }

  return answer;
}

function normalizeOrderingBehavior(raw: unknown, prompt: unknown): { direction: "top_to_bottom"; topLabel: string; bottomLabel: string } {
  if (isRecord(raw)) {
    const topLabel = isNonEmptyString(raw.topLabel) ? raw.topLabel.trim() : undefined;
    const bottomLabel = isNonEmptyString(raw.bottomLabel) ? raw.bottomLabel.trim() : undefined;
    if (topLabel && bottomLabel) return { direction: "top_to_bottom", topLabel, bottomLabel };
  }
  return inferOrderingBehavior(typeof prompt === "string" ? prompt : "");
}

function inferOrderingBehavior(prompt: string): { direction: "top_to_bottom"; topLabel: string; bottomLabel: string } {
  const normalized = prompt.toLowerCase();
  if (normalized.includes("greatest to least") || normalized.includes("largest to smallest") || normalized.includes("highest to lowest")) return { direction: "top_to_bottom", topLabel: "Greatest", bottomLabel: "Least" };
  if (normalized.includes("least to greatest") || normalized.includes("smallest to largest") || normalized.includes("lowest to highest")) return { direction: "top_to_bottom", topLabel: "Least", bottomLabel: "Greatest" };
  if (normalized.includes("oldest to newest")) return { direction: "top_to_bottom", topLabel: "Oldest", bottomLabel: "Newest" };
  if (normalized.includes("newest to oldest")) return { direction: "top_to_bottom", topLabel: "Newest", bottomLabel: "Oldest" };
  if (normalized.includes("first to last")) return { direction: "top_to_bottom", topLabel: "First", bottomLabel: "Last" };
  return { direction: "top_to_bottom", topLabel: "First", bottomLabel: "Last" };
}

function validateAnswerShape(question: MutableRecord, questionId: string, warnings: string[]): void {
  const answer = question.answer;
  if (answer === undefined) {
    warnings.push(`${questionId}: no answer key provided; LLM can still grade open-ended answers if appropriate.`);
    return;
  }
  if (question.type === "multiple_choice" && !(typeof answer === "number" && Number.isInteger(answer) && Array.isArray(question.choices) && answer >= 0 && answer < question.choices.length)) warnings.push(`${questionId}: multiple_choice answer should be a valid zero-based choice index.`);
  if (question.type === "multi_select" && !(Array.isArray(answer) && answer.every((value) => typeof value === "number" && Number.isInteger(value) && Array.isArray(question.choices) && value >= 0 && value < question.choices.length))) warnings.push(`${questionId}: multi_select answer should be zero-based choice indexes.`);
  if (question.type === "true_false" && typeof question.answer !== "boolean") warnings.push(`${questionId}: true_false answer should be boolean.`);
  if (question.type === "numeric" && typeof question.answer !== "number") warnings.push(`${questionId}: numeric answer should be a number.`);
  if ((question.type === "fill_blank" || question.type === "short_answer") && !(typeof question.answer === "string" || Array.isArray(question.answer))) warnings.push(`${questionId}: ${String(question.type)} answer should be string or string[].`);
  if ((question.type === "multi_typing" || question.type === "multi_write_vertical") && !(isRecord(question.answer) || question.answer === undefined)) warnings.push(`${questionId}: ${String(question.type)} answer should be a field-id keyed object when provided.`);
  if (question.type === "text_select" && !(Array.isArray(question.answer) || question.answer === undefined)) warnings.push(`${questionId}: text_select answer should be an array of selected segment ids when provided.`);
  if (question.type === "ordering" && Array.isArray(question.items) && Array.isArray(question.answer)) {
    const ids = new Set(question.items.filter(isRecord).map((item) => item.id));
    if (!question.answer.every((id) => ids.has(id))) warnings.push(`${questionId}: ordering answer should contain only item ids from items[].`);
  }
  if (question.type === "matching" && Array.isArray(question.answer) && !question.answer.every((pair) => isRecord(pair) && typeof pair.leftId === "string" && typeof pair.rightId === "string")) warnings.push(`${questionId}: matching answer should be [{leftId,rightId}].`);
}

function hasRenderableChoices(value: unknown): boolean {
  return Array.isArray(value) && value.length >= 1 && value.every((choice) => typeof choice === "string" && choice.trim().length > 0);
}

function rendererComponentForType(type: QuestionType): string {
  return {
    multiple_choice: "MultipleChoiceQuestion",
    multi_select: "MultiSelectQuestion",
    true_false: "TrueFalseQuestion",
    fill_blank: "FillBlankQuestion",
    short_answer: "ShortAnswerQuestion",
    long_response: "LongResponseQuestion",
    multi_typing: "MultiTypingQuestion",
    multi_write_vertical: "MultiWriteVerticalQuestion",
    text_select: "TextSelectQuestion",
    numeric: "NumericQuestion",
    ordering: "OrderingQuestion",
    matching: "MatchingQuestion",
  }[type] ?? "UnsupportedQuestion";
}

function isRenderableItem(item: unknown): boolean {
  return isRecord(item) && isNonEmptyString(item.id) && isNonEmptyString(item.text);
}

function isRenderableTypingField(item: unknown): boolean {
  return isRecord(item) && isNonEmptyString(item.id) && isNonEmptyString(item.label);
}

function isRenderableTextSelectSegment(item: unknown): boolean {
  return isRecord(item) && isNonEmptyString(item.id) && isNonEmptyString(item.text);
}

function emptyDiagnostics(): RenderDiagnostics {
  return {
    questionCount: 0,
    renderableQuestionCount: 0,
    unrenderableQuestions: [],
    warnings: [],
    rendererCertified: false,
    componentByQuestion: {},
    normalizedFields: [],
  };
}

function emptyQuiz(): QuizSpec {
  return {
    schema: "betterquizzer.quiz",
    version: 2,
    title: "Invalid quiz",
    mode: "practice",
    questions: [],
  };
}

function clone(value: unknown): unknown {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function isRecord(value: unknown): value is MutableRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function asPartial<T>(value: unknown): Partial<T> | undefined {
  return isRecord(value) ? (value as Partial<T>) : undefined;
}
