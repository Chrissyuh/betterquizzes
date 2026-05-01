export type QuizMode = "practice" | "test" | "survey";

export type QuestionType =
  | "multiple_choice"
  | "multi_select"
  | "true_false"
  | "fill_blank"
  | "short_answer"
  | "long_response"
  | "multi_typing"
  | "multi_write_vertical"
  | "text_select"
  | "matching"
  | "ordering"
  | "numeric";

export type ShowCorrectAnswersPolicy = "instant" | "after_submit" | "never";
export type ShowExplanationsPolicy = "llm_after_submit" | "never";
export type PreferredGrader = "llm" | "local" | "hybrid";
export type CorrectnessStatus = "correct" | "incorrect" | "partially_correct" | "needs_review";
export type CorrectnessMark = { status: CorrectnessStatus; note?: string; score?: number; maxScore?: number };

export type DisplayPolicy = {
  showCorrectAnswers: ShowCorrectAnswersPolicy;
  showExplanations: ShowExplanationsPolicy;
  requireConfidence: boolean;
};

export type GradingPolicy = {
  preferredGrader: PreferredGrader;
  includeAnswerKeyInSubmission?: boolean;
  /** Ask ChatGPT to include per-question Correct / Incorrect / Partially correct markings in its reply when useful. */
  requestCorrectnessMarks?: boolean;
};

export type ActivityPolicy = {
  /** Canonical: allow the user to stop the quiz without submitting answers for grading. */
  allowSkipQuiz: boolean;
  /** Legacy alias for allowSkipQuiz. Kept only so older widget code still works. */
  allowCancel: boolean;
  /** Allow moving past unanswered required questions. Final submission still requires required items unless submitRequiresRequiredAnswers is false. */
  allowSkipQuestions: boolean;
  /** Canonical: default requirement when a question does not set answerRequired explicitly. */
  defaultAnswerRequired: boolean;
  /** Legacy alias for defaultAnswerRequired. */
  defaultQuestionRequired: boolean;
  /** Canonical: disable final submit until all required questions are complete. */
  submitRequiresRequiredAnswers: boolean;
  /** Legacy alias for submitRequiresRequiredAnswers. */
  submitRequiresAllRequired: boolean;
};

export const DEFAULT_DISPLAY_POLICY: DisplayPolicy = {
  showCorrectAnswers: "after_submit",
  showExplanations: "llm_after_submit",
  requireConfidence: true,
};

export const DEFAULT_GRADING_POLICY: GradingPolicy = {
  preferredGrader: "llm",
  includeAnswerKeyInSubmission: true,
  requestCorrectnessMarks: true,
};

export const DEFAULT_ACTIVITY_POLICY: ActivityPolicy = {
  allowSkipQuiz: true,
  allowCancel: true,
  allowSkipQuestions: true,
  defaultAnswerRequired: false,
  defaultQuestionRequired: true,
  submitRequiresRequiredAnswers: true,
  submitRequiresAllRequired: true,
};

export type QuizMetadata = {
  createdBy?: "llm" | "human" | "imported";
  sourceModel?: string;
  createdAt?: string;
  estimatedTimeMinutes?: number;
  tags?: string[];
};

export type ChoiceBehavior = {
  /** Add an Other textbox choice. Unanswered items remain blank; Other can capture custom answers. */
  allowOther?: boolean;
  otherLabel?: string;
};

export type ResponseLimit = {
  /** Maximum characters allowed for text input. Omit or set null for unlimited. */
  maxChars?: number | null;
  /** Optional minimum length guidance for the LLM/user interface. */
  minChars?: number;
  /** Optional override. Unlimited fields never show a fraction/counter. */
  showCounter?: boolean;
};

export type OrderingBehavior = {
  /** Submission arrays are interpreted in the visual order the user sees. */
  direction?: "top_to_bottom";
  topLabel?: string;
  bottomLabel?: string;
};

export type QuizSpec = {
  schema: "betterquizzer.quiz";
  version: 2;
  quizId?: string;
  title: string;
  description?: string;
  subject?: string;
  mode: QuizMode;
  displayPolicy?: Partial<DisplayPolicy>;
  gradingPolicy?: Partial<GradingPolicy>;
  activityPolicy?: Partial<ActivityPolicy>;
  /** Quiz-level default choice customization controlled by the LLM. */
  choiceBehavior?: ChoiceBehavior;
  questions: Question[];
  metadata?: QuizMetadata;
};

export type BaseQuestion = {
  id: string;
  type: QuestionType;
  prompt: string;
  tags?: string[];
  difficulty?: 1 | 2 | 3 | 4 | 5;
  points?: number;
  /** Defaults to activityPolicy.defaultAnswerRequired. */
  answerRequired?: boolean;
  /**  Use answerRequired. Retained for older quizzes. */
  required?: boolean;
  /** Per-question choice customization controlled by the LLM. */
  choiceBehavior?: ChoiceBehavior;
  /** AI-configurable text response limits. Omit or set maxChars:null for unlimited. */
  responseLimit?: ResponseLimit;
};

export type MultipleChoiceQuestion = BaseQuestion & { type: "multiple_choice"; choices: string[]; answer?: number };
export type MultiSelectQuestion = BaseQuestion & { type: "multi_select"; choices: string[]; answer?: number[] };
export type TrueFalseQuestion = BaseQuestion & { type: "true_false"; answer?: boolean };
export type FillBlankQuestion = BaseQuestion & { type: "fill_blank"; answer?: string | string[]; placeholder?: string };
export type ShortAnswerQuestion = BaseQuestion & { type: "short_answer"; answer?: string | string[]; expectedKeywords?: string[] };
export type LongResponseQuestion = BaseQuestion & { type: "long_response"; answer?: string; rubric?: string[] };

export type MultiTypingField = {
  id: string;
  label: string;
  placeholder?: string;
  responseLimit?: ResponseLimit;
  answer?: string | string[];
  acceptableAnswers?: string[];
  expectedKeywords?: string[];
};
export type MultiTypingQuestion = BaseQuestion & {
  type: "multi_typing";
  fields: MultiTypingField[];
  /** Optional field-id keyed answer map, e.g. {push:"war", pull:"jobs"}. */
  answer?: Record<string, string | string[]>;
};

export type MultiWriteVerticalQuestion = BaseQuestion & {
  type: "multi_write_vertical";
  /** One or more vertically stacked text-writing fields. Use this when the prompt asks for several named written parts. */
  fields: MultiTypingField[];
  answer?: Record<string, string | string[]>;
  rubric?: string[];
};

export type TextSelectPolicy = {
  mode?: "exact_count" | "all_that_apply" | "range";
  /** For exact_count, the number of selectable segments the user must choose before confidence unlocks. */
  count?: number;
  /** For range/all_that_apply, optional minimum number of selected segments. */
  min?: number;
  /** Optional maximum number of selected segments. */
  max?: number;
  /** User-facing helper text, e.g. "Select two causes" or "Select all that apply." */
  instruction?: string;
};

export type TextSelectSegment = {
  id: string;
  text: string;
  /** Set false for connector/static text that should display inline but not be selectable. Defaults to true. */
  selectable?: boolean;
};

export type TextSelectQuestion = BaseQuestion & {
  type: "text_select";
  /** Optional heading/passage text. Inline segments are rendered below this if provided. */
  text?: string;
  segments: TextSelectSegment[];
  selectionPolicy?: TextSelectPolicy;
  answer?: string[];
  rubric?: string[];
};

export type MatchItem = { id: string; text: string };
export type MatchingPair = { leftId: string; rightId: string };
export type MatchingQuestion = BaseQuestion & { type: "matching"; left: MatchItem[]; right: MatchItem[]; answer?: MatchingPair[] };
export type OrderingItem = { id: string; text: string };
export type OrderingQuestion = BaseQuestion & { type: "ordering"; items: OrderingItem[]; answer?: string[]; orderingBehavior?: OrderingBehavior };
export type NumericQuestion = BaseQuestion & { type: "numeric"; answer?: number; tolerance?: number; unit?: string };

export type Question =
  | MultipleChoiceQuestion
  | MultiSelectQuestion
  | TrueFalseQuestion
  | FillBlankQuestion
  | ShortAnswerQuestion
  | LongResponseQuestion
  | MultiTypingQuestion
  | MultiWriteVerticalQuestion
  | TextSelectQuestion
  | MatchingQuestion
  | OrderingQuestion
  | NumericQuestion;

export type SpecialResponse = { kind: "other"; text: string } | { kind: "cancelled"; reason?: string };
export type MultiTypingResponse = Record<string, string>;
export type TextSelectResponse = string[];
export type AnswerResponse = number | number[] | boolean | string | string[] | MatchingPair[] | MultiTypingResponse | TextSelectResponse | SpecialResponse | null;

export type AnswerRecord = {
  questionId: string;
  response: AnswerResponse;
  timeMs?: number;
  confidence?: 1 | 2 | 3;
  /** Optional metadata for platform-added answers such as Other. */
  meta?: Record<string, unknown>;
  /** Optional future/AI-provided mark; the widget does not rely on this for local grading. */
  correctness?: CorrectnessMark;
};

export type QuizSession = {
  schema: "betterquizzer.session";
  version: 2;
  sessionId: string;
  quizId: string;
  startedAt: string;
  submittedAt?: string;
  mode: QuizMode;
  answers: AnswerRecord[];
};

export type QuestionSnapshot = {
  id: string;
  type: QuestionType;
  prompt: string;
  tags?: string[];
  difficulty?: 1 | 2 | 3 | 4 | 5;
  answerRequired?: boolean;
  required?: boolean;
  orderingBehavior?: OrderingBehavior;
  multiTypingFields?: { id: string; label: string }[];
  multiWriteFields?: { id: string; label: string }[];
  textSelectSegments?: { id: string; text: string; selectable?: boolean }[];
  textSelectPolicy?: TextSelectPolicy;
};

export type AnswerKeyEntry = {
  questionId: string;
  answer: unknown;
  rubric?: string[];
  expectedKeywords?: string[] | Record<string, string[]>;
  tolerance?: number;
  unit?: string;
};


export type SubmissionCompletionSummary = {
  requiredTotal: number;
  requiredAnswered: number;
  optionalTotal: number;
  optionalAnswered: number;
  missingRequiredQuestionIds: string[];
  missingRequiredConfidenceIds: string[];
  isComplete: boolean;
};

export type SubmissionStatus = {
  localSaved: boolean;
  hostSubmitted: boolean;
  followUpRequested: boolean;
  duplicateSubmission: boolean;
  warnings: string[];
};

export type SubmissionCapsule = {
  schema: "betterquizzer.submission";
  version: 2;
  quizId: string;
  sessionId: string;
  title: string;
  subject?: string;
  mode: QuizMode;
  submittedAt: string;
  displayPolicy: DisplayPolicy;
  gradingPolicy: GradingPolicy;
  activityPolicy: ActivityPolicy;
  completion: SubmissionCompletionSummary;
  status?: SubmissionStatus;
  questions: QuestionSnapshot[];
  answers: AnswerRecord[];
  answerKey?: AnswerKeyEntry[];
  llmInstructions: string;
};


