import {
  DEFAULT_ACTIVITY_POLICY,
  DEFAULT_DISPLAY_POLICY,
  DEFAULT_GRADING_POLICY,
  type ActivityPolicy,
  type DisplayPolicy,
  type GradingPolicy,
  type QuizSession,
  type QuizSpec,
} from "./types";

export type ValidationResult<T> =
  | { ok: true; value: T; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

const QUESTION_TYPES = new Set([
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

export function normalizeDisplayPolicy(policy?: Partial<DisplayPolicy>): DisplayPolicy {
  return { ...DEFAULT_DISPLAY_POLICY, ...(policy ?? {}) };
}

export function normalizeGradingPolicy(policy?: Partial<GradingPolicy>): GradingPolicy {
  return { ...DEFAULT_GRADING_POLICY, ...(policy ?? {}) };
}

export function normalizeActivityPolicy(policy?: Partial<ActivityPolicy>): ActivityPolicy {
  const incoming = policy ?? {};
  const allowSkipQuiz = incoming.allowSkipQuiz ?? incoming.allowCancel ?? DEFAULT_ACTIVITY_POLICY.allowSkipQuiz;
  const allowSkipQuestions = incoming.allowSkipQuestions ?? DEFAULT_ACTIVITY_POLICY.allowSkipQuestions;
  const defaultAnswerRequired = incoming.defaultAnswerRequired ?? incoming.defaultQuestionRequired ?? DEFAULT_ACTIVITY_POLICY.defaultAnswerRequired;
  const submitRequiresRequiredAnswers = incoming.submitRequiresRequiredAnswers ?? incoming.submitRequiresAllRequired ?? DEFAULT_ACTIVITY_POLICY.submitRequiresRequiredAnswers;
  return {
    allowSkipQuiz,
    allowCancel: allowSkipQuiz,
    allowSkipQuestions,
    defaultAnswerRequired,
    defaultQuestionRequired: defaultAnswerRequired,
    submitRequiresRequiredAnswers,
    submitRequiresAllRequired: submitRequiresRequiredAnswers,
  };
}

export function validateQuizSpec(input: unknown): ValidationResult<QuizSpec> {
  const quiz = input as Record<string, unknown>;
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!quiz || typeof quiz !== "object" || Array.isArray(quiz)) {
    return { ok: false, errors: ["Quiz must be an object."], warnings };
  }

  if (quiz.schema !== "betterquizzer.quiz") errors.push("schema must be 'betterquizzer.quiz'.");
  if (quiz.version !== 2) errors.push("version must be 2.");
  if (!nonEmpty(quiz.title)) errors.push("title must be a non-empty string.");
  if (!["practice", "test", "survey"].includes(String(quiz.mode))) errors.push("mode must be practice, test, or survey.");
  if (!Array.isArray(quiz.questions) || quiz.questions.length === 0) errors.push("questions must be a non-empty array.");

  const ids = new Set<string>();
  if (Array.isArray(quiz.questions)) {
    quiz.questions.forEach((rawQuestion, index) => {
      const question = rawQuestion as Record<string, unknown>;
      const prefix = `questions[${index}]`;
      if (!question || typeof question !== "object" || Array.isArray(question)) {
        errors.push(`${prefix} must be an object.`);
        return;
      }
      if (!nonEmpty(question.id)) errors.push(`${prefix}.id must be a non-empty string.`);
      else if (ids.has(question.id)) errors.push(`Duplicate question id '${question.id}'.`);
      else ids.add(question.id);

      if (!QUESTION_TYPES.has(String(question.type))) errors.push(`${prefix}.type is unsupported.`);
      if (!nonEmpty(question.prompt)) errors.push(`${prefix}.prompt must be a non-empty string.`);
      if (question.answerRequired !== undefined && typeof question.answerRequired !== "boolean") errors.push(`${prefix}.answerRequired must be boolean when provided.`);
      if (question.required !== undefined && typeof question.required !== "boolean") errors.push(`${prefix}.required must be boolean when provided.`);
      if (question.responseLimit !== undefined) {
        const limit = question.responseLimit as Record<string, unknown> | null;
        if (limit !== null && (typeof limit !== "object" || Array.isArray(limit))) {
          errors.push(`${prefix}.responseLimit must be an object or null.`);
        } else if (limit && limit.maxChars !== undefined && limit.maxChars !== null && (!Number.isInteger(limit.maxChars) || Number(limit.maxChars) < 1)) {
          errors.push(`${prefix}.responseLimit.maxChars must be a positive integer, null, or omitted.`);
        }
      }

      if (question.type === "multiple_choice" || question.type === "multi_select") {
        if (!Array.isArray(question.choices) || question.choices.length < 1) errors.push(`${prefix}.choices must contain at least one choice.`);
      }
      if (question.type === "multi_typing" || question.type === "multi_write_vertical") {
        const minimumFields = question.type === "multi_typing" ? 2 : 1;
        if (!Array.isArray(question.fields) || question.fields.length < minimumFields) errors.push(`${prefix}.fields must contain at least ${minimumFields} typing field${minimumFields === 1 ? "" : "s"}.`);
        else question.fields.forEach((field, fieldIndex) => {
          const fieldPrefix = `${prefix}.fields[${fieldIndex}]`;
          if (!field || typeof field !== "object" || Array.isArray(field)) errors.push(`${fieldPrefix} must be an object.`);
          else {
            const record = field as Record<string, unknown>;
            if (!nonEmpty(record.id)) errors.push(`${fieldPrefix}.id must be a non-empty string.`);
            if (!nonEmpty(record.label)) errors.push(`${fieldPrefix}.label must be a non-empty string.`);
          }
        });
      }
      if (question.type === "text_select") {
        if (!Array.isArray(question.segments) || question.segments.length < 1) errors.push(`${prefix}.segments must contain at least one segment.`);
        else question.segments.forEach((segment, segmentIndex) => {
          const segmentPrefix = `${prefix}.segments[${segmentIndex}]`;
          if (!segment || typeof segment !== "object" || Array.isArray(segment)) errors.push(`${segmentPrefix} must be an object.`);
          else {
            const record = segment as Record<string, unknown>;
            if (!nonEmpty(record.id)) errors.push(`${segmentPrefix}.id must be a non-empty string.`);
            if (!nonEmpty(record.text)) errors.push(`${segmentPrefix}.text must be a non-empty string.`);
          }
        });
      }
      if (question.type === "matching") {
        if (!Array.isArray(question.left) || !Array.isArray(question.right)) errors.push(`${prefix}.left and ${prefix}.right must be arrays.`);
      }
      if (question.type === "ordering") {
        if (!Array.isArray(question.items) || question.items.length < 2) errors.push(`${prefix}.items must contain at least two items.`);
      }
    });
  }

  const displayPolicy = normalizeDisplayPolicy(quiz.displayPolicy as Partial<DisplayPolicy> | undefined);
  const gradingPolicy = normalizeGradingPolicy(quiz.gradingPolicy as Partial<GradingPolicy> | undefined);
  const activityPolicy = normalizeActivityPolicy(quiz.activityPolicy as Partial<ActivityPolicy> | undefined);
  if (!["instant", "after_submit", "never"].includes(displayPolicy.showCorrectAnswers)) errors.push("displayPolicy.showCorrectAnswers is invalid.");
  if (!["llm_after_submit", "never"].includes(displayPolicy.showExplanations)) errors.push("displayPolicy.showExplanations is invalid.");
  if (typeof displayPolicy.requireConfidence !== "boolean") errors.push("displayPolicy.requireConfidence must be boolean.");
  if (!["llm", "local", "hybrid"].includes(gradingPolicy.preferredGrader)) errors.push("gradingPolicy.preferredGrader is invalid.");
  if (typeof activityPolicy.allowSkipQuiz !== "boolean") errors.push("activityPolicy.allowSkipQuiz must be boolean.");
  if (typeof activityPolicy.allowSkipQuestions !== "boolean") errors.push("activityPolicy.allowSkipQuestions must be boolean.");
  if (typeof activityPolicy.defaultAnswerRequired !== "boolean") errors.push("activityPolicy.defaultAnswerRequired must be boolean.");
  if (typeof activityPolicy.submitRequiresRequiredAnswers !== "boolean") errors.push("activityPolicy.submitRequiresRequiredAnswers must be boolean.");

  if (gradingPolicy.preferredGrader === "llm" && displayPolicy.showCorrectAnswers === "instant") {
    warnings.push("Instant correct answers with an LLM grader may reduce practice value unless intentional.");
  }

  return errors.length ? { ok: false, errors, warnings } : { ok: true, value: input as QuizSpec, warnings };
}

export function validateQuizSession(input: unknown, quiz: QuizSpec): ValidationResult<QuizSession> {
  const session = input as Record<string, unknown>;
  const errors: string[] = [];
  const warnings: string[] = [];
  const questionIds = new Set(quiz.questions.map((question) => question.id));
  const displayPolicy = normalizeDisplayPolicy(quiz.displayPolicy);
  const activityPolicy = normalizeActivityPolicy(quiz.activityPolicy);

  if (!session || typeof session !== "object" || Array.isArray(session)) return { ok: false, errors: ["Session must be an object."], warnings };
  if (session.schema !== "betterquizzer.session") errors.push("session schema must be betterquizzer.session.");
  if (session.version !== 2) errors.push("session version must be 2.");
  if (!nonEmpty(session.sessionId)) errors.push("sessionId must be a non-empty string.");
  if (!Array.isArray(session.answers)) errors.push("answers must be an array.");

  if (Array.isArray(session.answers)) {
    session.answers.forEach((rawAnswer, index) => {
      const answer = rawAnswer as Record<string, unknown>;
      const question = quiz.questions.find((item) => item.id === String(answer?.questionId));
      if (!questionIds.has(String(answer?.questionId))) errors.push(`answers[${index}].questionId does not exist in quiz.`);
      if (!("response" in (answer ?? {}))) errors.push(`answers[${index}].response is required.`);
      const questionRequired = question ? question.answerRequired ?? question.required ?? activityPolicy.defaultAnswerRequired : true;
      if (questionRequired && displayPolicy.requireConfidence && answer?.response !== null && answer?.confidence === undefined) errors.push(`answers[${index}].confidence is required by displayPolicy.`);
      if (answer?.confidence !== undefined && ![1, 2, 3].includes(answer.confidence as 1 | 2 | 3)) errors.push(`answers[${index}].confidence must be an integer: 1=low, 2=medium, 3=high. Do not use decimals, percentages, or strings.`);
    });
  }

  return errors.length ? { ok: false, errors, warnings } : { ok: true, value: input as QuizSession, warnings };
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
