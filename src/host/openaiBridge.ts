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

const LOCAL_WIDGET_STATE_PREFIX = "betterquizzes.widgetState.";
const LOCAL_WIDGET_STATE_LATEST = `${LOCAL_WIDGET_STATE_PREFIX}latest`;

declare global {
  interface Window {
    openai?: OpenAiBridge;
    __BETTERQUIZZER_BOOTSTRAP__?: unknown;
    __BETTERQUIZZER_SERVER_BASE__?: string;
    __BETTERQUIZZER_SERVER_BASES__?: string[];
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

export type HostLaunchSummary = {
  kind: "betterquizzer.launch";
  quizId: string;
  launchId?: string;
  recoveryToken?: string;
  quizRevision?: number;
  declaredQuestionCount?: number;
  questionCount?: number;
  uploadProgress?: { expectedQuestions: number; receivedQuestions: number; renderableQuestions?: number; complete?: boolean };
  launchSummary: Record<string, unknown>;
};

type HostCandidate = {
  value: unknown;
  summary?: unknown;
};

const HOST_BRIDGE_UPDATE_EVENT = "betterquizzer:host-bridge-update";
const HOST_JSON_RPC_VERSION = "2.0";
let hostBridgeListenersInstalled = false;
let latestMcpToolInput: unknown = null;
let latestMcpToolResult: ToolResultLike | null = null;
let latestOpenAiGlobals: Record<string, unknown> | null = null;
let hostRpcRequestSequence = 0;

export function getOpenAiBridge(): OpenAiBridge | undefined {
  installHostBridgeListeners();
  return typeof window !== "undefined" ? window.openai : undefined;
}

export function isChatGptWidget(): boolean {
  return Boolean(getOpenAiBridge() || latestMcpToolResult || latestOpenAiGlobals);
}

export function subscribeHostQuizPayload(listener: () => void): () => void {
  installHostBridgeListeners();
  if (typeof window === "undefined") return () => {};
  window.addEventListener(HOST_BRIDGE_UPDATE_EVENT, listener);
  return () => window.removeEventListener(HOST_BRIDGE_UPDATE_EVENT, listener);
}

export function getHostQuizPayload(): HostQuizPayload | null {
  installHostBridgeListeners();
  const bridge = getOpenAiBridge();
  const bootstrap = asRecord(typeof window !== "undefined" ? window.__BETTERQUIZZER_BOOTSTRAP__ : undefined);

  const bridgeCandidates = getBridgeQuizCandidates(bridge);
  for (const candidate of bridgeCandidates) {
    const payload = toHostQuizPayload(candidate, "chatgpt-widget");
    if (payload) return payload;
  }

  const bootstrapLaunch = findLaunchPacketShallow(bootstrap);
  if (bootstrapLaunch?.quiz) {
    const payload = toHostQuizPayload({ value: bootstrapLaunch.quiz, summary: bootstrapLaunch }, "server-bootstrap");
    if (payload) return payload;
  }

  return null;
}

export function getHostLaunchSummary(): HostLaunchSummary | null {
  installHostBridgeListeners();
  const bridge = getOpenAiBridge();
  const launchPackets = getBridgeLaunchPackets(bridge);
  for (const launch of launchPackets) {
    const quizId = typeof launch.quizId === "string" ? launch.quizId : undefined;
    if (!quizId) continue;
    return {
      kind: "betterquizzer.launch",
      quizId,
      launchId: typeof launch.launchId === "string" ? launch.launchId : undefined,
      recoveryToken: typeof launch.recoveryToken === "string" ? launch.recoveryToken : undefined,
      quizRevision: typeof launch.quizRevision === "number" ? launch.quizRevision : undefined,
      declaredQuestionCount: typeof launch.declaredQuestionCount === "number" ? launch.declaredQuestionCount : getExpectedQuestionCount(launch) ?? undefined,
      questionCount: typeof launch.questionCount === "number" ? launch.questionCount : undefined,
      uploadProgress: toUploadProgressFromSummary(launch),
      launchSummary: launch,
    };
  }
  return null;
}

export function describeHostBridgeState(): string {
  installHostBridgeListeners();
  const bridge = getOpenAiBridge();
  const bootstrap = asRecord(typeof window !== "undefined" ? window.__BETTERQUIZZER_BOOTSTRAP__ : undefined);
  const candidates = getBridgeQuizCandidates(bridge);
  const launchPackets = getBridgeLaunchPackets(bridge);
  return JSON.stringify(
    {
      hasOpenAiBridge: Boolean(bridge),
      hasMcpToolResult: Boolean(latestMcpToolResult),
      hasMcpToolInput: Boolean(latestMcpToolInput),
      hasOpenAiSetGlobals: Boolean(latestOpenAiGlobals),
      surfaces: {
        toolInput: Boolean(bridge?.toolInput),
        toolOutput: Boolean(bridge?.toolOutput),
        toolResponseMetadata: Boolean(bridge?.toolResponseMetadata),
        widgetState: Boolean(bridge?.widgetState),
        bootstrap: Boolean(bootstrap),
      },
      launchPacketCount: launchPackets.length,
      launchPackets: launchPackets.slice(0, 3).map((launch) => ({
        kind: typeof launch.kind === "string" ? launch.kind : null,
        quizId: typeof launch.quizId === "string" ? launch.quizId : null,
        launchId: typeof launch.launchId === "string" ? launch.launchId : null,
        hasQuiz: Boolean(asQuiz(launch.quiz)),
        hasRecoveryToken: typeof launch.recoveryToken === "string",
      })),
      candidateCount: candidates.length,
      candidates: candidates.map((candidate) => {
        const summary = asRecord(candidate.summary);
        return {
          surface: "sealed",
          kind: typeof summary?.kind === "string" ? summary.kind : null,
          hasQuiz: Boolean(asQuiz(candidate.value)),
        };
      }),
    },
    null,
    2
  );
}

function installHostBridgeListeners(): void {
  if (hostBridgeListenersInstalled || typeof window === "undefined") return;
  hostBridgeListenersInstalled = true;

  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window.parent) return;
    const message = asRecord(event.data);
    if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") return;

    if (message.method === "ui/notifications/tool-result") {
      latestMcpToolResult = asToolResultLike(message.params) ?? { structuredContent: asRecord(message.params)?.structuredContent, _meta: asRecord(message.params)?._meta };
      notifyHostBridgeUpdate();
    }

    if (message.method === "ui/notifications/tool-input") {
      latestMcpToolInput = message.params;
      notifyHostBridgeUpdate();
    }
  }, { passive: true });

  window.addEventListener("openai:set_globals", (event: Event) => {
    const customEvent = event as CustomEvent<unknown>;
    const detail = asRecord(customEvent.detail);
    latestOpenAiGlobals = asRecord(detail?.globals) ?? detail;
    notifyHostBridgeUpdate();
  });
}

function notifyHostBridgeUpdate(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(HOST_BRIDGE_UPDATE_EVENT));
}

export function persistWidgetState(state: unknown): void {
  const bridge = getOpenAiBridge();
  try {
    bridge?.setWidgetState?.(state);
    bridge?.notifyIntrinsicHeight?.();
  } catch {
    // Widget state should improve UX, never block the quiz.
  }
  persistLocalWidgetState(state);
}

function getBrowserStorage(kind: "localStorage" | "sessionStorage"): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window[kind] ?? null;
  } catch {
    return null;
  }
}

function readLocalWidgetState(key: string): Record<string, unknown> | null {
  for (const kind of ["sessionStorage", "localStorage"] as const) {
    const storage = getBrowserStorage(kind);
    if (!storage) continue;
    try {
      const text = storage.getItem(key);
      if (!text) continue;
      const record = asRecord(JSON.parse(text));
      if (record) return record;
    } catch {
      // Ignore stale or unavailable fallback snapshots.
    }
  }
  return null;
}

function persistLocalWidgetState(state: unknown): void {
  const record = asRecord(state);
  const quizId = typeof record?.quizId === "string" ? record.quizId : "";
  if (!record || !quizId) return;
  const launchId = typeof record.launchId === "string" ? record.launchId : "";
  let text = "";
  try {
    text = JSON.stringify(record);
  } catch {
    return;
  }
  const keys = [
    `${LOCAL_WIDGET_STATE_PREFIX}quiz.${quizId}`,
    launchId ? `${LOCAL_WIDGET_STATE_PREFIX}launch.${launchId}` : "",
    LOCAL_WIDGET_STATE_LATEST,
  ].filter(Boolean);
  for (const kind of ["sessionStorage", "localStorage"] as const) {
    const storage = getBrowserStorage(kind);
    if (!storage) continue;
    for (const key of keys) {
      try {
        storage.setItem(key, text);
      } catch {
        // Storage can be quota-limited or blocked in embedded mobile contexts.
      }
    }
  }
}

function isWidgetStateCandidate(record: Record<string, unknown> | null, quizId: string, launchId?: string): boolean {
  if (!record) return false;
  if (record.quizId !== quizId) return false;
  if (launchId && typeof record.launchId === "string" && record.launchId !== launchId) return false;
  return true;
}

function getPersistedWidgetStateRecord(quizId: string, launchId?: string): Record<string, unknown> | null {
  const bridgeState = asRecord(getOpenAiBridge()?.widgetState);
  if (isWidgetStateCandidate(bridgeState, quizId, launchId)) return bridgeState;

  const keys = [
    launchId ? `${LOCAL_WIDGET_STATE_PREFIX}launch.${launchId}` : "",
    `${LOCAL_WIDGET_STATE_PREFIX}quiz.${quizId}`,
    LOCAL_WIDGET_STATE_LATEST,
  ].filter(Boolean);

  for (const key of keys) {
    const state = readLocalWidgetState(key);
    if (isWidgetStateCandidate(state, quizId, launchId)) return state;
  }
  return null;
}

export function getPersistedDraftState(quizId: string, launchId?: string): DraftBridgeState | null {
  const state = getPersistedWidgetStateRecord(quizId, launchId);
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
  const state = getPersistedWidgetStateRecord(quizId, launchId);
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
  if (bridge?.callTool) {
    for (const name of names) {
      try {
        return await withTimeout(bridge.callTool(name, args), timeoutMs, `Timed out calling ${name}`);
      } catch (error) {
        lastError = error;
      }
    }
  }

  for (const name of names) {
    try {
      const result = await callHostJsonRpc("tools/call", { name, arguments: args }, timeoutMs);
      return asToolResultLike(result) ?? { structuredContent: result };
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

  const attempts: { prompt: string; scrollToBottom?: boolean }[] = [
    { prompt, scrollToBottom: true },
    { prompt },
    { prompt, scrollToBottom: false },
  ];

  let lastMessage = "";

  if (sendFollowUpMessage) {
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
  }

  for (const message of attempts) {
    try {
      await callHostJsonRpc("ui/message", message, timeoutMs);
      return { status: "sent" };
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : String(error);
    }
  }

  if (!sendFollowUpMessage && !lastMessage) {
    return { status: "unavailable", message: "ChatGPT follow-up is unavailable in this host session." };
  }

  return {
    status: lastMessage.toLowerCase().includes("timed out") ? "timeout" : "failed",
    message: lastMessage || "ChatGPT follow-up failed."
  };
}

function callHostJsonRpc(method: "tools/call" | "ui/message", params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
  if (typeof window === "undefined" || !window.parent || window.parent === window) {
    return Promise.reject(new Error(`Host JSON-RPC ${method} is unavailable outside an embedded widget.`));
  }

  const id = `betterquizzes-${Date.now()}-${++hostRpcRequestSequence}`;
  const message = { jsonrpc: HOST_JSON_RPC_VERSION, id, method, params };

  return new Promise((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      window.removeEventListener("message", onMessage);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      const response = asRecord(event.data);
      if (!response || response.jsonrpc !== HOST_JSON_RPC_VERSION || response.id !== id) return;
      cleanup();
      if (response.error !== undefined) {
        const errorRecord = asRecord(response.error);
        const messageText = typeof errorRecord?.message === "string" ? errorRecord.message : `Host JSON-RPC ${method} failed.`;
        reject(new Error(messageText));
        return;
      }
      resolve(response.result);
    };

    window.addEventListener("message", onMessage);
    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for host JSON-RPC ${method}`));
    }, timeoutMs);
    window.parent.postMessage(message, "*");
  });
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

function getBridgeQuizCandidates(bridge?: OpenAiBridge): HostCandidate[] {
  const candidates: HostCandidate[] = [];
  const launchPackets = getBridgeLaunchPackets(bridge);

  for (const launch of launchPackets) {
    if (launch.quiz) candidates.push({ value: launch.quiz, summary: launch });
  }

  return dedupeCandidates(candidates);
}

function getBridgeLaunchPackets(bridge?: OpenAiBridge): Record<string, unknown>[] {
  const bridgeOutput = asRecord(bridge?.toolOutput);
  const bridgeGlobalsOutput = asRecord(latestOpenAiGlobals?.toolOutput);
  const mcpOutput = asRecord(latestMcpToolResult);
  const surfaces: unknown[] = [
    bridge?.toolOutput,
    asRecord(bridge?.toolResponseMetadata),
    bridgeOutput,
    asRecord(bridgeOutput?.result),
    asRecord(bridgeOutput?.structuredContent),
    asRecord(asRecord(bridgeOutput?.result)?.structuredContent),
    asRecord(bridgeOutput?._meta),
    asRecord(asRecord(bridgeOutput?.result)?._meta),
    latestOpenAiGlobals?.toolOutput,
    asRecord(latestOpenAiGlobals?.toolResponseMetadata),
    bridgeGlobalsOutput,
    asRecord(bridgeGlobalsOutput?.result),
    asRecord(bridgeGlobalsOutput?.structuredContent),
    asRecord(asRecord(bridgeGlobalsOutput?.result)?.structuredContent),
    asRecord(bridgeGlobalsOutput?._meta),
    asRecord(asRecord(bridgeGlobalsOutput?.result)?._meta),
    latestMcpToolResult,
    mcpOutput,
    asRecord(mcpOutput?.result),
    asRecord(mcpOutput?.structuredContent),
    asRecord(asRecord(mcpOutput?.result)?.structuredContent),
    asRecord(mcpOutput?._meta),
    asRecord(asRecord(mcpOutput?.result)?._meta),
  ].filter(Boolean);

  const launches: Record<string, unknown>[] = [];
  for (const surface of surfaces) {
    const launch = findLaunchPacketShallow(surface);
    if (launch) launches.push(launch);
  }

  return dedupeLaunchPackets(launches);
}

function toHostQuizPayload(candidate: HostCandidate, source: HostQuizPayload["source"]): HostQuizPayload | null {
  const rawQuiz = asQuiz(candidate.value) ?? candidate.value;
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

function toUploadProgressFromSummary(summary: Record<string, unknown>): HostLaunchSummary["uploadProgress"] | undefined {
  const progress = asRecord(summary.packetProgress) ?? asRecord(summary.uploadProgress);
  const expectedQuestions = typeof progress?.expectedQuestions === "number" && Number.isFinite(progress.expectedQuestions)
    ? progress.expectedQuestions
    : getExpectedQuestionCount(summary);
  const receivedQuestions = typeof progress?.receivedQuestions === "number" && Number.isFinite(progress.receivedQuestions)
    ? progress.receivedQuestions
    : typeof summary.questionCount === "number" && Number.isFinite(summary.questionCount)
      ? summary.questionCount
      : null;
  if (expectedQuestions === null || receivedQuestions === null) return undefined;
  const renderableQuestions = typeof progress?.renderableQuestions === "number" && Number.isFinite(progress.renderableQuestions)
    ? progress.renderableQuestions
    : typeof summary.renderableQuestionCount === "number" && Number.isFinite(summary.renderableQuestionCount)
      ? summary.renderableQuestionCount
      : undefined;
  const complete = typeof progress?.complete === "boolean" ? progress.complete : receivedQuestions >= expectedQuestions;
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

function dedupeLaunchPackets(launches: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  return launches.filter((launch) => {
    const key = [
      typeof launch.launchId === "string" ? launch.launchId : "",
      typeof launch.quizId === "string" ? launch.quizId : "",
      typeof launch.quizRevision === "number" ? String(launch.quizRevision) : "",
      asQuiz(launch.quiz) ? "quiz" : "summary",
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function findLaunchPacketShallow(value: unknown, seen = new Set<unknown>(), depth = 0): Record<string, unknown> | null {
  if (typeof value === "string") {
    return findLaunchPacketShallow(parseJsonish(value), seen, depth + 1);
  }
  const record = asRecord(value);
  if (record?.kind === "betterquizzer.launch") return record;
  if (depth > 4 || !value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findLaunchPacketShallow(item, seen, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const container = value as Record<string, unknown>;
  for (const key of ["structuredContent", "_meta", "metadata", "toolOutput", "result", "content", "text", "data"]) {
    const found = findLaunchPacketShallow(container[key], seen, depth + 1);
    if (found) return found;
  }
  return null;
}

function parseJsonish(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed || !/^[\[{]/.test(trimmed) || !trimmed.includes("betterquizzer.launch")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function asQuiz(value: unknown): QuizSpec | null {
  const record = asRecord(value);
  if (record?.schema === "betterquizzer.quiz" && record.version === 2 && Array.isArray(record.questions)) {
    return record as QuizSpec;
  }
  return null;
}
