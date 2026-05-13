import { normalizeQuizForRender, validateRenderableQuiz, type RenderDiagnostics } from "../shared";
import type { QuizSession, QuizSpec, SubmissionCapsule } from "../shared";

export type ToolResultLike = {
  structuredContent?: unknown;
  content?: unknown;
  _meta?: unknown;
};

export type SubmissionBridgeState = {
  kind: "betterquizzer.submission_state";
  status: "draft" | "submitting" | "submitted" | "requesting_grade" | "retrying_grade_request" | "grade_requested" | "fallback_ready" | "skipped" | "failed";
  quizId: string;
  launchId?: string;
  recoveryToken?: string;
  currentIndex?: number;
  drafts?: unknown;
  session?: QuizSession;
  submission?: SubmissionCapsule;
  hostResult?: ToolResultLike | null;
  error?: string;
  updatedAt: string;
};

export type DraftBridgeState = {
  kind: "betterquizzer.answer_state";
  status: "answering";
  quizId: string;
  launchId?: string;
  recoveryToken?: string;
  currentIndex?: number;
  drafts?: unknown;
  updatedAt: string;
};

export type FollowUpSendResult = {
  status: "sent" | "unavailable" | "timeout" | "failed";
  message?: string;
};

export type OpenAiBridge = {
  toolInput?: unknown;
  toolOutput?: unknown;
  toolResponseMetadata?: unknown;
  widgetState?: unknown;
  setWidgetState?: (state: unknown) => void;
  callTool?: (name: string, args: Record<string, unknown>) => Promise<ToolResultLike>;
  sendFollowUpMessage?: (message: { prompt: string; scrollToBottom?: boolean }) => Promise<void> | void;
  notifyIntrinsicHeight?: (height?: number) => void;
};

declare global {
  interface Window {
    openai?: OpenAiBridge;
    __BETTERQUIZZER_BOOTSTRAP__?: unknown;
    __BETTERQUIZZER_SERVER_BASE__?: string;
    __BETTERQUIZZER_FORCE_WIDGET__?: boolean;
  }
}

export type HostQuizPayload = {
  quiz: QuizSpec;
  source: "chatgpt-widget" | "server-bootstrap" | "standalone";
  launchId?: string;
  recoveryToken?: string;
  quizRevision?: number;
  questionCount?: number;
  declaredQuestionCount?: number;
  receivedQuestionCount?: number;
  uploadProgress?: { expectedQuestions: number; receivedQuestions: number; renderableQuestions?: number; complete?: boolean };
  launchSummary?: Record<string, unknown>;
  renderDiagnostics?: RenderDiagnostics;
};

type HostCandidate = {
  value: unknown;
  summary?: unknown;
  surface?: "sealed" | "toolInput" | "fallback";
};

export type HostQuizPayloadOptions = {
  /**
   * Allows a complete, locally render-certified toolInput.quiz to recover a widget
   * when the ChatGPT/tool response was interrupted before a sealed launch packet arrived.
   * This is intentionally opt-in so normal launches still prefer sealed tool output.
   */
  allowUnsealedToolInput?: boolean;
};

export function getOpenAiBridge(): OpenAiBridge | undefined {
  return typeof window !== "undefined" ? window.openai : undefined;
}

export function isChatGptWidget(): boolean {
  return Boolean(getOpenAiBridge());
}

export function getHostQuizPayload(options: HostQuizPayloadOptions = {}): HostQuizPayload | null {
  const bridge = getOpenAiBridge();
  const bootstrap = asRecord(typeof window !== "undefined" ? window.__BETTERQUIZZER_BOOTSTRAP__ : undefined);

  const bridgeCandidates = bridge ? getBridgeQuizCandidates(bridge) : [];
  for (const candidate of bridgeCandidates) {
    if (candidate.surface === "toolInput" && !options.allowUnsealedToolInput) continue;
    const payload = toHostQuizPayload(candidate, "chatgpt-widget");
    if (payload) return payload;
  }

  const bootstrapQuiz = findQuizDeep(bootstrap);
  if (bootstrapQuiz) {
    const payload = toHostQuizPayload({ value: bootstrapQuiz, summary: bootstrap }, "server-bootstrap");
    if (payload) return payload;
  }

  return null;
}

export async function callHostOpenQuizForUpdates(expectedQuizId: string, timeoutMs = 8000): Promise<HostQuizPayload | null> {
  const bridge = getOpenAiBridge();
  if (!bridge?.callTool) return null;

  const names = [
    "open_quiz",
    "betterquizzer.open_quiz",
    "BetterQuizzes.open_quiz",
  ];

  let lastError: unknown = null;
  for (const name of names) {
    try {
      const result = await withTimeout(bridge.callTool(name, {}), timeoutMs, `Timed out calling ${name}`);
      const payload = getHostQuizPayloadFromToolResult(result);
      if (payload && payload.quiz.quizId === expectedQuizId) return payload;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error && lastError.message.toLowerCase().includes("timed out")) throw lastError;
  return null;
}

function getHostQuizPayloadFromToolResult(result: ToolResultLike | null | undefined): HostQuizPayload | null {
  if (!result) return null;
  const fakeBridge: OpenAiBridge = {
    toolOutput: result,
    toolResponseMetadata: result._meta,
  };
  for (const candidate of getBridgeQuizCandidates(fakeBridge)) {
    const payload = toHostQuizPayload(candidate, "chatgpt-widget");
    if (payload) return payload;
  }
  return null;
}

export function describeHostBridgeState(): string {
  const bridge = getOpenAiBridge();
  const bootstrap = asRecord(typeof window !== "undefined" ? window.__BETTERQUIZZER_BOOTSTRAP__ : undefined);
  const candidates = bridge ? getBridgeQuizCandidates(bridge) : [];
  return JSON.stringify(
    {
      hasOpenAiBridge: Boolean(bridge),
      surfaces: {
        toolInput: Boolean(bridge?.toolInput),
        toolOutput: Boolean(bridge?.toolOutput),
        toolResponseMetadata: Boolean(bridge?.toolResponseMetadata),
        widgetState: Boolean(bridge?.widgetState),
        bootstrap: Boolean(bootstrap),
      },
      candidateCount: candidates.length,
      candidates: candidates.map((candidate) => {
        const summary = asRecord(candidate.summary);
        return {
          surface: candidate.surface ?? "sealed",
          kind: typeof summary?.kind === "string" ? summary.kind : null,
          hasQuiz: Boolean(findQuizDeep(candidate.value)),
        };
      }),
    },
    null,
    2
  );
}

export function persistWidgetState(state: unknown): void {
  const bridge = getOpenAiBridge();
  try {
    bridge?.setWidgetState?.(state);
    bridge?.notifyIntrinsicHeight?.();
  } catch {
    // Widget state should improve UX, never block the quiz.
  }
}

function getPersistedWidgetStateRecord(): Record<string, unknown> | null {
  return asRecord(getOpenAiBridge()?.widgetState);
}

export function getPersistedDraftState(quizId: string, launchId?: string): DraftBridgeState | null {
  const state = getPersistedWidgetStateRecord();
  if (!state) return null;
  const kind = state.kind;
  if (kind !== "betterquizzer.answer_state" && kind !== "betterquizzer.draft_state" && kind !== "betterquizzer.submission_state") return null;
  if (state.quizId !== quizId) return null;
  if (launchId && typeof state.launchId === "string" && state.launchId !== launchId) return null;

  // Terminal submissions must not be reinterpreted as editable drafts.
  // That was the cause of a submitted quiz reopening as "unsubmitted" after returning to the widget.
  if (kind === "betterquizzer.submission_state" && asSubmissionCapsule(state.submission)) return null;

  return {
    kind: "betterquizzer.answer_state",
    status: "answering",
    quizId,
    launchId: typeof state.launchId === "string" ? state.launchId : undefined,
    recoveryToken: typeof state.recoveryToken === "string" ? state.recoveryToken : undefined,
    currentIndex: typeof state.currentIndex === "number" && Number.isFinite(state.currentIndex) ? state.currentIndex : undefined,
    drafts: state.drafts,
    updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : new Date().toISOString(),
  };
}

export function getPersistedSubmissionState(quizId: string, launchId?: string): SubmissionBridgeState | null {
  const state = getPersistedWidgetStateRecord();
  if (!state || state.kind !== "betterquizzer.submission_state") return null;
  if (state.quizId !== quizId) return null;
  if (launchId && typeof state.launchId === "string" && state.launchId !== launchId) return null;

  const submission = asSubmissionCapsule(state.submission);
  if (!submission || submission.quizId !== quizId) return null;

  const status = asSubmissionBridgeStatus(state.status);
  if (status === "skipped") return null;

  return {
    kind: "betterquizzer.submission_state",
    status,
    quizId,
    launchId: typeof state.launchId === "string" ? state.launchId : undefined,
    recoveryToken: typeof state.recoveryToken === "string" ? state.recoveryToken : undefined,
    currentIndex: typeof state.currentIndex === "number" && Number.isFinite(state.currentIndex) ? state.currentIndex : undefined,
    drafts: state.drafts,
    session: asQuizSession(state.session),
    submission,
    hostResult: asToolResultLike(state.hostResult),
    error: typeof state.error === "string" ? state.error : undefined,
    updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : new Date().toISOString(),
  };
}

export function persistSubmissionState(state: Omit<SubmissionBridgeState, "kind" | "updatedAt">): void {
  persistWidgetState({
    kind: "betterquizzer.submission_state",
    ...state,
    updatedAt: new Date().toISOString(),
  });
}

export async function submitToHost(submission: SubmissionCapsule, timeoutMs = 8000): Promise<ToolResultLike | null> {
  const bridge = getOpenAiBridge();
  if (!bridge?.callTool) return null;

  const args = {
    quizId: submission.quizId,
    sessionId: submission.sessionId,
    answers: submission.answers,
    submission,
  };

  // Try unqualified and host-qualified names. Some hosts expose tool calls by short name,
  // some by server-prefixed name. Every attempt is time-boxed so the widget never hangs forever.
  const names = [
    "submit_answers",
    "record_submission",
    "betterquizzer.submit_answers",
    "BetterQuizzes.submit_answers",
    "BetterQuizzes.record_submission",
  ];
  let lastError: unknown = null;
  for (const name of names) {
    try {
      return await withTimeout(bridge.callTool(name, args), timeoutMs, `Timed out calling ${name}`);
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error("The host did not allow the widget to call submit_answers or record_submission.");
}

export async function sendSubmissionFollowUp(prompt: string, timeoutMs = 8000): Promise<FollowUpSendResult> {
  const bridge = getOpenAiBridge();
  const sendFollowUpMessage = bridge?.sendFollowUpMessage;

  if (!sendFollowUpMessage) {
    return { status: "unavailable", message: "ChatGPT follow-up is unavailable in this host session." };
  }

  const attempts: { prompt: string; scrollToBottom?: boolean }[] = [
    { prompt, scrollToBottom: true },
    { prompt },
    { prompt, scrollToBottom: false },
  ];

  let lastMessage = "";

  for (const message of attempts) {
    try {
      await withTimeout(
        Promise.resolve(sendFollowUpMessage.call(bridge, message)),
        timeoutMs,
        "Timed out sending follow-up message"
      );
      return { status: "sent" };
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    status: lastMessage.toLowerCase().includes("timed out") ? "timeout" : "failed",
    message: lastMessage || "ChatGPT follow-up failed."
  };
}

function asSubmissionBridgeStatus(value: unknown): SubmissionBridgeState["status"] {
  switch (value) {
    case "draft":
    case "submitting":
    case "submitted":
    case "requesting_grade":
    case "retrying_grade_request":
    case "grade_requested":
    case "fallback_ready":
    case "skipped":
    case "failed":
      return value;
    default:
      return "submitted";
  }
}

function asSubmissionCapsule(value: unknown): SubmissionCapsule | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  if (record.schema !== "betterquizzer.submission" || record.version !== 2) return undefined;
  if (typeof record.quizId !== "string" || typeof record.sessionId !== "string") return undefined;
  if (!Array.isArray(record.answers) || !Array.isArray(record.questions)) return undefined;
  return record as unknown as SubmissionCapsule;
}

function asQuizSession(value: unknown): QuizSession | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  if (record.schema !== "betterquizzer.session" || record.version !== 2) return undefined;
  if (typeof record.quizId !== "string" || typeof record.sessionId !== "string") return undefined;
  if (typeof record.startedAt !== "string" || !Array.isArray(record.answers)) return undefined;
  return record as unknown as QuizSession;
}

function asToolResultLike(value: unknown): ToolResultLike | null | undefined {
  if (value === null) return null;
  const record = asRecord(value);
  if (!record) return undefined;
  return {
    structuredContent: record.structuredContent,
    content: record.content,
    _meta: record._meta,
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(label)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function getBridgeQuizCandidates(bridge: OpenAiBridge): HostCandidate[] {
  const candidates: HostCandidate[] = [];
  const metadata = asRecord(bridge.toolResponseMetadata);
  const output = asRecord(bridge.toolOutput);
  const outputResult = asRecord(output?.result);
  const structuredContent = asRecord(output?.structuredContent);
  const resultStructuredContent = asRecord(outputResult?.structuredContent);
  const outputMeta = asRecord(output?._meta);
  const resultMeta = asRecord(outputResult?._meta);

  // Preferred current launch contract: the server returns the normalized quiz in structuredContent.quiz
  // and mirrors the same launch packet in tool response metadata for hosts that expose metadata first.
  for (const surface of [metadata, structuredContent, resultStructuredContent, output, outputResult, outputMeta, resultMeta]) {
    if (surface?.quiz) candidates.push({ value: surface.quiz, summary: surface });
  }

  // Some hosts wrap the tool result one level deeper (for example { result: { structuredContent } }).
  // Find the nearest sealed launch packet and use that packet as the summary. The previous deep-search
  // path found the quiz but kept the top-level wrapper as the summary, which caused the sealed-launch
  // validator to reject valid activities and left the widget on Loading quiz forever.
  for (const surface of [metadata, output, outputResult, structuredContent, resultStructuredContent, outputMeta, resultMeta]) {
    const launch = findLaunchPacketDeep(surface);
    if (launch?.quiz) candidates.push({ value: launch.quiz, summary: launch });
  }

  // Deep-search fallback for non-widget/standalone surfaces. Prefer findLaunchPacketDeep above for widget
  // launch data because it preserves the sealed summary fields required by the renderer contract.
  for (const surface of [metadata, output, outputResult, structuredContent, resultStructuredContent]) {
    const quiz = findQuizDeep(surface);
    if (quiz) candidates.push({ value: quiz, summary: surface });
  }

  // Last-resort current-call input fallback. This is only used if the host does not expose tool output yet;
  // the value is still normalized and renderer-certified before it can be displayed.
  const toolInput = asRecord(bridge.toolInput);
  if (toolInput?.quiz) {
    const inputQuiz = asRecord(toolInput.quiz);
    const inputQuestionCount = Array.isArray(inputQuiz?.questions) ? inputQuiz.questions.length : undefined;
    candidates.push({
      value: toolInput.quiz,
      summary: { ...toolInput, kind: "betterquizzer.tool_input_fallback", questionCount: inputQuestionCount, declaredQuestionCount: inputQuestionCount },
      surface: "toolInput",
    });
  }

  return dedupeCandidates(candidates);
}

function toHostQuizPayload(candidate: HostCandidate, source: HostQuizPayload["source"]): HostQuizPayload | null {
  const rawQuiz = findQuizDeep(candidate.value) ?? candidate.value;
  const normalized = normalizeQuizForRender(rawQuiz);
  const diagnostics = validateRenderableQuiz(normalized);
  const validShape = normalized.schema === "betterquizzer.quiz" && normalized.version === 2 && Array.isArray(normalized.questions);
  const launchSummary = asRecord(candidate.summary) ?? undefined;
  if (!validShape || !isCompleteRenderableLaunch(launchSummary, normalized, diagnostics, source)) return null;
  return {
    quiz: normalized,
    source,
    launchId: typeof launchSummary?.launchId === "string" ? launchSummary.launchId : undefined,
    recoveryToken: typeof launchSummary?.recoveryToken === "string" ? launchSummary.recoveryToken : undefined,
    quizRevision: typeof launchSummary?.quizRevision === "number" ? launchSummary.quizRevision : undefined,
    questionCount: typeof launchSummary?.questionCount === "number" ? launchSummary.questionCount : normalized.questions.length,
    declaredQuestionCount: typeof launchSummary?.declaredQuestionCount === "number" ? launchSummary.declaredQuestionCount : getExpectedQuestionCount(launchSummary ?? null) ?? normalized.questions.length,
    receivedQuestionCount: normalized.questions.length,
    uploadProgress: toUploadProgress(launchSummary, normalized, diagnostics),
    launchSummary,
    renderDiagnostics: diagnostics,
  };
}

function isCompleteRenderableLaunch(summaryRecord: Record<string, unknown> | undefined, quiz: QuizSpec, diagnostics: RenderDiagnostics, source: HostQuizPayload["source"]): boolean {
  const expectedQuestionCount = getExpectedQuestionCount(summaryRecord ?? null);
  const locallyCertified = diagnostics.rendererCertified && diagnostics.renderableQuestionCount === diagnostics.questionCount && diagnostics.questionCount === quiz.questions.length;
  if (!locallyCertified) return false;

  const requiresSealedLaunch = source === "chatgpt-widget";
  if (!summaryRecord) return !requiresSealedLaunch;

  if (summaryRecord.kind !== "betterquizzer.launch") {
    // ChatGPT can expose a valid structuredContent wrapper without preserving kind at the same object level.
    // Accept it only when it carries renderer diagnostics/counts proving the payload is complete.
    const countMatches = expectedQuestionCount !== null && quiz.questions.length === expectedQuestionCount;
    if (summaryRecord.kind === "betterquizzer.tool_input_fallback") {
      return countMatches;
    }
    const diagnosticsCertified = asRecord(summaryRecord.renderDiagnostics)?.rendererCertified === true;
    return diagnosticsCertified && countMatches;
  }

  if (summaryRecord.rendererCertified !== true) return false;
  if (expectedQuestionCount === null || quiz.questions.length < 1 || quiz.questions.length > expectedQuestionCount) return false;

  const summaryDiagnostics = asRecord(summaryRecord.renderDiagnostics);
  if (!summaryDiagnostics) return false;
  const summaryCertified = summaryDiagnostics.rendererCertified === true;
  const summaryQuestionCount = typeof summaryDiagnostics.questionCount === "number" ? summaryDiagnostics.questionCount : null;
  const summaryRenderableCount = typeof summaryDiagnostics.renderableQuestionCount === "number" ? summaryDiagnostics.renderableQuestionCount : null;
  if (!summaryCertified) return false;
  if (summaryQuestionCount !== quiz.questions.length) return false;
  if (summaryRenderableCount !== quiz.questions.length) return false;

  return true;
}

function toUploadProgress(summary: Record<string, unknown> | undefined, quiz: QuizSpec, diagnostics: RenderDiagnostics): HostQuizPayload["uploadProgress"] {
  const rawProgress = asRecord(summary?.packetProgress) ?? asRecord(summary?.uploadProgress);
  const expectedQuestions = typeof rawProgress?.expectedQuestions === "number" && Number.isFinite(rawProgress.expectedQuestions)
    ? rawProgress.expectedQuestions
    : getExpectedQuestionCount(summary ?? null) ?? quiz.questions.length;
  const receivedQuestions = typeof rawProgress?.receivedQuestions === "number" && Number.isFinite(rawProgress.receivedQuestions)
    ? rawProgress.receivedQuestions
    : quiz.questions.length;
  const renderableQuestions = typeof rawProgress?.renderableQuestions === "number" && Number.isFinite(rawProgress.renderableQuestions)
    ? rawProgress.renderableQuestions
    : diagnostics.renderableQuestionCount;
  const complete = typeof rawProgress?.complete === "boolean" ? rawProgress.complete : receivedQuestions >= expectedQuestions && diagnostics.rendererCertified;
  return { expectedQuestions, receivedQuestions, renderableQuestions, complete };
}

function getExpectedQuestionCount(summary: Record<string, unknown> | null): number | null {
  if (!summary) return null;
  const progress = asRecord(summary.packetProgress) ?? asRecord(summary.uploadProgress);
  if (typeof progress?.expectedQuestions === "number" && Number.isFinite(progress.expectedQuestions)) return progress.expectedQuestions;
  if (typeof summary.declaredQuestionCount === "number" && Number.isFinite(summary.declaredQuestionCount)) return summary.declaredQuestionCount;
  const diagnostics = asRecord(summary.renderDiagnostics);
  if (typeof diagnostics?.questionCount === "number" && Number.isFinite(diagnostics.questionCount)) return diagnostics.questionCount;
  if (typeof summary.questionCount === "number" && Number.isFinite(summary.questionCount)) return summary.questionCount;
  return null;
}

function dedupeCandidates(candidates: HostCandidate[]): HostCandidate[] {
  const seen = new Set<unknown>();
  return candidates.filter((candidate) => {
    const key = candidate.value;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isExplicitlyNormalized(record: Record<string, unknown>): boolean {
  return record.normalized === true || record.rendererCertified === true || asRecord(record.renderDiagnostics)?.rendererCertified === true;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function findLaunchPacketDeep(value: unknown, seen = new Set<unknown>(), depth = 0): Record<string, unknown> | null {
  const record = asRecord(value);
  if (record?.kind === "betterquizzer.launch" && record.quiz) return record;
  if (depth > 6 || !value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findLaunchPacketDeep(item, seen, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const container = value as Record<string, unknown>;
  for (const key of ["structuredContent", "_meta", "metadata", "toolOutput", "result", "content"]) {
    const found = findLaunchPacketDeep(container[key], seen, depth + 1);
    if (found) return found;
  }
  for (const nested of Object.values(container)) {
    const found = findLaunchPacketDeep(nested, seen, depth + 1);
    if (found) return found;
  }
  return null;
}

function findQuizDeep(value: unknown, seen = new Set<unknown>(), depth = 0): QuizSpec | null {
  const direct = asQuiz(value);
  if (direct) return direct;
  if (depth > 6 || !value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findQuizDeep(item, seen, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of ["quiz", "QuizSpec", "structuredContent", "_meta", "metadata", "toolOutput", "result"]) {
    const found = findQuizDeep(record[key], seen, depth + 1);
    if (found) return found;
  }

  for (const nested of Object.values(record)) {
    const found = findQuizDeep(nested, seen, depth + 1);
    if (found) return found;
  }

  return null;
}

function asQuiz(value: unknown): QuizSpec | null {
  const record = asRecord(value);
  if (record?.schema === "betterquizzer.quiz" && record.version === 2 && Array.isArray(record.questions)) {
    return record as QuizSpec;
  }
  return null;
}
