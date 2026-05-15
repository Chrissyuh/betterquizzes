import katex from "katex";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode, type PointerEvent, type TouchEvent as ReactTouchEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  buildCompletionSummary,
  buildLlmReturnPrompt,
  createSession,
  createSubmissionCapsule,
  getQuizId,
  normalizeActivityPolicy,
  normalizeDisplayPolicy,
  normalizeGradingPolicy,
  formatRenderContractIssue,
  prepareQuizForRender,
  type ActivityPolicy,
  type AnswerRecord,
  type AnswerResponse,
  type DisplayPolicy,
  type MatchingPair,
  type Question,
  type QuizSession,
  type QuizSpec,
  type SubmissionCapsule,
} from "./shared";
import {
  describeHostBridgeState,
  getHostQuizPayload,
  getPersistedDraftState,
  getPersistedSubmissionState,
  isChatGptWidget,
  persistWidgetState,
  persistSubmissionState,
  sendSubmissionFollowUp,
  subscribeHostQuizPayload,
  submitToHost,
  type HostQuizPayload,
  type SubmissionBridgeState,
  type ToolResultLike,
} from "./host/openaiBridge";
import { BETTERQUIZZER_BUILD_ID, BETTERQUIZZER_VERSION } from "./shared/version";
import tinyDemo from "./shared/examples/tiny-demo.json";
import aphgDemo from "./shared/examples/aphg-demo.json";
import mixedTypesDemo from "./shared/examples/mixed-types.json";

const initialOrder: string[] = [];


function bqV40IsChatGptHost() {
  if (typeof window === "undefined") return false;

  const hasOpenAiBridge = "openai" in window;
  const isEmbedded = window.parent !== window;
  const search = window.location.search.toLowerCase();
  const hash = window.location.hash.toLowerCase();
  const host = window.location.hostname.toLowerCase();

  return (
    hasOpenAiBridge ||
    isEmbedded ||
    search.includes("openai") ||
    search.includes("mcp") ||
    hash.includes("openai") ||
    host.includes("chatgpt") ||
    host.includes("openai")
  );
}

function bqV40ApplyHostClass() {
  if (typeof document === "undefined") return;

  if (bqV40IsChatGptHost()) {
    document.documentElement.classList.add("bq-chatgpt-host");
  } else {
    document.documentElement.classList.remove("bq-chatgpt-host");
  }
}

bqV40ApplyHostClass();


function bqV44ShouldUseEarlyMobileFollowUp() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  if (!bqV40IsChatGptHost()) return false;

  const userAgent = navigator.userAgent.toLowerCase();
  const looksMobile =
    /iphone|ipad|ipod|android|mobile/.test(userAgent) ||
    (typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches) ||
    navigator.maxTouchPoints > 0;

  return looksMobile;
}






type Screen = "loading" | "import" | "quiz" | "submission";
type DraftAnswer = {
  response: AnswerResponse;
  confidence?: AnswerRecord["confidence"];
  /** Absolute ms timestamp for the first edit in the current visible session. */
  firstSeenAt: number;
  /** Absolute ms timestamp for the most recent edit. Used for draft restore diagnostics. */
  lastUpdatedAt?: number;
};
type ResponseLimit = { maxChars?: number | null; minChars?: number; showCounter?: boolean };
type SubmissionDeliveryStatus =
  | "not_started"
  | "submitted"
  | "requesting_grade"
  | "retrying_grade_request"
  | "grade_requested"
  | "grade_request_unavailable"
  | "grade_request_failed";

type FinishedSubmission = {
  submission: SubmissionCapsule;
  session: ReturnType<typeof createSession>;
  hostSubmitted: boolean;
  recoveryToken?: string;
  followUpRequested?: boolean;
  followUpStatus?: SubmissionDeliveryStatus;
  followUpAttempts?: number;
  followUpMessage?: string;
};

type GradePayload = {
  kind?: string;
  quizId: string;
  sessionId?: string;
  score?: number | null;
  maxScore?: number | null;
  percent?: number | null;
  label?: string;
  summary?: string;
  items?: { questionId?: string; mark?: string; feedback?: string; points?: number | null; maxPoints?: number | null }[];
  recordedAt?: string;
};

type PendingLaunch = {
  key: string;
  payload: HostQuizPayload;
  quiz: QuizSpec;
  firstSeenAt: number;
};

type HydrationPhase = "waiting_for_launch" | "rendering" | "polling_updates" | "terminal_error";
type HydrationProgress = { expectedQuestions: number; receivedQuestions: number; renderableQuestions?: number; complete?: boolean; message?: string; source?: string };

const SAMPLE_QUIZZES = [tinyDemo as QuizSpec, aphgDemo as QuizSpec, mixedTypesDemo as QuizSpec];
const WIDGET_VERSION = BETTERQUIZZER_VERSION;
const WIDGET_VERSION_LABEL = formatWidgetVersion(WIDGET_VERSION);
const STABLE_LAUNCH_MS = 450;
const HYDRATION_ERROR_DELAY_MS = 30000;
const HYDRATION_INTERRUPTED_MS = 12000;
const SERVER_RECOVERY_POLL_MS = 1500;
const SERVER_RECOVERY_TIMEOUT_MS = 30000;

export default function App(): ReactElement {
  const routeWidgetMode = useMemo(() => isWidgetRoute(), []);
  const bootstrapWidgetMode = useMemo(() => hasBetterQuizzesBootstrap(), []);
  const embeddedWidgetMode = useMemo(() => bqV40IsChatGptHost(), []);
  const widgetMode = Boolean(isChatGptWidget() || bootstrapWidgetMode || routeWidgetMode || embeddedWidgetMode);
  const [screen, setScreen] = useState<Screen>(widgetMode ? "loading" : "import");
  const [quiz, setQuiz] = useState<QuizSpec | null>(null);
  const [launchId, setLaunchId] = useState<string | undefined>(undefined);
  const [recoveryToken, setRecoveryToken] = useState<string | undefined>(undefined);
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString());
  const [finished, setFinished] = useState<FinishedSubmission | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [hydrationError, setHydrationError] = useState<string | null>(null);
  const [hydrationErrorVisible, setHydrationErrorVisible] = useState(false);
  const [hydrationPhase, setHydrationPhase] = useState<HydrationPhase>(widgetMode ? "waiting_for_launch" : "rendering");
  const [hydrationProgress, setHydrationProgress] = useState<HydrationProgress | null>(null);
  const pendingLaunchRef = useRef<PendingLaunch | null>(null);
  const hydrationStartedAtRef = useRef(Date.now());

  function applyQuiz(rawQuiz: unknown, nextLaunchId?: string, nextRecoveryToken?: string): void {
    const prepared = prepareQuizForRender(rawQuiz);
    if (!prepared.ok) throw new Error(formatRenderContractIssue(prepared));
    const nextQuiz = prepared.quiz;
    const restored = widgetMode ? buildFinishedFromPersistedSubmission(nextQuiz, nextLaunchId) : null;
    setQuiz(nextQuiz);
    setLaunchId(nextLaunchId);
    setRecoveryToken(nextRecoveryToken ?? restored?.recoveryToken);
    setStartedAt(restored?.session.startedAt ?? new Date().toISOString());
    setFinished(restored);
    setImportError(null);
    setHydrationError(null);
    setHydrationPhase("rendering");
    setScreen(restored ? "submission" : "quiz");
  }

  function loadQuiz(nextQuiz: QuizSpec): void {
    try {
      applyQuiz(nextQuiz);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    if (!widgetMode) return;
    const timeout = window.setTimeout(() => setHydrationErrorVisible(true), HYDRATION_ERROR_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [widgetMode]);

  useEffect(() => {
    if (!widgetMode) return;
    return subscribeHostQuizPayload(() => {
      pendingLaunchRef.current = null;
      setHydrationProgress((progress) => progress ?? {
        expectedQuestions: 0,
        receivedQuestions: 0,
        complete: false,
        source: "mcp-apps-bridge",
        message: "Receiving quiz launch from ChatGPT...",
      });
    });
  }, [widgetMode]);

  useEffect(() => {
    if (!widgetMode) return;
    const interval = window.setInterval(() => {
      const elapsedMs = Date.now() - hydrationStartedAtRef.current;
      const nextPayload = getHostQuizPayload();
      if (nextPayload) {
        try {
          const prepared = prepareQuizForRender(nextPayload.quiz);
          if (!prepared.ok) throw new Error(formatRenderContractIssue(prepared));
          const nextQuiz = prepared.quiz;
          setHydrationProgress(toHydrationProgress(nextPayload, nextQuiz));
          const pendingKey = launchStabilityKey(nextPayload, nextQuiz);
          const now = Date.now();
          const currentPending = pendingLaunchRef.current;
          if (!currentPending || currentPending.key !== pendingKey) {
            pendingLaunchRef.current = { key: pendingKey, payload: nextPayload, quiz: nextQuiz, firstSeenAt: now };
            return;
          }
          if (now - currentPending.firstSeenAt < STABLE_LAUNCH_MS) return;
          if (!shouldAcceptHydratedQuiz(quiz, currentPending.quiz)) return;

          const restored = buildFinishedFromPersistedSubmission(currentPending.quiz, currentPending.payload.launchId);
          setLaunchId(currentPending.payload.launchId);
          setRecoveryToken(currentPending.payload.recoveryToken ?? restored?.recoveryToken);
          setStartedAt(restored?.session.startedAt ?? new Date().toISOString());
          setFinished(restored);
          setImportError(null);
          setHydrationError(null);
          setHydrationErrorVisible(false);
          setHydrationPhase("rendering");
          setHydrationProgress(toHydrationProgress(currentPending.payload, currentPending.quiz));
          setScreen(restored ? "submission" : "quiz");
          setQuiz(currentPending.quiz);
        } catch (error) {
          setHydrationError(error instanceof Error ? error.message : String(error));
          if (!quiz) setScreen("loading");
        }
      }
      if (!nextPayload && !quiz && elapsedMs >= HYDRATION_INTERRUPTED_MS) {
        setHydrationPhase("waiting_for_launch");
        setHydrationProgress((progress) => progress ?? {
          expectedQuestions: 0,
          receivedQuestions: 0,
          complete: false,
          source: "server-recovery",
          message: "Still waiting for the quiz from ChatGPT...",
        });
      }
      if (!nextPayload && !quiz && elapsedMs >= SERVER_RECOVERY_TIMEOUT_MS) {
        setHydrationError(buildHydrationFailureDetails("The quiz launch did not finish before the recovery timeout."));
        setHydrationErrorVisible(true);
        setHydrationPhase("terminal_error");
      }
    }, 250);
    return () => window.clearInterval(interval);
  }, [widgetMode, quiz]);

  useEffect(() => {
    if (!widgetMode || quiz) return;
    const requestedQuizId = getRequestedQuizId();
    const requestedRecoveryToken = getRequestedRecoveryToken();
    if (!requestedQuizId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        setHydrationProgress((progress) => progress ?? {
          expectedQuestions: 0,
          receivedQuestions: 0,
          complete: false,
          source: "server-recovery",
          message: "Still waiting for the quiz from ChatGPT...",
        });
        const serverQuiz = await fetchQuizFromServer(requestedQuizId, requestedRecoveryToken);
        if (cancelled) return;
        const prepared = prepareQuizForRender(serverQuiz);
        if (!prepared.ok) throw new Error(formatRenderContractIssue(prepared));
        const diagnostics = prepared.diagnostics;
        if (!diagnostics.rendererCertified || diagnostics.renderableQuestionCount !== prepared.quiz.questions.length) {
          throw new Error("Recovered quiz is not render-certified yet.");
        }
        setHydrationProgress({
          expectedQuestions: prepared.quiz.questions.length,
          receivedQuestions: prepared.quiz.questions.length,
          renderableQuestions: diagnostics.renderableQuestionCount,
          complete: true,
          source: "server-quiz-id",
        });
        applyQuiz(prepared.quiz, getRecoveredLaunchId(prepared.quiz), requestedRecoveryToken ?? undefined);
      } catch (error) {
        if (cancelled) return;
        setHydrationError(buildHydrationFailureDetails(error instanceof Error ? error.message : String(error)));
        setHydrationPhase("terminal_error");
        setScreen("loading");
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), SERVER_RECOVERY_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [widgetMode, quiz]);

  useEffect(() => {
    if (!widgetMode || !quiz || finished || !shouldPollForServerQuizUpdates(quiz, hydrationProgress)) return;
    let cancelled = false;
    const quizId = getQuizId(quiz);
    const poll = async () => {
      const update = await fetchQuizUpdateForIncrementalBuild(quizId, recoveryToken ?? launchId).catch(() => null);
      if (cancelled || !update) return;
      const prepared = prepareQuizForRender(update.quiz);
      if (!prepared.ok) return;
      const serverQuiz = prepared.quiz;
      if (!shouldAcceptHydratedQuiz(quiz, serverQuiz)) return;
      const progress = getIncrementalGenerationStatus(serverQuiz);
      const hostProgress = update.payload?.uploadProgress;
      setHydrationProgress({
        expectedQuestions: hostProgress?.expectedQuestions ?? progress?.expected ?? serverQuiz.questions.length,
        receivedQuestions: hostProgress?.receivedQuestions ?? serverQuiz.questions.length,
        renderableQuestions: hostProgress?.renderableQuestions ?? prepared.diagnostics.renderableQuestionCount,
        complete: hostProgress?.complete ?? (progress === null),
      });
      setLaunchId((currentLaunchId) => getRecoveredLaunchId(serverQuiz) ?? currentLaunchId);
      if (update.payload?.recoveryToken) setRecoveryToken(update.payload.recoveryToken);
      setHydrationPhase("polling_updates");
      setQuiz(serverQuiz);
    };
    const interval = window.setInterval(() => void poll(), 1500);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [widgetMode, quiz, finished, hydrationProgress, recoveryToken, launchId]);

  if (screen === "import") {
    if (widgetMode) return <WidgetLoading progress={hydrationProgress} phase={hydrationPhase} />;
    return <ImportScreen error={importError} onLoadQuiz={loadQuiz} />;
  }

  if (screen === "loading") {
    return hydrationError && hydrationErrorVisible ? <QuizSetupIssue message={hydrationError} /> : <WidgetLoading progress={hydrationProgress} phase={hydrationPhase} />;
  }

  if (screen === "submission" && finished) {
    return <SubmissionScreen finished={finished} widgetMode={widgetMode} onNewQuiz={() => {
      setRecoveryToken(undefined);
      setScreen(widgetMode ? "submission" : "import");
    }} />;
  }

  if (!quiz) {
    return widgetMode ? (hydrationError && hydrationErrorVisible ? <QuizSetupIssue message={hydrationError} /> : <WidgetLoading progress={hydrationProgress} phase={hydrationPhase} />) : <ImportScreen error="No quiz is loaded." onLoadQuiz={loadQuiz} />;
  }

  return (
    <QuizRunner
      key={getQuizId(quiz)}
      quiz={quiz}
      startedAt={startedAt}
      launchId={launchId}
      recoveryToken={recoveryToken}
      widgetMode={widgetMode}
      onReset={() => setScreen("import")}
      onFinish={(result) => {
        setFinished(result);
        setScreen("submission");
      }}
    />
  );
}

function formatWidgetVersion(version: string): string {
  const trimmed = String(version || "").trim();
  if (!trimmed) return "V1";
  return /^v/i.test(trimmed) ? trimmed : /^V\d/i.test(trimmed) ? trimmed : `v${trimmed}`;
}

function WidgetLoading({ progress, phase = "waiting_for_launch" }: { progress?: HydrationProgress | null; phase?: HydrationPhase } = {}): ReactElement {
  const expected = progress?.expectedQuestions ?? 0;
  const received = progress?.receivedQuestions ?? 0;
  const complete = Boolean(progress?.complete || (expected > 0 && received >= expected));
  const percent = expected > 0 ? Math.min(100, Math.round((Math.max(0, received) / expected) * 100)) : 0;
  const progressClass = expected > 0 ? "progress-shell loading-progress determinate" : "progress-shell loading-progress indeterminate";
  return (
    <main className="shell narrow">
      <section className="card stack center-card loading-card">
        <p className="eyebrow eyebrow-row">BetterQuizzes <span className="version-chip">{WIDGET_VERSION_LABEL}</span></p>
        <h1>Loading quiz…</h1>
        <p>{progress?.message ?? (phase === "polling_updates" ? "Loading the latest quiz update..." : "Waiting for ChatGPT to launch the quiz...")}</p>
        <div className="loading-progress-note" aria-live="polite">
          <div className={progressClass} aria-label="Loading quiz packet" aria-busy={!complete}>
            <span style={expected > 0 ? { width: `${percent}%` } : undefined} />
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <span>BetterQuizzes is an interactive quiz app for ChatGPT.</span>
        <div className="site-footer-actions" aria-label="Legal links">
          <a className="footer-button" href="/privacy">Privacy</a>
          <a className="footer-button" href="/terms">Terms</a>
        </div>
      </footer>
    </main>
  );
}

function QuizSetupIssue({ message }: { message: string }): ReactElement {
  return (
    <main className="shell narrow">
      <section className="card stack">
        <p className="eyebrow eyebrow-row">BetterQuizzes <span className="version-chip">{WIDGET_VERSION_LABEL}</span></p>
        <h1>Quiz did not finish loading</h1>
        <p>Still waiting for the quiz from ChatGPT. The app tried to recover from the latest stored quiz, but a complete quiz was not available yet.</p>
        <details>
          <summary>Technical details</summary>
          <pre className="error-box">{message}</pre>
        </details>
      </section>
    </main>
  );
}

function isWidgetRoute(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return Boolean(window.__BETTERQUIZZER_FORCE_WIDGET__) || window.location.pathname === "/widget" || params.get("mode") === "widget" || params.get("bq_widget") === "1";
}

function hasBetterQuizzesBootstrap(): boolean {
  if (typeof window === "undefined") return false;
  const bootstrap = window.__BETTERQUIZZER_BOOTSTRAP__;
  return Boolean(bootstrap && typeof bootstrap === "object");
}

function getRequestedQuizId(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return params.get("quizId") || params.get("quiz") || null;
}

function getRequestedRecoveryToken(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return params.get("recoveryToken") || params.get("token") || params.get("accessToken") || null;
}

function cleanServerBase(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\/$/, "") : "";
}

function getServerBases(): string[] {
  if (typeof window === "undefined") return [];
  const bootstrap = window.__BETTERQUIZZER_BOOTSTRAP__ && typeof window.__BETTERQUIZZER_BOOTSTRAP__ === "object"
    ? window.__BETTERQUIZZER_BOOTSTRAP__ as Record<string, unknown>
    : {};
  const bootstrapBases = Array.isArray(bootstrap.serverBases) ? bootstrap.serverBases : [];
  const candidates = [
    ...(Array.isArray(window.__BETTERQUIZZER_SERVER_BASES__) ? window.__BETTERQUIZZER_SERVER_BASES__ : []),
    window.__BETTERQUIZZER_SERVER_BASE__,
    ...bootstrapBases,
    bootstrap.serverBase,
    window.location.origin && window.location.origin !== "null" ? window.location.origin : "",
  ].map(cleanServerBase).filter(Boolean);
  return [...new Set(candidates)];
}

async function fetchQuizFromServer(quizId: string, recoveryToken?: string | null): Promise<QuizSpec> {
  const query = recoveryToken ? "?recoveryToken=" + encodeURIComponent(recoveryToken) : "";
  const path = "/api/quiz/" + encodeURIComponent(quizId) + query;
  const bases = getServerBases();
  let lastError: unknown = null;
  for (const base of bases.length ? bases : [""]) {
    try {
      const response = await fetch((base ? base : "") + path, { headers: { accept: "application/json" } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = body && typeof body === "object" && "error" in body ? String((body as { error?: unknown }).error) : response.status + " " + response.statusText;
        throw new Error(detail);
      }
      const record = body as { quiz?: QuizSpec };
      if (!record.quiz) throw new Error("Server response did not include a quiz.");
      return record.quiz;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error("Server quiz fetch failed from " + describeServerBases() + ": " + (lastError instanceof Error ? lastError.message : String(lastError)));
}

async function fetchQuizUpdateForIncrementalBuild(
  quizId: string,
  recoveryToken?: string | null
): Promise<{ quiz: QuizSpec; payload?: HostQuizPayload }> {
  if (recoveryToken) {
    return { quiz: await fetchQuizFromServer(quizId, recoveryToken) };
  }
  throw new Error("No recovery token or launchId is available for token-scoped quiz updates.");
}

function buildHydrationFailureDetails(reason: string): string {
  return [
    reason,
    "",
    "Server bases: " + describeServerBases(),
    "Requested quiz id: " + (getRequestedQuizId() || "(none)"),
    "Host bridge:",
    describeHostBridgeState(),
  ].join("\n");
}

function getRecoveredLaunchId(quiz: QuizSpec): string | undefined {
  const revision = quiz.metadata?.quizRevision;
  return typeof revision === "number" && Number.isFinite(revision) ? `${getQuizId(quiz)}:r${revision}` : undefined;
}


async function fetchGradeFromServer(quizId: string, sessionId?: string, recoveryToken?: string): Promise<GradePayload | null> {
  const query = recoveryToken ? "?recoveryToken=" + encodeURIComponent(recoveryToken) : "";
  const path = "/api/grade/" + encodeURIComponent(quizId) + (sessionId ? "/" + encodeURIComponent(sessionId) : "") + query;
  for (const base of getServerBases()) {
    const response = await fetch(base + path, { headers: { accept: "application/json" } }).catch(() => null);
    if (!response?.ok) continue;
    const body = await response.json().catch(() => ({}));
    const record = body as { grade?: GradePayload | null };
    return record.grade ?? null;
  }
  return null;
}

function describeServerBases(): string {
  const bases = getServerBases();
  return bases.length ? bases.join(", ") : "(none)";
}

function buildFinishedFromPersistedSubmission(quiz: QuizSpec, launchId?: string): FinishedSubmission | null {
  const state = getPersistedSubmissionState(getQuizId(quiz), launchId);
  if (!state?.submission) return null;
  const submission = state.submission;
  const session = isMatchingSession(state.session, submission) ? state.session : makeRestoredSession(submission);
  const followUpStatus = getRestoredDeliveryStatus(state, submission);
  return {
    submission,
    session,
    hostSubmitted: submission.status?.hostSubmitted ?? state.status !== "fallback_ready",
    recoveryToken: state.recoveryToken,
    followUpRequested: submission.status?.followUpRequested ?? state.status === "grade_requested",
    followUpStatus,
    followUpAttempts: followUpStatus === "submitted" ? 0 : 1,
    followUpMessage: state.error,
  };
}

function isMatchingSession(session: QuizSession | undefined, submission: SubmissionCapsule): session is QuizSession {
  return Boolean(session && session.quizId === submission.quizId && session.sessionId === submission.sessionId);
}

function makeRestoredSession(submission: SubmissionCapsule): QuizSession {
  return {
    schema: "betterquizzer.session",
    version: 2,
    sessionId: submission.sessionId,
    quizId: submission.quizId,
    startedAt: inferRestoredStartedAt(submission),
    submittedAt: submission.submittedAt,
    mode: submission.mode,
    answers: submission.answers,
  };
}

function inferRestoredStartedAt(submission: SubmissionCapsule): string {
  const submittedMs = Date.parse(submission.submittedAt);
  if (!Number.isFinite(submittedMs)) return submission.submittedAt || new Date().toISOString();
  const longestAnswerMs = submission.answers.reduce((largest, answer) => {
    const timeMs = typeof answer.timeMs === "number" && Number.isFinite(answer.timeMs) ? answer.timeMs : 0;
    return Math.max(largest, timeMs);
  }, 0);
  return new Date(submittedMs - longestAnswerMs).toISOString();
}

function getRestoredDeliveryStatus(state: SubmissionBridgeState, submission: SubmissionCapsule): SubmissionDeliveryStatus {
  if (submission.status?.followUpRequested) return "grade_requested";
  switch (state.status) {
    case "grade_requested":
      return "grade_requested";
    case "requesting_grade":
      return "requesting_grade";
    case "retrying_grade_request":
      return "retrying_grade_request";
    case "fallback_ready":
      return "grade_request_unavailable";
    case "failed":
      return "grade_request_failed";
    case "submitting":
      return "requesting_grade";
    default:
      return "submitted";
  }
}

function toHydrationProgress(payload: HostQuizPayload, quiz: QuizSpec): HydrationProgress {
  const fromPayload = payload.uploadProgress;
  const expectedQuestions = fromPayload?.expectedQuestions ?? payload.declaredQuestionCount ?? payload.questionCount ?? quiz.questions.length;
  const receivedQuestions = fromPayload?.receivedQuestions ?? payload.receivedQuestionCount ?? quiz.questions.length;
  return {
    expectedQuestions,
    receivedQuestions,
    renderableQuestions: fromPayload?.renderableQuestions ?? payload.renderDiagnostics?.renderableQuestionCount,
    complete: fromPayload?.complete ?? receivedQuestions >= expectedQuestions,
  };
}

function launchStabilityKey(payload: HostQuizPayload, quiz: QuizSpec): string {
  return JSON.stringify({
    launchId: payload.launchId ?? null,
    quizRevision: payload.quizRevision ?? null,
    questionCount: payload.questionCount ?? quiz.questions.length,
    fingerprint: quizFingerprint(quiz),
  });
}

function shouldAcceptHydratedQuiz(currentQuiz: QuizSpec | null, nextQuiz: QuizSpec): boolean {
  if (!currentQuiz) return true;
  const currentQuizId = getQuizId(currentQuiz);
  const nextQuizId = getQuizId(nextQuiz);
  if (currentQuizId !== nextQuizId) return true;
  const currentRevision = getQuizRevision(currentQuiz);
  const nextRevision = getQuizRevision(nextQuiz);
  if (nextRevision !== null && currentRevision !== null && nextRevision > currentRevision) return true;
  if (nextRevision !== null && currentRevision !== null && nextRevision < currentRevision) return false;
  if (quizFingerprint(currentQuiz) === quizFingerprint(nextQuiz)) return false;
  return isMoreCompleteQuiz(nextQuiz, currentQuiz);
}

function getQuizRevision(quiz: QuizSpec): number | null {
  const revision = quiz.metadata?.quizRevision;
  return typeof revision === "number" && Number.isFinite(revision) ? revision : null;
}

function isMoreCompleteQuiz(candidate: QuizSpec, current: QuizSpec): boolean {
  if (candidate.questions.length > current.questions.length) return true;
  if (candidate.questions.length < current.questions.length) return false;
  const candidateFilledFields = countRenderableQuestionFields(candidate);
  const currentFilledFields = countRenderableQuestionFields(current);
  return candidateFilledFields > currentFilledFields;
}

function countRenderableQuestionFields(quiz: QuizSpec): number {
  return quiz.questions.reduce((total, question) => {
    let score = 0;
    if (question.id) score += 1;
    if (question.type) score += 1;
    if (question.prompt) score += 1;
    if ("choices" in question && Array.isArray(question.choices)) score += question.choices.length;
    if ("items" in question && Array.isArray(question.items)) score += question.items.length;
    if ("left" in question && Array.isArray(question.left)) score += question.left.length;
    if ("right" in question && Array.isArray(question.right)) score += question.right.length;
    return total + score;
  }, 0);
}

function quizFingerprint(quiz: QuizSpec): string {
  return JSON.stringify({
    quizId: getQuizId(quiz),
    questionCount: quiz.questions.length,
    questionIds: quiz.questions.map((question) => question.id),
    questionTypes: quiz.questions.map((question) => question.type),
    prompts: quiz.questions.map((question) => question.prompt),
  });
}



function BetterQuizzesHomeLegalLinks() {
  if (bqV40IsChatGptHost()) return null;

  return (
    <nav className="home-legal-links" aria-label="Legal links">
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
    </nav>
  );
}

function ImportScreen({ error, onLoadQuiz }: { error: string | null; onLoadQuiz: (quiz: QuizSpec) => void }): ReactElement {
  const [text, setText] = useState("");

  function loadFromText(): void {
    try {
      onLoadQuiz(JSON.parse(text) as QuizSpec);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      alert(`Invalid JSON: ${message}`);
    }
  }

  async function loadFile(file: File): Promise<void> {
    const fileText = await file.text();
    onLoadQuiz(JSON.parse(fileText) as QuizSpec);
  }

  return (
    <main className="shell">
      <section className="hero card">
        <div className="site-brand-row">
          <img className="site-logo" src="/brand/betterquizzes-logo-light.png" alt="" />
          <p className="eyebrow eyebrow-row">BetterQuizzes <span className="version-chip">{WIDGET_VERSION_LABEL}</span></p>
        </div>
        <h1>Interactive quizzes that feel built for the lesson.</h1>
        <p>
          Build, take, and review mixed-format practice quizzes with answer capture, confidence checks, ordering, matching, typed responses, and grade writeback.
        </p>
      </section>

      <section className="project-panel card">
        <div>
          <p className="eyebrow">What it does</p>
          <h2>BetterQuizzes turns a ChatGPT prompt into a real quiz experience.</h2>
          <p>It keeps the chat flexible while giving students a structured place to answer, review, submit, and receive feedback.</p>
        </div>
        <div className="feature-pills" aria-label="BetterQuizzes features">
          <span>Mixed question types</span>
          <span>Draft recovery</span>
          <span>Grade writeback</span>
          <span>Mobile-friendly UI</span>
        </div>
      </section>

      <section className="grid three">
        {SAMPLE_QUIZZES.map((sample) => (
          <button className="sample-card" key={sample.quizId ?? sample.title} type="button" onClick={() => onLoadQuiz(sample)}>
            <span className="badge">Sample</span>
            <strong>{sample.title}</strong>
            <span>{sample.description ?? sample.subject ?? "Demo activity"}</span>
            <small>{sample.questions.length} questions</small>
          </button>
        ))}
      </section>

      
    
      <BetterQuizzesHomeLegalLinks />
</main>
  );
}

function isIncrementalQuizBuilding(quiz: QuizSpec): boolean {
  return getIncrementalGenerationStatus(quiz) !== null;
}

function shouldPollForServerQuizUpdates(quiz: QuizSpec, progress: HydrationProgress | null): boolean {
  if (isIncrementalQuizBuilding(quiz)) return true;
  if (!progress || progress.complete === true) return false;
  return progress.expectedQuestions > quiz.questions.length;
}

function getIncrementalGenerationStatus(quiz: QuizSpec): { expected: number; ready: number } | null {
  const record = quiz as unknown as Record<string, unknown>;
  const metadata = record.metadata && typeof record.metadata === "object" ? record.metadata as Record<string, unknown> : {};
  const expected = Number(record.expectedQuestionCount ?? metadata.expectedQuestionCount ?? metadata.declaredQuestionCount ?? quiz.questions.length);
  if (!Number.isFinite(expected) || expected <= quiz.questions.length) return null;
  return { expected: Math.max(1, Math.floor(expected)), ready: quiz.questions.length };
}

function QuizRunner({
  quiz,
  startedAt,
  launchId,
  recoveryToken,
  widgetMode,
  onReset,
  onFinish,
}: {
  quiz: QuizSpec;
  startedAt: string;
  launchId?: string;
  recoveryToken?: string;
  widgetMode: boolean;
  onReset: () => void;
  onFinish: (finished: FinishedSubmission) => void;
}): ReactElement {
  const restoredDraftState = useMemo(() => widgetMode ? getPersistedDraftState(getQuizId(quiz), launchId) : null, [widgetMode, quiz, launchId]);
  const [currentIndex, setCurrentIndex] = useState(() => clampIndex(restoredDraftState?.currentIndex ?? 0, quiz.questions.length));
  const [drafts, setDrafts] = useState<Record<string, DraftAnswer>>(() => sanitizeRestoredDrafts(restoredDraftState?.drafts, quiz));
  const [submitting, setSubmitting] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipMode, setSkipMode] = useState<"prompt" | "skipped" | null>(null);
  const knownQuestionIdsRef = useRef<Set<string>>(new Set(quiz.questions.map((question) => question.id)));
  const [arrivingQuestionIds, setArrivingQuestionIds] = useState<Set<string>>(() => new Set());
  const displayPolicy = normalizeDisplayPolicy(quiz.displayPolicy);
  const gradingPolicy = normalizeGradingPolicy(quiz.gradingPolicy);
  const activityPolicy = normalizeActivityPolicy(quiz.activityPolicy);
  const current = quiz.questions[currentIndex];
// V17 scroll active question into view after navigation so short questions do not leave the user stranded lower in the message.
  useEffect(() => {
    const id = window.setTimeout(() => {
      const card = document.querySelector(".question-card");
      card?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 40);
    return () => window.clearTimeout(id);
  }, [currentIndex]);
  const requiredQuestions = quiz.questions.filter((question) => isQuestionRequired(question, activityPolicy));
  const completeQuestionCount = quiz.questions.filter((question) => isQuestionDoneForNavigation(question, drafts[question.id], displayPolicy)).length;
  const allQuestionsDone = quiz.questions.length > 0 && completeQuestionCount === quiz.questions.length;
  const isLastQuestion = quiz.questions.length > 0 && currentIndex === quiz.questions.length - 1;
  const submitLooksReady = allQuestionsDone || isLastQuestion;
  const submitIssue = getSubmitIssue(quiz, drafts, displayPolicy, activityPolicy, startedAt);
  const generationStatus = getIncrementalGenerationStatus(quiz);
  const progressTotal = generationStatus?.expected ?? quiz.questions.length;
  const progressPercent = progressTotal ? Math.round((completeQuestionCount / progressTotal) * 100) : 100;
  const shouldShowQuestionNav = quiz.questions.length > 1 || Boolean(generationStatus);
  const answeredCount = quiz.questions.filter((question) => hasResponse(drafts[question.id])).length;

  useEffect(() => {
    setCurrentIndex((index) => clampIndex(index, quiz.questions.length));
    setDrafts((previous) => keepDraftsForQuiz(previous, quiz));
    const known = knownQuestionIdsRef.current;
    const incoming = quiz.questions.map((question) => question.id).filter((id) => !known.has(id));
    if (!incoming.length) return;
    incoming.forEach((id) => known.add(id));
    setArrivingQuestionIds((previous) => new Set([...previous, ...incoming]));
    const timeout = window.setTimeout(() => {
      setArrivingQuestionIds((previous) => {
        const next = new Set(previous);
        incoming.forEach((id) => next.delete(id));
        return next;
      });
    }, 1800);
    return () => window.clearTimeout(timeout);
  }, [quiz]);

  useEffect(() => {
    if (!widgetMode) return;
    persistWidgetState({
      kind: "betterquizzer.answer_state",
      status: "answering",
      quizId: getQuizId(quiz),
      launchId,
      recoveryToken,
      currentIndex,
      drafts: keepDraftsForQuiz(drafts, quiz),
      updatedAt: new Date().toISOString(),
    });
  }, [widgetMode, quiz, launchId, recoveryToken, currentIndex, drafts]);

  useEffect(() => {
    const currentQuestion = quiz.questions[currentIndex];
    if (!currentQuestion || currentQuestion.type !== "ordering") return;
    const items = getOrderingItems(currentQuestion);
    if (!items.length) return;
    setDrafts((previous) => {
      const existing = previous[currentQuestion.id];
      if (hasResponse(existing)) return previous;
      const now = Date.now();
      return {
        ...previous,
        [currentQuestion.id]: {
          response: bqV26AvoidAlreadyCorrectOrdering(currentQuestion, items, getInitialOrderingOrder(currentQuestion, items)),
          confidence: existing?.confidence,
          firstSeenAt: existing?.firstSeenAt ?? now,
          lastUpdatedAt: existing?.lastUpdatedAt ?? now,
        },
      };
    });
  }, [quiz, currentIndex]);

  function updateDraft(questionId: string, patch: Partial<DraftAnswer>): void {
    setDrafts((previous) => {
      const now = Date.now();
      const previousDraft = previous[questionId] ?? { response: null, firstSeenAt: now, lastUpdatedAt: now };
      const question = quiz.questions.find((item) => item.id === questionId);
      const merged: DraftAnswer = {
        ...previousDraft,
        ...patch,
        firstSeenAt: clampDraftFirstSeenAt(previousDraft.firstSeenAt, startedAt, now),
        lastUpdatedAt: now,
      };
      // Preserve confidence while a user temporarily clears or edits an answer.
      // The UI hides/disables confidence for incomplete answers, but restores
      // the previous value when the question becomes complete again.
      void question;
      return { ...previous, [questionId]: merged };
    });
  }

  function skipQuiz(): void {
    setError(null);
    setSkipMode("prompt");
  }

  function exitWithoutGrading(): void {
    if (widgetMode) {
      persistSubmissionState({
        status: "skipped",
        quizId: getQuizId(quiz),
        launchId,
        recoveryToken,
        currentIndex,
        drafts,
        error: "User skipped the quiz before submission.",
      });
    }
    setSkipMode("skipped");
  }

  async function finish(options: { allowIncomplete?: boolean } = {}): Promise<void> {
    if (submitting) return;
    setSubmitAttempted(true);
    const records = makeAnswerRecords(quiz, drafts, startedAt);
    const completion = buildCompletionSummary(quiz, records, displayPolicy, activityPolicy);
    if (activityPolicy.submitRequiresRequiredAnswers && !completion.isComplete && !options.allowIncomplete) {
      const firstMissingId = completion.missingRequiredQuestionIds[0] ?? completion.missingRequiredConfidenceIds[0];
      if (firstMissingId) {
        const nextIndex = quiz.questions.findIndex((question) => question.id === firstMissingId);
        if (nextIndex >= 0) setCurrentIndex(nextIndex);
      }
      setError(formatSubmitIssue(quiz, completion.missingRequiredQuestionIds, completion.missingRequiredConfidenceIds));
      return;
    }

    setSubmitting(true);
    setError(null);
    const session = createSession(quiz, records, startedAt);
    const submission = createSubmissionCapsule(quiz, session);
    if (launchId) submission.launchId = launchId;
    if (typeof quiz.metadata?.quizRevision === "number") submission.quizRevision = quiz.metadata.quizRevision;

    submission.status = {
      ...(submission.status ?? { localSaved: true, hostSubmitted: false, followUpRequested: false, duplicateSubmission: false, warnings: [] }),
      localSaved: true,
      hostSubmitted: false,
      followUpRequested: false,
    };

    if (widgetMode) {
      persistSubmissionState({
        status: "submitting",
        quizId: submission.quizId,
        launchId,
        recoveryToken,
        currentIndex,
        drafts,
        session,
        submission,
      });
    }

    let bqV44EarlyFollowUpResult: Awaited<ReturnType<typeof sendSubmissionFollowUp>> | null = null;

    if (widgetMode && bqV44ShouldUseEarlyMobileFollowUp()) {
      bqV44EarlyFollowUpResult = await sendSubmissionFollowUp(buildLlmReturnPrompt(submission), 4500);

      if (bqV44EarlyFollowUpResult.status === "sent") {
        submission.status = {
          ...(submission.status ?? { localSaved: true, hostSubmitted: false, followUpRequested: false, duplicateSubmission: false, warnings: [] }),
          followUpRequested: true,
        };

        persistSubmissionState({
          status: "grade_requested",
          quizId: submission.quizId,
          launchId,
          recoveryToken,
          currentIndex,
          drafts,
          session,
          submission,
        });
      }
    }

    let hostSubmitted = false;
    let bridgeError: string | null = null;
    let hostResult: ToolResultLike | null = null;

    try {
      if (widgetMode) {
        try {
          hostResult = await submitToHost(submission, 8000);
          hostSubmitted = Boolean(hostResult);
        } catch (toolError) {
          bridgeError = toolError instanceof Error ? toolError.message : String(toolError);
        }

        submission.status = {
          ...(submission.status ?? { localSaved: true, hostSubmitted: false, followUpRequested: false, duplicateSubmission: false, warnings: [] }),
          hostSubmitted,
          warnings: uniqueWarnings([
            ...(submission.status?.warnings ?? []),
            ...(bridgeError ? [`Answers were saved locally, but the host submit bridge reported: ${bridgeError}`] : []),
          ]),
        };

        persistSubmissionState({
          status: hostSubmitted ? "submitted" : "fallback_ready",
          quizId: submission.quizId,
          launchId,
          recoveryToken,
          currentIndex,
          drafts,
          session,
          submission,
          hostResult: summarizeToolResult(hostResult),
          error: bridgeError ?? undefined,
        });
      }

      const bqV44EarlyFollowUpSent = bqV44EarlyFollowUpResult?.status === "sent";
      const firstStatus: SubmissionDeliveryStatus = bqV44EarlyFollowUpSent ? "grade_requested" : widgetMode ? "requesting_grade" : "submitted";
      onFinish({ submission, session, hostSubmitted, recoveryToken, followUpRequested: bqV44EarlyFollowUpSent, followUpStatus: firstStatus, followUpAttempts: 0, followUpMessage: bridgeError ?? undefined });

      if (widgetMode) {
        void requestChatGptGradeOnce({
          submission,
          session,
          hostSubmitted,
          currentIndex,
          drafts,
          hostResult,
          launchId,
          recoveryToken,
          onUpdate: onFinish,
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (skipMode) {
    return (
      <SkipQuizScreen
        mode={skipMode}
        widgetMode={widgetMode}
        title={quiz.title}
        answeredCount={answeredCount}
        totalCount={quiz.questions.length}
        submitting={submitting}
        onResume={() => setSkipMode(null)}
        onSubmitAnswered={() => void finish({ allowIncomplete: true })}
        onExitWithoutGrading={exitWithoutGrading}
        onNewQuiz={onReset}
      />
    );
  }

  if (!current) {
    return (
      <main className="shell narrow">
        <section className="card stack">
          <h1>This question could not be found.</h1>
          <button type="button" onClick={onReset}>Back to import</button>
        </section>
      </main>
    );
  }

  return (
    <main className="shell quiz-layout">
      <section className="top-bar card">
        <div>
          <div className="eyebrow-row"><p className="eyebrow">BetterQuizzes</p><span className="version-chip">{WIDGET_VERSION_LABEL}</span></div>
          <h1><RichInline text={quiz.title} /></h1>
          {quiz.description ? <RichBlock text={quiz.description} /> : null}
        </div>
        <div className="top-actions">
          {!widgetMode ? <button type="button" onClick={onReset}>New quiz</button> : null}
          {activityPolicy.allowSkipQuiz ? <button className="skip-quiz-button" type="button" onClick={() => skipQuiz()}>Skip</button> : null}
        </div>
        <div className="progress-shell" aria-label="Quiz progress"><span style={{ width: `${progressPercent}%` }} /></div>
        {generationStatus ? (
          <div className="generation-status-strip" aria-live="polite">
            <span className="generation-status-spinner" aria-hidden="true" />
            <span>Questions are being added: {generationStatus.ready} of {generationStatus.expected} ready</span>
          </div>
        ) : null}
      </section>

      {shouldShowQuestionNav ? <QuestionNav questions={quiz.questions} expectedQuestionCount={generationStatus?.expected} drafts={drafts} currentIndex={currentIndex} arrivingQuestionIds={arrivingQuestionIds} displayPolicy={displayPolicy} activityPolicy={activityPolicy} revealRequiredStatus={submitAttempted} onSelect={setCurrentIndex} /> : null}

      <section className="main-column">
        <QuestionCard question={current} draft={drafts[current.id]} isArriving={arrivingQuestionIds.has(current.id)} displayPolicy={displayPolicy} activityPolicy={activityPolicy} revealRequiredStatus={submitAttempted} quizChoiceBehavior={quiz.choiceBehavior} onChange={(draft) => updateDraft(current.id, draft)} />
        {submitAttempted && error ? <div className="notice-box" role="status">{error}</div> : null}
        <div className={`actions split compact-actions ${quiz.questions.length <= 1 ? "single-question-actions" : ""}`}>
          {quiz.questions.length > 1 ? (
            <div className="actions">
              <button type="button" disabled={currentIndex === 0} onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}>Previous</button>
              <button className={!allQuestionsDone && currentIndex < quiz.questions.length - 1 ? "primary next-primary" : undefined} type="button" disabled={currentIndex === quiz.questions.length - 1} onClick={() => setCurrentIndex((index) => Math.min(quiz.questions.length - 1, index + 1))}>Next</button>
            </div>
          ) : null}
          <div className="submit-column">
            <button className={submitLooksReady ? "primary submit-ready" : "submit-not-ready"} type="button" disabled={submitting} title={submitAttempted && submitIssue ? submitIssue : !allQuestionsDone ? "You can submit, but unfinished questions remain." : undefined} onClick={() => void finish()}>{submitting ? "Submitting..." : widgetMode ? "Submit to ChatGPT" : "Create submission"}</button>
          </div>
        </div>
      </section>
    </main>
  );
}


function SkipQuizScreen({
  mode,
  widgetMode,
  title,
  answeredCount,
  totalCount,
  submitting,
  onResume,
  onSubmitAnswered,
  onExitWithoutGrading,
  onNewQuiz,
}: {
  mode: "prompt" | "skipped";
  widgetMode: boolean;
  title: string;
  answeredCount: number;
  totalCount: number;
  submitting: boolean;
  onResume: () => void;
  onSubmitAnswered: () => void;
  onExitWithoutGrading: () => void;
  onNewQuiz: () => void;
}): ReactElement {
  if (mode === "skipped") {
    return (
      <main className="shell narrow result-shell">
        <section className="card result-hero stack">
          <p className="eyebrow eyebrow-row">Quiz skipped <span className="version-chip">{WIDGET_VERSION_LABEL}</span></p>
          <h1>No grade was created</h1>
          <p>You exited “{title}” before submitting answers for grading.</p>
          <div className="submission-status-grid user-status-grid">
            <span>{answeredCount}/{totalCount} questions had draft answers</span>
            <span>Grading not requested</span>
          </div>

        <div className="actions wrap">
            <button className="primary" type="button" onClick={onResume}>Resume quiz</button>
            {!widgetMode ? <button type="button" onClick={onNewQuiz}>Start another quiz</button> : null}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="shell narrow result-shell">
      <section className="card result-hero stack">
        <p className="eyebrow eyebrow-row">Leave quiz? <span className="version-chip">{WIDGET_VERSION_LABEL}</span></p>
        <h1>{answeredCount > 0 ? "Submit what you answered?" : "Exit without grading?"}</h1>
        <p>{answeredCount > 0 ? `You have answered ${answeredCount} of ${totalCount} questions. You can submit those answers for grading, resume the quiz, or exit without creating a grade.` : "You have not answered anything yet. You can resume the quiz or exit without creating a grade."}</p>
        <div className="actions wrap">
          <button className="primary" type="button" disabled={answeredCount === 0 || submitting} onClick={onSubmitAnswered}>{submitting ? "Submitting…" : "Submit answered questions"}</button>
          <button type="button" onClick={onResume}>Resume quiz</button>
          <button type="button" onClick={onExitWithoutGrading}>Exit without grading</button>
        </div>
      </section>
    </main>
  );
}

function QuestionNav({
  questions,
  expectedQuestionCount,
  drafts,
  currentIndex,
  arrivingQuestionIds,
  displayPolicy,
  activityPolicy,
  revealRequiredStatus,
  onSelect,
}: {
  questions: Question[];
  expectedQuestionCount?: number;
  drafts: Record<string, DraftAnswer>;
  currentIndex: number;
  arrivingQuestionIds: Set<string>;
  displayPolicy: DisplayPolicy;
  activityPolicy: ActivityPolicy;
  revealRequiredStatus: boolean;
  onSelect: (index: number) => void;
}): ReactElement {
  const plannedCount = Math.max(questions.length, Math.floor(expectedQuestionCount ?? questions.length));
  const placeholderCount = Math.max(0, plannedCount - questions.length);
  return (
    <aside className="card nav-card">
      <p className="eyebrow">Questions</p>
      <div className="question-dots">
        {questions.map((question, index) => {
          const status = getQuestionStatus(question, drafts[question.id], displayPolicy, activityPolicy, revealRequiredStatus);
          return <button key={question.id} type="button" className={`dot ${index === currentIndex ? "active" : ""} ${arrivingQuestionIds.has(question.id) ? "new-question" : ""} ${status}`} onClick={() => onSelect(index)}>{index + 1}</button>;
        })}
        {Array.from({ length: placeholderCount }, (_, index) => (
          <span key={`planned-${questions.length + index + 1}`} className="dot planned-question" aria-hidden="true" />
        ))}
      </div>
    </aside>
  );
}

function QuestionCard({ question, draft, isArriving = false, displayPolicy, activityPolicy, revealRequiredStatus, quizChoiceBehavior, onChange }: { question: Question; draft: DraftAnswer | undefined; isArriving?: boolean; displayPolicy: DisplayPolicy; activityPolicy: ActivityPolicy; revealRequiredStatus: boolean; quizChoiceBehavior?: QuizSpec["choiceBehavior"]; onChange: (draft: Partial<DraftAnswer>) => void }): ReactElement {
  const status = getQuestionStatus(question, draft, displayPolicy, activityPolicy, revealRequiredStatus);
  const required = isQuestionRequired(question, activityPolicy);
  const answerComplete = isQuestionAnswerComplete(question, draft);
  const confidenceRequired = isConfidenceRequiredForQuestion(question, displayPolicy);
  const confidenceValue = answerComplete && confidenceRequired ? normalizeConfidence(draft?.confidence) : undefined;
  return (
    <section className={`card question-card ${isArriving ? "new-question" : ""} ${status}`}>
      <div className="question-header">
        {!required ? <span className="question-meta-label">Optional</span> : null}
      </div>
      <h2><RichInline text={question.prompt} /></h2>
      <QuestionInput question={question} draft={draft} quizChoiceBehavior={question.choiceBehavior ?? quizChoiceBehavior} onChange={onChange} />
      {confidenceRequired ? <section className={answerComplete ? "confidence-section unlocked" : "confidence-section locked"}>
        <div><p className="confidence-heading">Confidence</p></div>
        <ConfidencePicker value={confidenceValue} required={confidenceRequired && revealRequiredStatus} disabled={!answerComplete} onChange={(confidence) => onChange({ confidence })} />
      </section> : null}
    </section>
  );
}

function QuestionInput({ question, draft, quizChoiceBehavior, onChange }: { question: Question; draft: DraftAnswer | undefined; quizChoiceBehavior?: QuizSpec["choiceBehavior"]; onChange: (draft: Partial<DraftAnswer>) => void }): ReactElement {
  const response = draft?.response;
  switch (question.type) {
    case "multiple_choice":
      return <ChoiceList question={question} quizChoiceBehavior={quizChoiceBehavior} response={response} onChange={(nextResponse) => onChange({ response: nextResponse })} />;
    case "multi_select":
      return <MultiSelectList question={question} quizChoiceBehavior={quizChoiceBehavior} response={response} onChange={(nextResponse) => onChange({ response: nextResponse })} />;
    case "true_false":
      return <TrueFalseList selected={typeof response === "boolean" ? response : null} onSelect={(value) => onChange({ response: value })} />;
    case "fill_blank":
      return <TextField label="Your answer" placeholder={question.placeholder ?? "Type your answer..."} value={typeof response === "string" ? response : ""} responseLimit={getResponseLimit(question)} formatting={(question as { formatting?: boolean }).formatting === true} onChange={(value) => onChange({ response: value })} />;
    case "short_answer":
      return <TextArea label="Short answer" value={typeof response === "string" ? response : ""} responseLimit={getResponseLimit(question)} formatting={(question as { formatting?: boolean }).formatting === true} onChange={(value) => onChange({ response: value })} />;
    case "long_response":
      return <TextArea label="Long response" value={typeof response === "string" ? response : ""} responseLimit={getResponseLimit(question)} formatting={(question as { formatting?: boolean }).formatting === true} onChange={(value) => onChange({ response: value })} rows={8} />;
    case "multi_typing":
      return <MultiTypingInput question={question} response={isMultiTypingResponse(response) ? response : {}} onChange={(value) => onChange({ response: value })} />;
    case "multi_write_vertical":
      return <MultiWriteVerticalInput question={question} response={isMultiTypingResponse(response) ? response : {}} onChange={(value) => onChange({ response: value })} />;
    case "text_select":
      return <TextSelectInput question={question} response={Array.isArray(response) ? response.filter((item): item is string => typeof item === "string") : []} onChange={(value) => onChange({ response: value })} />;
    case "numeric":
      return <TextField label={question.unit ? `Number (${question.unit})` : "Number"} inputMode="text" value={typeof response === "number" || typeof response === "string" ? String(response) : ""} onChange={(value) => onChange({ response: value })} />;
    case "ordering":
      return <OrderingInput question={question} response={Array.isArray(response) ? response.filter((item): item is string => typeof item === "string") : []} onChange={(value) => onChange({ response: value })} />;
    case "matching":
      return <MatchingInput question={question} response={isMatchingPairs(response) ? response : []} onChange={(value) => onChange({ response: value })} />;
    default:
      return <QuestionRenderWarning question={question} detail="This question has a missing or unsupported type." />;
  }
}

function QuestionRenderWarning({ question, detail }: { question: Question; detail: string }): ReactElement {
  return (
    <section className="question-render-warning">
      <strong>Question setup issue</strong>
      <p>{detail}</p>
      <p className="muted compact-status">questionId: {safeText(question.id) || "(missing)"} • type: {formatQuestionType(question.type)}</p>
    </section>
  );
}

type ChoiceLike = { choices?: unknown };
function getChoiceTexts(question: ChoiceLike): string[] {
  if (!Array.isArray(question.choices)) return [];

  return question.choices
    .map((choice, index) => {
      if (typeof choice === "string") return choice;
      if (choice && typeof choice === "object") {
        const record = choice as Record<string, unknown>;
        return safeText(record.text ?? record.label ?? record.value ?? record.id ?? `Choice ${index + 1}`);
      }
      return "";
    })
    .filter((text) => text.trim().length > 0);
}

function safeText(value: unknown): string {
  return String(value ?? "");
}

function formatQuestionType(type: unknown): string {
  return safeText(type || "unknown_question").replaceAll("_", " ");
}

function RichInline({ text }: { text: unknown }): ReactElement {
  return <span className="rich-text">{renderInlineMarkup(safeText(text), "ri")}</span>;
}

function RichBlock({ text }: { text: unknown }): ReactElement {
  const paragraphs = safeText(text).split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  if (!paragraphs.length) return <p />;
  return (
    <>
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="rich-text rich-block">{renderInlineMarkup(paragraph, `rb-${index}`)}</p>
      ))}
    </>
  );
}

function renderInlineMarkup(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenPattern = /(\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\*\*[^*]+\*\*|<u>[\s\S]*?<\/u>|<sub>[\s\S]*?<\/sub>|<sup>[\s\S]*?<\/sup>|`[^`]+`|\*[^*]+\*)/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(text)) !== null) {
    if (match.index > cursor) appendTextWithBreaks(nodes, text.slice(cursor, match.index), `${keyPrefix}-t-${cursor}`);
    const token = match[0];
    const key = `${keyPrefix}-m-${match.index}`;
    if (token.startsWith("\\(") && token.endsWith("\\)")) nodes.push(<MathNode key={key} value={token.slice(2, -2)} displayMode={false} fallback={token} />);
    else if (token.startsWith("\\[") && token.endsWith("\\]")) nodes.push(<MathNode key={key} value={token.slice(2, -2)} displayMode fallback={token} />);
    else if (token.startsWith("**") && token.endsWith("**")) nodes.push(<strong key={key}>{renderInlineMarkup(token.slice(2, -2), `${key}-b`)}</strong>);
    else if (/^<u>/i.test(token)) nodes.push(<u key={key}>{renderInlineMarkup(token.slice(3, -4), `${key}-u`)}</u>);
    else if (/^<sub>/i.test(token)) nodes.push(<sub key={key}>{renderInlineMarkup(token.slice(5, -6), `${key}-sub`)}</sub>);
    else if (/^<sup>/i.test(token)) nodes.push(<sup key={key}>{renderInlineMarkup(token.slice(5, -6), `${key}-sup`)}</sup>);
    else if (token.startsWith("`") && token.endsWith("`")) nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("*") && token.endsWith("*")) nodes.push(<em key={key}>{renderInlineMarkup(token.slice(1, -1), `${key}-i`)}</em>);
    else appendTextWithBreaks(nodes, token, key);
    cursor = match.index + token.length;
  }
  if (cursor < text.length) appendTextWithBreaks(nodes, text.slice(cursor), `${keyPrefix}-t-${cursor}`);
  return nodes.length ? nodes : [text];
}

function MathNode({ value, displayMode, fallback }: { value: string; displayMode: boolean; fallback: string }): ReactElement {
  try {
    const html = katex.renderToString(value, {
      displayMode,
      throwOnError: false,
      strict: "warn",
      trust: false,
    });
    return <span className={displayMode ? "math-node math-display" : "math-node math-inline"} dangerouslySetInnerHTML={{ __html: html }} />;
  } catch {
    return <span>{fallback}</span>;
  }
}

function appendTextWithBreaks(nodes: ReactNode[], text: string, keyPrefix: string): void {
  const parts = text.split(/\n/);
  parts.forEach((part, index) => {
    if (index > 0) nodes.push(<br key={`${keyPrefix}-br-${index}`} />);
    if (part) nodes.push(part);
  });
}


function getOrderingItems(question: unknown): { id: string; text: string }[] {
  const record = question && typeof question === "object" ? question as { items?: unknown } : {};
  if (!Array.isArray(record.items)) return [];
  return record.items
    .filter((item): item is { id: unknown; text: unknown } => Boolean(item) && typeof item === "object" && "id" in item && "text" in item)
    .map((item) => ({ id: String(item.id), text: String(item.text) }))
    .filter((item) => item.id.trim().length > 0 && item.text.trim().length > 0);
}

function isRenderableOrderingDragText(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 0 && normalized.length <= ORDERING_ITEM_TEXT_MAX_CHARS && !/[\r\n]/.test(text);
}

function limitForDisplay(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxChars ? normalized.slice(0, Math.max(0, maxChars - 1)) + "..." : normalized;
}


function bqV23OrderingKey(item: unknown): string {
  if (item && typeof item === "object") {
    const record = item as Record<string, unknown>;
    return String(record.id ?? record.value ?? record.label ?? record.text ?? JSON.stringify(record));
  }

  return String(item);
}

function bqV23SameOrdering(left: unknown[], right: unknown[]): boolean {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length || left.length < 2) return false;
  return left.every((item, index) => bqV23OrderingKey(item) === bqV23OrderingKey(right[index]));
}

function bqV23AvoidAlreadyCorrectOrdering(question: unknown, items: unknown[], initialOrder: unknown[]): unknown[] {
  const record = question && typeof question === "object" ? question as Record<string, unknown> : {};
  const answerOrder =
    record.answer ??
    record.correctAnswer ??
    record.correctOrder ??
    record.answerKey ??
    record.order ??
    items;

  if (!Array.isArray(initialOrder) || initialOrder.length < 2) return initialOrder;
  if (!Array.isArray(answerOrder) || !bqV23SameOrdering(initialOrder, answerOrder)) return initialOrder;

  return [...initialOrder.slice(1), initialOrder[0]];
}


function bqV26OrderingKey(item: unknown): string {
  if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") return String(item);

  if (item && typeof item === "object") {
    const record = item as Record<string, unknown>;
    return String(record.id ?? record.value ?? record.label ?? record.text ?? JSON.stringify(record));
  }

  return String(item ?? "");
}

function bqV26SameOrdering(left: unknown[], right: unknown[]): boolean {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length || left.length < 2) return false;
  return left.every((item, index) => bqV26OrderingKey(item) === bqV26OrderingKey(right[index]));
}

function bqV26QuestionAnswerOrder(question: Question, items: { id: string; text: string }[]): unknown[] {
  const record = question as Record<string, unknown>;
  const candidate = record.answer ?? record.correctAnswer ?? record.correctOrder ?? record.answerKey ?? record.order;
  if (Array.isArray(candidate)) return candidate;
  return items.map((item) => item.id);
}

function bqV26AvoidAlreadyCorrectOrdering(question: Question, items: { id: string; text: string }[], order: string[]): string[] {
  if (!Array.isArray(order) || order.length < 2) return order;
  const answerOrder = bqV26QuestionAnswerOrder(question, items);
  if (!bqV26SameOrdering(order, answerOrder)) return order;
  return [...order.slice(1), order[0]];
}


function bqV27OrderingKey(item: unknown): string {
  if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") return String(item);

  if (item && typeof item === "object") {
    const record = item as Record<string, unknown>;
    return String(record.id ?? record.value ?? record.label ?? record.text ?? JSON.stringify(record));
  }

  return String(item ?? "");
}

function bqV27SameOrdering(left: unknown[], right: unknown[]): boolean {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length || left.length < 2) return false;
  return left.every((item, index) => bqV27OrderingKey(item) === bqV27OrderingKey(right[index]));
}

function bqV27AnswerOrder(question: Question, items: { id: string; text: string }[]): unknown[] {
  const record = question as Record<string, unknown>;
  const candidate = record.answer ?? record.correctAnswer ?? record.correctOrder ?? record.answerKey ?? record.order;

  if (Array.isArray(candidate)) return candidate;

  return items.map((item) => item.id);
}

function bqV27OrderingInitialOrder(question: Question): string[] {
  const items = getOrderingItems(question);
  const baseOrder = getInitialOrderingOrder(question, items);

  if (!Array.isArray(baseOrder) || baseOrder.length < 2) return baseOrder;

  const answerOrder = bqV27AnswerOrder(question, items);

  if (!bqV27SameOrdering(baseOrder, answerOrder)) return baseOrder;

  return [...baseOrder.slice(1), baseOrder[0]];
}

function bqV27OrderingDisplayOrder(question: Question, draft?: DraftAnswer | null): string[] {
  const response = draft?.response;

  if (Array.isArray(response) && response.length > 0) {
    return response.map((item) => String(item));
  }

  return bqV27OrderingInitialOrder(question);
}

function getInitialOrderingOrder(question: unknown, items = getOrderingItems(question)): string[] {
  const itemIds = items.map((item) => item.id);
  const record = question && typeof question === "object" ? question as { answer?: unknown } : {};
  const answer = Array.isArray(record.answer)
    ? record.answer.filter((id): id is string => typeof id === "string")
    : [];
  if (itemIds.length > 1 && answer.length === itemIds.length && answer.every((id, index) => id === itemIds[index])) {
    return [...itemIds.slice(1), itemIds[0]];
  }
  return itemIds;
}

function normalizeOrderingResponse(response: string[], items: { id: string; text: string }[]): string[] {
  const itemIds = items.map((item) => item.id);
  const allowed = new Set(itemIds);
  const seen = new Set<string>();
  const filtered = response.filter((id) => {
    if (!allowed.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return [...filtered, ...itemIds.filter((id) => !seen.has(id))];
}

type MatchingLike = { left?: unknown; right?: unknown };
function getMatchingSide(question: MatchingLike, side: "left" | "right"): { id: string; text: string }[] {
  const raw = side === "left" ? question.left : question.right;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is { id: unknown; text: unknown } => Boolean(item) && typeof item === "object" && "id" in item && "text" in item)
    .map((item) => ({ id: String(item.id), text: String(item.text) }))
    .filter((item) => item.id.trim().length > 0 && item.text.trim().length > 0);
}

type MultiTypingLike = { fields?: unknown; responseLimit?: ResponseLimit | null };
type MultiTypingFieldRender = { id: string; label: string; placeholder?: string; responseLimit?: ResponseLimit | null };
function getMultiTypingFields(question: MultiTypingLike): MultiTypingFieldRender[] {
  if (!Array.isArray(question.fields)) return [];
  return question.fields
    .filter((field): field is { id: unknown; label: unknown; placeholder?: unknown; responseLimit?: unknown } => Boolean(field) && typeof field === "object" && "id" in field && "label" in field)
    .map((field) => ({
      id: String(field.id),
      label: String(field.label),
      placeholder: typeof field.placeholder === "string" ? field.placeholder : undefined,
      responseLimit: getFieldResponseLimit(field.responseLimit),
    }))
    .filter((field) => field.id.trim().length > 0 && field.label.trim().length > 0);
}

function getFieldResponseLimit(raw: unknown): ResponseLimit | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const maxChars = record.maxChars === null ? null : typeof record.maxChars === "number" && Number.isFinite(record.maxChars) ? Math.max(0, Math.floor(record.maxChars)) : undefined;
  const minChars = typeof record.minChars === "number" && Number.isFinite(record.minChars) ? Math.max(0, Math.floor(record.minChars)) : undefined;
  const showCounter = typeof record.showCounter === "boolean" ? record.showCounter : undefined;
  return { maxChars, minChars, showCounter };
}

function isMultiTypingResponse(value: unknown): value is Record<string, string> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !("kind" in (value as Record<string, unknown>)) && Object.values(value as Record<string, unknown>).every((item) => typeof item === "string");
}

type TextSelectLike = { segments?: unknown; selectionPolicy?: unknown; selectPolicy?: unknown; selection?: unknown; select?: unknown };
type TextSelectSegmentRender = { id: string; text: string; selectable?: boolean };
type TextSelectPolicyRender = { mode: "exact_count" | "all_that_apply" | "range"; count?: number; min?: number; max?: number; instruction?: string };

function getTextSelectSegments(question: TextSelectLike): TextSelectSegmentRender[] {
  if (!Array.isArray(question.segments)) return [];
  return question.segments.flatMap((segment, index): TextSelectSegmentRender[] => {
    if (typeof segment === "string") {
      const text = segment.trim();
      return text ? [{ id: "segment" + (index + 1), text, selectable: true }] : [];
    }
    if (!segment || typeof segment !== "object" || Array.isArray(segment)) return [];
    const record = segment as Record<string, unknown>;
    const id = String(record.id ?? "segment" + (index + 1)).trim();
    const text = String(record.text ?? record.label ?? record.value ?? "").trim();
    if (!id || !text) return [];
    return [{ id, text, selectable: record.selectable === false ? false : true }];
  });
}

function getTextSelectPolicy(question: TextSelectLike): TextSelectPolicyRender {
  const raw = question.selectionPolicy ?? question.selectPolicy ?? question.selection ?? question.select;
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const rawMode = String(record.mode ?? record.kind ?? record.selectionMode ?? "");
  const count = toPositiveInteger(record.count ?? record.selectCount ?? record.requiredSelections);
  const min = toNonNegativeInteger(record.min ?? record.minSelections);
  const max = toPositiveInteger(record.max ?? record.maxSelections);
  const mode: TextSelectPolicyRender["mode"] = rawMode === "exact_count" || rawMode === "exact" || count !== undefined
    ? "exact_count"
    : rawMode === "range" || min !== undefined || max !== undefined
      ? "range"
      : "all_that_apply";
  const instruction = typeof record.instruction === "string" && record.instruction.trim() ? record.instruction.trim() : undefined;
  return { mode, ...(count !== undefined ? { count } : {}), ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), ...(instruction ? { instruction } : {}) };
}

function getTextSelectMaxSelections(policy: TextSelectPolicyRender): number | null {
  if (policy.mode === "exact_count" && typeof policy.count === "number") return policy.count;
  if (typeof policy.max === "number") return policy.max;
  return null;
}

function getTextSelectInstruction(policy: TextSelectPolicyRender): string {
  if (policy.instruction) return policy.instruction;
  if (policy.mode === "exact_count") return "Select " + (policy.count ?? 1) + " segment" + ((policy.count ?? 1) === 1 ? "." : "s.");
  if (policy.mode === "range") {
    if (policy.min !== undefined && policy.max !== undefined) return "Select " + policy.min + " to " + policy.max + " segments.";
    if (policy.min !== undefined) return "Select at least " + policy.min + " segment" + (policy.min === 1 ? "." : "s.");
    if (policy.max !== undefined) return "Select up to " + policy.max + " segment" + (policy.max === 1 ? "." : "s.");
  }
  return "Select all that apply.";
}

function isTextSelectComplete(question: Extract<Question, { type: "text_select" }>, response: unknown): boolean {
  if (!Array.isArray(response) || !response.every((item) => typeof item === "string")) return false;
  const segments = getTextSelectSegments(question);
  const selectableIds = new Set(segments.filter((segment) => segment.selectable !== false).map((segment) => segment.id));
  const selected = response.filter((id) => selectableIds.has(id));
  const policy = getTextSelectPolicy(question);
  if (policy.mode === "exact_count") return selected.length === (policy.count ?? 1);
  if (policy.mode === "range") {
    if (policy.min !== undefined && selected.length < policy.min) return false;
    if (policy.max !== undefined && selected.length > policy.max) return false;
    return selected.length > 0 || policy.min === 0;
  }
  return selected.length > 0;
}

function sanitizeTextSelectResponse(question: Extract<Question, { type: "text_select" }>, response: unknown): string[] {
  if (!Array.isArray(response)) return [];
  const selectableIds = new Set(getTextSelectSegments(question).filter((segment) => segment.selectable !== false).map((segment) => segment.id));
  const seen = new Set<string>();
  return response.filter((item): item is string => {
    if (typeof item !== "string" || !selectableIds.has(item) || seen.has(item)) return false;
    seen.add(item);
    return true;
  });
}

function toPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function toNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function ChoiceList({ question, quizChoiceBehavior, response, onChange }: { question: Extract<Question, { type: "multiple_choice" }>; quizChoiceBehavior?: QuizSpec["choiceBehavior"]; response: AnswerResponse | undefined; onChange: (response: AnswerResponse) => void }): ReactElement {
  const selected = typeof response === "number" ? response : null;
  const special = asSpecialResponse(response);
  const behavior = { ...(quizChoiceBehavior ?? {}), ...(question.choiceBehavior ?? {}) };
  const allowOther = behavior.allowOther ?? false;
  const choices = getChoiceTexts(question);
  if (!choices.length && !allowOther) {
    return <QuestionRenderWarning question={question} detail="This multiple-choice question did not include any valid choices." />;
  }
  return (
    <div className="choice-list">
      {choices.map((choice, index) => {
        const selectedChoice = selected === index;
        const label = String.fromCharCode(65 + index);
        return <button key={String(index)} type="button" className={selectedChoice ? "choice single-choice selected" : "choice single-choice"} onClick={() => onChange(index)}><span className="choice-letter" aria-hidden="true">{label}</span><span><RichInline text={choice} /></span></button>;
      })}
      {allowOther ? <label className={special?.kind === "other" ? "choice other-choice selected" : "choice other-choice"}><span className="choice-letter">+</span><input value={special?.kind === "other" ? special.text : ""} placeholder={behavior.otherLabel ?? "Other..."} onFocus={() => onChange({ kind: "other", text: special?.kind === "other" ? special.text : "" })} onChange={(event) => onChange({ kind: "other", text: event.currentTarget.value })} /></label> : null}
    </div>
  );
}

function MultiSelectList({ question, quizChoiceBehavior, response, onChange }: { question: Extract<Question, { type: "multi_select" }>; quizChoiceBehavior?: QuizSpec["choiceBehavior"]; response: AnswerResponse | undefined; onChange: (response: AnswerResponse) => void }): ReactElement {
  const selected = Array.isArray(response) ? response.filter((item): item is number => typeof item === "number") : [];
  const special = asSpecialResponse(response);
  const behavior = { ...(quizChoiceBehavior ?? {}), ...(question.choiceBehavior ?? {}) };
  const choices = getChoiceTexts(question);
  function toggle(index: number): void {
    onChange(selected.includes(index) ? selected.filter((item) => item !== index) : [...selected, index].sort((a, b) => a - b));
  }
  if (!choices.length && !behavior.allowOther) {
    return <QuestionRenderWarning question={question} detail="This multi-select question did not include any valid choices." />;
  }
  return (
    <div className="choice-list">
      {choices.map((choice, index) => {
        const selectedChoice = selected.includes(index);
        const label = String.fromCharCode(65 + index);
        return <button key={String(index)} type="button" className={selectedChoice ? "choice multi-choice selected" : "choice multi-choice"} onClick={() => toggle(index)}><span className="choice-letter" aria-hidden="true">{selectedChoice ? "✓" : ""}</span><span><RichInline text={choice} /></span></button>;
      })}
      {behavior.allowOther ? <label className={special?.kind === "other" ? "choice multi-choice other-choice selected" : "choice multi-choice other-choice"}><span className="choice-letter">+</span><input value={special?.kind === "other" ? special.text : ""} placeholder={behavior.otherLabel ?? "Other..."} onFocus={() => onChange({ kind: "other", text: special?.kind === "other" ? special.text : "" })} onChange={(event) => onChange({ kind: "other", text: event.currentTarget.value })} /></label> : null}
    </div>
  );
}


function TrueFalseList({ selected, onSelect }: { selected: boolean | null; onSelect: (value: boolean) => void }): ReactElement {
  return (
    <div className="choice-list">
      <button type="button" className={selected === true ? "choice selected" : "choice"} onClick={() => onSelect(true)}><span className="choice-letter">T</span><span>True</span></button>
      <button type="button" className={selected === false ? "choice selected" : "choice"} onClick={() => onSelect(false)}><span className="choice-letter">F</span><span>False</span></button>
    </div>
  );
}

type TextFormat = "bold" | "italic" | "underline" | "subscript" | "superscript" | "plain";

type TextControlElement = HTMLInputElement | HTMLTextAreaElement;

function TextField({ label, value, onChange, placeholder, inputMode, responseLimit, formatting = false }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; inputMode?: "decimal" | "text"; responseLimit?: ResponseLimit | null; formatting?: boolean }): ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const maxChars = getMaxChars(responseLimit);
  const limitedValue = clampTextToLimit(value, maxChars);
  function apply(format: TextFormat): void {
    applyInlineFormat(inputRef.current, limitedValue, maxChars, onChange, format);
  }
  return (
    <label className="field-label">
      <span>{label}</span>
      <input ref={inputRef} autoComplete="off" inputMode={inputMode} value={limitedValue} maxLength={maxChars ?? undefined} placeholder={placeholder} onChange={(event) => onChange(clampTextToLimit(event.currentTarget.value, maxChars))} />
      {formatting ? <TextFormatToolbar onFormat={apply} /> : null}
      {shouldShowCharCounter(responseLimit, maxChars) ? <span className="char-counter">{limitedValue.length} / {maxChars}</span> : null}
    </label>
  );
}

function TextArea({ label, value, onChange, rows = 4, responseLimit, formatting = false, placeholder = "Write your answer..." }: { label: string; value: string; onChange: (value: string) => void; rows?: number; responseLimit?: ResponseLimit | null; formatting?: boolean; placeholder?: string }): ReactElement {
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const maxChars = getMaxChars(responseLimit);
  const limitedValue = clampTextToLimit(value, maxChars);

  useLayoutEffect(() => {
    const element = textAreaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = Math.max(element.scrollHeight, rows * 24 + 28) + "px";
  }, [limitedValue, rows]);

  function apply(format: TextFormat): void {
    applyInlineFormat(textAreaRef.current, limitedValue, maxChars, onChange, format);
  }

  return (
    <label className="field-label">
      <span>{label}</span>
      <textarea ref={textAreaRef} className="text-area no-horizontal-resize auto-text-area" rows={rows} value={limitedValue} maxLength={maxChars ?? undefined} placeholder={placeholder} onChange={(event) => onChange(clampTextToLimit(event.currentTarget.value, maxChars))} />
      {formatting ? <TextFormatToolbar onFormat={apply} /> : null}
      {shouldShowCharCounter(responseLimit, maxChars) ? <span className="char-counter">{limitedValue.length} / {maxChars}</span> : null}
    </label>
  );
}

function TextFormatToolbar({ onFormat }: { onFormat: (format: TextFormat) => void }): ReactElement {
  const buttons: { format: TextFormat; label: string; title: string; className?: string }[] = [
    { format: "bold", label: "B", title: "Toggle bold on selected text or the current word" },
    { format: "italic", label: "I", title: "Toggle italic on selected text or the current word" },
    { format: "underline", label: "U", title: "Toggle underline on selected text or the current word" },
    { format: "subscript", label: "x₂", title: "Toggle subscript on selected text or the current word" },
    { format: "superscript", label: "x²", title: "Toggle superscript on selected text or the current word" },
    { format: "plain", label: "Tx", title: "Clear formatting from selected text or the current word", className: "format-plain" },
  ];
  return (
    <div className="format-toolbar" aria-label="Text formatting">
      <span className="format-toolbar-label">Format</span>
      {buttons.map((button, index) => (
        <TextFormatButton key={button.format} button={button} showDivider={index === buttons.length - 1} onFormat={onFormat} />
      ))}
    </div>
  );
}

function TextFormatButton({ button, showDivider, onFormat }: { button: { format: TextFormat; label: string; title: string; className?: string }; showDivider: boolean; onFormat: (format: TextFormat) => void }): ReactElement {
  return (
    <>
      {showDivider ? <span className="format-divider" aria-hidden="true" /> : null}
      <button className={button.className} type="button" title={button.title} aria-label={button.title} onMouseDown={(event) => event.preventDefault()} onClick={() => onFormat(button.format)}>
        {button.label}
      </button>
    </>
  );
}

function applyInlineFormat(element: TextControlElement | null, value: string, maxChars: number | null, onChange: (value: string) => void, format: TextFormat): void {
  const rawStart = element?.selectionStart ?? value.length;
  const rawEnd = element?.selectionEnd ?? value.length;
  const selection = rawStart === rawEnd ? expandSelectionToEditableToken(value, rawStart) : normalizeSelectionRange(rawStart, rawEnd, value.length);
  const selected = value.slice(selection.start, selection.end);

  if (!hasFormattableText(selected)) {
    window.setTimeout(() => element?.focus(), 0);
    return;
  }

  const formatted = formatPlainText(selected, format);
  if (formatted === selected) {
    window.setTimeout(() => {
      if (!element) return;
      element.focus();
      element.setSelectionRange(selection.start, selection.end);
    }, 0);
    return;
  }

  const next = clampTextToLimit(value.slice(0, selection.start) + formatted + value.slice(selection.end), maxChars);
  onChange(next);
  window.setTimeout(() => {
    if (!element) return;
    element.focus();
    const selectionEnd = Math.min(selection.start + formatted.length, next.length);
    element.setSelectionRange(Math.min(selection.start, next.length), selectionEnd);
  }, 0);
}

function normalizeSelectionRange(start: number, end: number, length: number): { start: number; end: number } {
  const boundedStart = Math.max(0, Math.min(start, length));
  const boundedEnd = Math.max(0, Math.min(end, length));
  return boundedStart <= boundedEnd ? { start: boundedStart, end: boundedEnd } : { start: boundedEnd, end: boundedStart };
}

function expandSelectionToEditableToken(value: string, index: number): { start: number; end: number } {
  const bounded = Math.max(0, Math.min(index, value.length));
  if (!value.length) return { start: bounded, end: bounded };

  const before = bounded > 0 ? value[bounded - 1] : "";
  const after = bounded < value.length ? value[bounded] : "";
  const shouldUsePrevious = before ? /S/.test(before) && (!after || /s/.test(after)) : false;
  const anchor = shouldUsePrevious ? bounded - 1 : bounded;
  if (anchor < 0 || anchor >= value.length || /s/.test(value[anchor])) return { start: bounded, end: bounded };

  let start = anchor;
  let end = anchor + 1;
  while (start > 0 && /S/.test(value[start - 1])) start -= 1;
  while (end < value.length && /S/.test(value[end])) end += 1;
  return { start, end };
}

function hasFormattableText(value: string): boolean {
  return stripTextFormatting(value).trim().length > 0;
}

function formatPlainText(value: string, format: TextFormat): string {
  const plain = stripTextFormatting(value);
  if (format === "plain") return plain;
  if (isFormatEquivalent(value, plain, format)) return plain;
  return renderPlainTextFormat(plain, format);
}

function isFormatEquivalent(value: string, plain: string, format: Exclude<TextFormat, "plain">): boolean {
  return renderPlainTextFormat(plain, format) === value;
}

function renderPlainTextFormat(value: string, format: Exclude<TextFormat, "plain">): string {
  switch (format) {
    case "bold":
      return value.replace(/[A-Za-z0-9]/g, (char) => toMathAlphanumeric(char, "bold"));
    case "italic":
      return value.replace(/[A-Za-z]/g, (char) => toMathAlphanumeric(char, "italic"));
    case "underline":
      return value.replace(/[^s]/g, (char) => char + "̲");
    case "subscript":
      return value.replace(/[A-Za-z0-9+-=()]/g, (char) => SUBSCRIPT_MAP[char] ?? char);
    case "superscript":
      return value.replace(/[A-Za-z0-9+-=()]/g, (char) => SUPERSCRIPT_MAP[char] ?? char);
  }
}

function stripTextFormatting(value: string): string {
  return Array.from(value.replace(/̲/g, "")).map((char) => PLAIN_TEXT_FORMAT_MAP[char] ?? char).join("");
}

function toMathAlphanumeric(char: string, style: "bold" | "italic"): string {
  const code = char.codePointAt(0) ?? 0;
  if (style === "bold") {
    if (code >= 65 && code <= 90) return String.fromCodePoint(0x1d400 + code - 65);
    if (code >= 97 && code <= 122) return String.fromCodePoint(0x1d41a + code - 97);
    if (code >= 48 && code <= 57) return String.fromCodePoint(0x1d7ce + code - 48);
    return char;
  }
  if (code >= 65 && code <= 90) return String.fromCodePoint(0x1d434 + code - 65);
  if (char === "h") return "ℎ";
  if (code >= 97 && code <= 122) return String.fromCodePoint(0x1d44e + code - 97);
  return char;
}

const SUBSCRIPT_MAP: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
  a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", o: "ₒ", p: "ₚ", r: "ᵣ", s: "ₛ", t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ",
  A: "ₐ", E: "ₑ", H: "ₕ", I: "ᵢ", J: "ⱼ", K: "ₖ", L: "ₗ", M: "ₘ", N: "ₙ", O: "ₒ", P: "ₚ", R: "ᵣ", S: "ₛ", T: "ₜ", U: "ᵤ", V: "ᵥ", X: "ₓ",
};

const SUPERSCRIPT_MAP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾",
  a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", f: "ᶠ", g: "ᵍ", h: "ʰ", i: "ⁱ", j: "ʲ", k: "ᵏ", l: "ˡ", m: "ᵐ", n: "ⁿ", o: "ᵒ", p: "ᵖ", r: "ʳ", s: "ˢ", t: "ᵗ", u: "ᵘ", v: "ᵛ", w: "ʷ", x: "ˣ", y: "ʸ", z: "ᶻ",
  A: "ᴬ", B: "ᴮ", D: "ᴰ", E: "ᴱ", G: "ᴳ", H: "ᴴ", I: "ᴵ", J: "ᴶ", K: "ᴷ", L: "ᴸ", M: "ᴹ", N: "ᴺ", O: "ᴼ", P: "ᴾ", R: "ᴿ", T: "ᵀ", U: "ᵁ", V: "ⱽ", W: "ᵂ",
};
const PLAIN_TEXT_FORMAT_MAP: Record<string, string> = {
  ...buildTextFormatReverseMap(SUBSCRIPT_MAP),
  ...buildTextFormatReverseMap(SUPERSCRIPT_MAP),
  ...buildMathAlphanumericReverseMap("bold"),
  ...buildMathAlphanumericReverseMap("italic"),
};

function buildTextFormatReverseMap(map: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [plain, formatted] of Object.entries(map)) {
    if (!(formatted in result)) result[formatted] = plain;
  }
  return result;
}

function buildMathAlphanumericReverseMap(style: "bold" | "italic"): Record<string, string> {
  const result: Record<string, string> = {};
  const chars = style === "bold" ? "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789" : "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  for (const plain of chars) {
    const formatted = toMathAlphanumeric(plain, style);
    if (formatted !== plain) result[formatted] = plain;
  }
  return result;
}



function MultiTypingInput({ question, response, onChange }: { question: Extract<Question, { type: "multi_typing" }>; response: Record<string, string>; onChange: (value: Record<string, string>) => void }): ReactElement {
  const fields = getMultiTypingFields(question);
  if (fields.length < 2) return <QuestionRenderWarning question={question} detail="This multi-typing question needs at least two fields." />;

  function updateField(fieldId: string, value: string): void {
    onChange({ ...response, [fieldId]: value });
  }

  return (
    <div className="multi-typing-grid">
      {fields.map((field) => (
        <TextField
          key={field.id}
          label={field.label}
          value={typeof response[field.id] === "string" ? response[field.id] : ""}
          placeholder={field.placeholder ?? `Type ${field.label.toLowerCase()}...`}
          responseLimit={field.responseLimit ?? getResponseLimit(question)}
          onChange={(value) => updateField(field.id, value)}
        />
      ))}
    </div>
  );
}

function MultiWriteVerticalInput({ question, response, onChange }: { question: Extract<Question, { type: "multi_write_vertical" }>; response: Record<string, string>; onChange: (value: Record<string, string>) => void }): ReactElement {
  const fields = getMultiTypingFields(question);
  if (fields.length < 1) return <QuestionRenderWarning question={question} detail="This multi-write vertical question needs at least one field." />;

  function updateField(fieldId: string, value: string): void {
    onChange({ ...response, [fieldId]: value });
  }

  return (
    <div className="multi-write-vertical">
      {fields.map((field) => (
        <TextArea
          key={field.id}
          label={field.label}
          value={typeof response[field.id] === "string" ? response[field.id] : ""}
          placeholder={field.placeholder ?? "Write " + field.label.toLowerCase() + "..."}
          responseLimit={field.responseLimit ?? getResponseLimit(question)}
          rows={3}
          onChange={(value) => updateField(field.id, value)}
        />
      ))}
    </div>
  );
}

function TextSelectInput({ question, response, onChange }: { question: Extract<Question, { type: "text_select" }>; response: string[]; onChange: (value: string[]) => void }): ReactElement {
  const segments = getTextSelectSegments(question);
  const selectableIds = new Set(segments.filter((segment) => segment.selectable !== false).map((segment) => segment.id));
  const selected = response.filter((id) => selectableIds.has(id));
  const policy = getTextSelectPolicy(question);
  const maxSelections = getTextSelectMaxSelections(policy);
  const maxReached = maxSelections !== null && selected.length >= maxSelections;

  if (!segments.length) return <QuestionRenderWarning question={question} detail="This text-select question needs at least one text segment." />;

  function toggleSegment(id: string): void {
    if (!selectableIds.has(id)) return;
    if (selected.includes(id)) {
      onChange(selected.filter((item) => item !== id));
      return;
    }
    if (maxReached) return;
    onChange([...selected, id]);
  }

  function renderSegment(segment: TextSelectSegmentRender, labelText?: string): ReactNode {
    const selectable = segment.selectable !== false;
    const isSelected = selected.includes(segment.id);
    const label = labelText ?? segment.text;
    if (!selectable) return <span key={segment.id} className="text-segment static-segment"><RichInline text={label} /></span>;
    return (
      <button
        key={segment.id}
        type="button"
        className={isSelected ? "text-segment selectable-segment selected" : "text-segment selectable-segment"}
        disabled={!isSelected && maxReached}
        onClick={() => toggleSegment(segment.id)}
      >
        <RichInline text={label} />
      </button>
    );
  }

  const inline = buildTextSelectInlineParts(typeof question.text === "string" ? question.text : "", segments, renderSegment);
  const fallbackSegments = segments.filter((segment) => !inline.renderedSegmentIds.has(segment.id));

  return (
    <div className="text-select-shell">
      <p className="text-select-instruction">{getTextSelectInstruction(policy)}</p>
      <div className="text-select-content inline-text-select">
        {inline.nodes.length ? inline.nodes : fallbackSegments.map((segment) => renderSegment(segment))}
      </div>
      {Boolean(inline.nodes.length && fallbackSegments.length) ? <div className="text-select-fallback" aria-label="Additional selectable segments">{fallbackSegments.map((segment) => renderSegment(segment))}</div> : null}
      <p className="text-select-count">Selected {selected.length}{maxSelections !== null ? " / " + maxSelections : ""}</p>
    </div>
  );
}

type TextSelectRenderSegment = (segment: TextSelectSegmentRender, labelText?: string) => ReactNode;

function buildTextSelectInlineParts(text: string, segments: TextSelectSegmentRender[], renderSegment: TextSelectRenderSegment): { nodes: ReactNode[]; renderedSegmentIds: Set<string> } {
  const renderedSegmentIds = new Set<string>();
  if (!text.trim()) return { nodes: [], renderedSegmentIds };

  const lowerText = text.toLowerCase();
  const rawMatches = segments
    .map((segment, order) => {
      const exactIndex = text.indexOf(segment.text);
      const fallbackIndex = exactIndex >= 0 ? exactIndex : lowerText.indexOf(segment.text.toLowerCase());
      return fallbackIndex >= 0 ? { segment, index: fallbackIndex, length: segment.text.length, order } : null;
    })
    .filter((match): match is { segment: TextSelectSegmentRender; index: number; length: number; order: number } => Boolean(match))
    .sort((a, b) => a.index - b.index || b.length - a.length || a.order - b.order);

  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const match of rawMatches) {
    if (renderedSegmentIds.has(match.segment.id) || match.index < cursor) continue;
    if (match.index > cursor) nodes.push(<RichInline key={`text-${cursor}`} text={text.slice(cursor, match.index)} />);
    const label = text.slice(match.index, match.index + match.length);
    nodes.push(renderSegment(match.segment, label));
    renderedSegmentIds.add(match.segment.id);
    cursor = match.index + match.length;
  }
  if (cursor < text.length) nodes.push(<RichInline key={`text-${cursor}`} text={text.slice(cursor)} />);
  return { nodes, renderedSegmentIds };
}

function getResponseLimit(question: Question): ResponseLimit | null {
  const raw = (question as { responseLimit?: unknown }).responseLimit;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const maxChars = record.maxChars === null ? null : typeof record.maxChars === "number" && Number.isFinite(record.maxChars) ? Math.max(0, Math.floor(record.maxChars)) : undefined;
  const minChars = typeof record.minChars === "number" && Number.isFinite(record.minChars) ? Math.max(0, Math.floor(record.minChars)) : undefined;
  const showCounter = typeof record.showCounter === "boolean" ? record.showCounter : undefined;
  return { maxChars, minChars, showCounter };
}

function getMaxChars(limit?: ResponseLimit | null): number | null {
  if (!limit) return null;
  if (limit.maxChars === null || limit.maxChars === undefined) return null;
  return Number.isFinite(limit.maxChars) && limit.maxChars > 0 ? Math.floor(limit.maxChars) : null;
}

function clampTextToLimit(value: string, maxChars: number | null): string {
  return maxChars === null ? value : value.slice(0, maxChars);
}

function shouldShowCharCounter(limit: ResponseLimit | null | undefined, maxChars: number | null): boolean {
  return maxChars !== null && limit?.showCounter !== false;
}

function parseNumericResponse(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const fraction = trimmed.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*\/\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))$/);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) return numerator / denominator;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

const bqV61OrderingRebuild = true;
type OrderingInputMode = "desktop" | "mobile";
type OrderingDragMode = OrderingInputMode;
type OrderingDragState = {
  id: string;
  mode: OrderingDragMode;
  pointerId?: number;
  touchIdentifier?: number;
  startX: number;
  startY: number;
  grabOffsetX: number;
  grabOffsetY: number;
  currentX: number;
  currentY: number;
  lastY: number;
  moved: boolean;
  cleanup?: () => void;
};
const ORDERING_ITEM_TEXT_MAX_CHARS = 64;

function useOrderingInputMode(): OrderingInputMode {
  const [mode, setMode] = useState<OrderingInputMode>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "desktop";
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches ? "desktop" : "mobile";
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setMode(query.matches ? "desktop" : "mobile");
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  return mode;
}

function setOrderingDragScrollLock(enabled: boolean): void {
  if (typeof document === "undefined") return;

  document.documentElement.classList.toggle("bq-ordering-drag-lock", enabled);
  document.body?.classList.toggle("bq-ordering-drag-lock", enabled);
}

function OrderingInput({ question, response, onChange }: { question: Extract<Question, { type: "ordering" }>; response: string[]; onChange: (value: string[]) => void }): ReactElement {
  const inputMode = useOrderingInputMode();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [dropMarker, setDropMarker] = useState<{ id: string; edge: "before" | "after" } | null>(null);
  const [dragVisualOffset, setDragVisualOffset] = useState<{ x: number; y: number } | null>(null);
  const dragVisualOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef<OrderingDragState | null>(null);
  const mobileDocumentCleanupRef = useRef<(() => void) | null>(null);
  const orderRef = useRef<string[]>([]);
  const pendingRowRectsRef = useRef<Map<string, DOMRect> | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const items = getOrderingItems(question);
  const itemIds = items.map((item) => item.id);
  const itemIdsKey = itemIds.join("|");
  const behavior = getOrderingBehavior(question);
  const order = normalizeOrderingResponse(response, items);
  const itemsKey = items.map((item) => `${item.id}\u0000${item.text}`).join("\u0001");
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [itemsKey]);

  useEffect(() => {
    orderRef.current = order;
  }, [order.join("|")]);

  useLayoutEffect(() => {
    const previousRects = pendingRowRectsRef.current;
    pendingRowRectsRef.current = null;
    if (!previousRects || typeof Element === "undefined" || typeof HTMLElement === "undefined") return;
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-order-id]") ?? []);
    for (const row of rows) {
      if (row.classList.contains("dragging")) continue;
      const previous = previousRects.get(row.dataset.orderId ?? "");
      if (!previous) continue;
      const next = row.getBoundingClientRect();
      const deltaY = previous.top - next.top;
      if (Math.abs(deltaY) < 1) continue;
      row.animate(
        [
          { transform: `translateY(${deltaY}px)` },
          { transform: "translateY(0)" },
        ],
        { duration: 430, easing: "cubic-bezier(.16, 1, .3, 1)" }
      );
    }
  }, [order.join("|")]);

  useLayoutEffect(() => {
    updateDraggedVisualOffset();
  }, [order.join("|"), draggedId]);

  useEffect(() => {
    if (!response.length && itemIds.length) onChange(bqV26AvoidAlreadyCorrectOrdering(question, items, getInitialOrderingOrder(question, items)));
  }, [response.length, itemIdsKey, question]);

  useEffect(() => () => {
    mobileDocumentCleanupRef.current?.();
    mobileDocumentCleanupRef.current = null;
    dragRef.current = null;
    setOrderingDragScrollLock(false);
  }, []);

  if (!items.length) return <QuestionRenderWarning question={question} detail="This ordering question did not include any valid items." />;

  const oversizedItem = items.find((item) => !isRenderableOrderingDragText(item.text));
  if (oversizedItem) {
    return <QuestionRenderWarning question={question} detail={`Ordering item "${limitForDisplay(oversizedItem.text, 42)}" is too long for the drag sorter. Ask ChatGPT to regenerate this question with one-line item labels under ${ORDERING_ITEM_TEXT_MAX_CHARS} characters.`} />;
  }

  function commit(nextOrder: string[]): void {
    const normalized = normalizeOrderingResponse(nextOrder, items);
    if (normalized.join("|") === orderRef.current.join("|")) return;
    pendingRowRectsRef.current = captureOrderingRowRects();
    orderRef.current = normalized;
    onChange(normalized);
  }

  function captureOrderingRowRects(): Map<string, DOMRect> {
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-order-id]") ?? []);
    return new Map(rows.map((row) => [row.dataset.orderId ?? "", row.getBoundingClientRect()]));
  }

  function getOrderingRow(id: string): HTMLElement | null {
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-order-id]") ?? []);
    return rows.find((row) => row.dataset.orderId === id) ?? null;
  }

  function updateDraggedVisualOffset(): void {
    const active = dragRef.current;
    if (!active) {
      setOrderingDragVisualOffset(null);
      return;
    }

    const row = getOrderingRow(active.id);
    if (!row) return;

    const rect = row.getBoundingClientRect();
    const previousOffset = dragVisualOffsetRef.current;
    const baseLeft = rect.left - (previousOffset?.x ?? 0);
    const baseTop = rect.top - (previousOffset?.y ?? 0);
    setOrderingDragVisualOffset({
      x: active.currentX - active.grabOffsetX - baseLeft,
      y: active.currentY - active.grabOffsetY - baseTop,
    });
  }

  function setOrderingDragVisualOffset(offset: { x: number; y: number } | null): void {
    dragVisualOffsetRef.current = offset;
    setDragVisualOffset(offset);
  }

  function moveByStep(id: string, step: -1 | 1): void {
    const currentOrder = orderRef.current.length ? orderRef.current : order;
    const fromIndex = currentOrder.indexOf(id);
    if (fromIndex < 0) return;
    const toIndex = Math.max(0, Math.min(currentOrder.length - 1, fromIndex + step));
    if (toIndex === fromIndex) return;
    const next = [...currentOrder];
    next.splice(fromIndex, 1);
    next.splice(toIndex, 0, id);
    commit(next);
  }

  function markerFromInsertionIndex(sourceId: string, rawIndex: number): { id: string; edge: "before" | "after" } | null {
    const currentOrder = orderRef.current.length ? orderRef.current : order;
    const withoutSource = currentOrder.filter((id) => id !== sourceId);
    if (!withoutSource.length) return null;
    const targetIndex = Math.max(0, Math.min(withoutSource.length, rawIndex));
    if (targetIndex < withoutSource.length) return { id: withoutSource[targetIndex], edge: "before" };
    return { id: withoutSource[withoutSource.length - 1], edge: "after" };
  }

  function moveToIndex(sourceId: string, rawIndex: number): void {
    const currentOrder = orderRef.current.length ? orderRef.current : order;
    const fromIndex = currentOrder.indexOf(sourceId);
    if (fromIndex < 0) return;
    const withoutSource = currentOrder.filter((id) => id !== sourceId);
    const targetIndex = Math.max(0, Math.min(withoutSource.length, rawIndex));
    const next = [...withoutSource];
    next.splice(targetIndex, 0, sourceId);
    if (next.join("|") === currentOrder.join("|")) return;
    commit(next);
  }

  function insertionIndexFromPoint(_clientX: number, clientY: number, sourceId: string): number {
    const list = listRef.current;
    const currentOrder = orderRef.current.length ? orderRef.current : order;
    if (!list) return currentOrder.indexOf(sourceId);

    const rows = Array.from(list.querySelectorAll<HTMLElement>("[data-order-id]")).filter((row) => row.dataset.orderId !== sourceId);
    const listRect = list.getBoundingClientRect();

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const centerY = listRect.top + row.offsetTop - list.scrollTop + row.offsetHeight / 2;
      if (clientY < centerY) return index;
    }
    return rows.length;
  }

  function clearMobileDocumentDragListeners(): void {
    mobileDocumentCleanupRef.current?.();
    mobileDocumentCleanupRef.current = null;
    if (dragRef.current) dragRef.current.cleanup = undefined;
  }

  function installMobileDocumentDragListeners(): () => void {
    if (typeof document === "undefined") return () => undefined;
    clearMobileDocumentDragListeners();

    const touchMoveOptions = { capture: true, passive: false } as const;
    const touchEndOptions = { capture: true } as const;
    const pointerOptions = { capture: true } as const;
    const findActiveTouch = (touches: globalThis.TouchList, touchIdentifier: number): globalThis.Touch | undefined =>
      Array.from(touches).find((candidate) => candidate.identifier === touchIdentifier);

    const onDocumentPointerMove = (event: globalThis.PointerEvent): void => {
      const active = dragRef.current;
      if (!active || active.mode !== "mobile" || active.touchIdentifier !== undefined || active.pointerId !== event.pointerId) return;
      moveActiveDrag(event.clientX, event.clientY, event);
    };

    const onDocumentPointerEnd = (event: globalThis.PointerEvent): void => {
      const active = dragRef.current;
      if (!active || active.mode !== "mobile" || active.touchIdentifier !== undefined || active.pointerId !== event.pointerId) return;
      event.preventDefault();
      finishDrag();
    };

    const onDocumentTouchMove = (event: globalThis.TouchEvent): void => {
      const active = dragRef.current;
      if (!active || active.mode !== "mobile" || active.touchIdentifier === undefined) return;

      const touch = findActiveTouch(event.touches, active.touchIdentifier);
      if (!touch) {
        finishDrag();
        return;
      }

      moveActiveDrag(touch.clientX, touch.clientY, event);
    };

    const onDocumentTouchEnd = (event: globalThis.TouchEvent): void => {
      const active = dragRef.current;
      if (!active || active.mode !== "mobile" || active.touchIdentifier === undefined) return;
      const ended = Array.from(event.changedTouches).some((touch) => touch.identifier === active.touchIdentifier);
      if (ended) finishDrag();
    };

    const onDocumentTouchCancel = (event: globalThis.TouchEvent): void => {
      const active = dragRef.current;
      if (!active || active.mode !== "mobile" || active.touchIdentifier === undefined) return;
      const cancelled = Array.from(event.changedTouches).some((touch) => touch.identifier === active.touchIdentifier);
      if (cancelled) finishDrag();
    };

    document.addEventListener("pointermove", onDocumentPointerMove, pointerOptions);
    document.addEventListener("pointerup", onDocumentPointerEnd, pointerOptions);
    document.addEventListener("pointercancel", onDocumentPointerEnd, pointerOptions);
    document.addEventListener("touchmove", onDocumentTouchMove, touchMoveOptions);
    document.addEventListener("touchend", onDocumentTouchEnd, touchEndOptions);
    document.addEventListener("touchcancel", onDocumentTouchCancel, touchEndOptions);

    const cleanup = () => {
      document.removeEventListener("pointermove", onDocumentPointerMove, pointerOptions);
      document.removeEventListener("pointerup", onDocumentPointerEnd, pointerOptions);
      document.removeEventListener("pointercancel", onDocumentPointerEnd, pointerOptions);
      document.removeEventListener("touchmove", onDocumentTouchMove, touchMoveOptions);
      document.removeEventListener("touchend", onDocumentTouchEnd, touchEndOptions);
      document.removeEventListener("touchcancel", onDocumentTouchCancel, touchEndOptions);
    };
    mobileDocumentCleanupRef.current = cleanup;
    return cleanup;
  }

  function startDrag(id: string, mode: OrderingDragMode, clientX: number, clientY: number, pointerId?: number, touchIdentifier?: number): void {
    if (dragRef.current) return;

    const rowRect = getOrderingRow(id)?.getBoundingClientRect();
    dragRef.current = {
      id,
      mode,
      pointerId,
      touchIdentifier,
      startX: clientX,
      startY: clientY,
      grabOffsetX: rowRect ? clientX - rowRect.left : 0,
      grabOffsetY: rowRect ? clientY - rowRect.top : 0,
      currentX: clientX,
      currentY: clientY,
      lastY: clientY,
      moved: false,
    };
    setDraggedId(id);
    setOrderingDragVisualOffset({ x: 0, y: 0 });
    setDropIndex(orderRef.current.indexOf(id));
    setDropMarker(null);
    setOrderingDragScrollLock(true);
    if (mode === "mobile") dragRef.current.cleanup = installMobileDocumentDragListeners();
  }

  function beginDrag(event: PointerEvent<HTMLElement>, id: string, mode: OrderingDragMode): void {
    if (event.button !== 0) return;
    if (!event.isPrimary) return;
    if (mode === "desktop" && event.pointerType !== "mouse") return;
    if (mode === "mobile") return;
    if ((event.target as Element).closest("button, input, textarea, select, a")) return;
    if (dragRef.current) return;

    startDrag(id, "desktop", event.clientX, event.clientY, event.pointerId);
    event.preventDefault();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* pointer capture is best-effort across embedded webviews */ }
  }

  function beginTouchDrag(event: ReactTouchEvent<HTMLElement>, id: string): void {
    if (inputMode !== "mobile") return;
    if (dragRef.current) return;
    if (event.touches.length !== 1) return;

    const touch = event.touches[0];
    startDrag(id, "mobile", touch.clientX, touch.clientY, undefined, touch.identifier);
    event.preventDefault();
  }

  function beginMobilePointerFallbackDrag(event: PointerEvent<HTMLElement>, id: string): void {
    if (inputMode !== "mobile") return;
    if (event.pointerType === "touch") return;
    if (event.button !== 0 || !event.isPrimary || dragRef.current) return;
    startDrag(id, "mobile", event.clientX, event.clientY, event.pointerId);
    event.preventDefault();
  }

  function moveActiveDrag(clientX: number, clientY: number, event?: { preventDefault: () => void }): void {
    const active = dragRef.current;
    if (!active) return;

    if (active.mode === "desktop") {
      const distance = Math.hypot(clientX - active.startX, clientY - active.startY);
      if (!active.moved && distance < 4) return;
    }

    active.moved = true;
    active.currentX = clientX;
    active.currentY = clientY;
    active.lastY = clientY;
    event?.preventDefault();
    const nextDropIndex = insertionIndexFromPoint(clientX, clientY, active.id);
    setDropIndex(nextDropIndex);
    setDropMarker(markerFromInsertionIndex(active.id, nextDropIndex));
    moveToIndex(active.id, nextDropIndex);
    updateDraggedVisualOffset();
  }

  function moveDrag(event: PointerEvent<HTMLElement>): void {
    const active = dragRef.current;
    if (!active || active.pointerId === undefined || active.pointerId !== event.pointerId) return;
    moveActiveDrag(event.clientX, event.clientY, event);
  }

  function finishDrag(): void {
    clearMobileDocumentDragListeners();
    dragRef.current = null;
    setDraggedId(null);
    setOrderingDragVisualOffset(null);
    setDropIndex(null);
    setDropMarker(null);
    setOrderingDragScrollLock(false);
  }

  function endDrag(event: PointerEvent<HTMLElement>): void {
    const active = dragRef.current;
    if (!active || active.pointerId === undefined || active.pointerId !== event.pointerId) return;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* no-op */ }
    finishDrag();
  }

  function cancelDrag(): void {
    finishDrag();
  }

  function onHandleKeyDown(event: ReactKeyboardEvent<HTMLElement>, id: string): void {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveByStep(id, -1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveByStep(id, 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveToIndex(id, 0);
    } else if (event.key === "End") {
      event.preventDefault();
      moveToIndex(id, order.length - 1);
    }
  }

  return (
    <div className="order-shell drag-order-shell bq-ordering-rebuilt" data-ordering-mode={inputMode} aria-label="Ordering answer">
      <div className="order-end-label top-label"><strong>Top</strong> = {behavior.topLabel}</div>
      <div ref={listRef} className="order-list drag-order-list" aria-live="polite">
        {order.map((id, index) => {
          const item = itemById.get(id);
          const isDragged = draggedId === id;
          const isDropBefore = dropMarker?.id === id && dropMarker.edge === "before";
          const isDropAfter = dropMarker?.id === id && dropMarker.edge === "after";
          const dragStyle = isDragged && dragVisualOffset
            ? ({ "--drag-x": `${dragVisualOffset.x}px`, "--drag-y": `${dragVisualOffset.y}px` } as CSSProperties)
            : undefined;
          return (
            <div
              className={(isDragged ? "order-item draggable-order-item dragging" : "order-item draggable-order-item") + (!isDragged && dropIndex === index ? " drag-over" : "") + (isDropBefore ? " drop-before" : "") + (isDropAfter ? " drop-after" : "")}
              key={id}
              style={dragStyle}
              data-order-id={id}
              draggable={false}
              aria-roledescription="sortable item"
              aria-label={`${index + 1}. ${item?.text ?? id}`}
              onPointerDown={inputMode === "desktop" ? (event) => beginDrag(event, id, "desktop") : undefined}
              onPointerMove={inputMode === "desktop" ? moveDrag : undefined}
              onPointerUp={inputMode === "desktop" ? endDrag : undefined}
              onPointerCancel={inputMode === "desktop" ? cancelDrag : undefined}
            >
              <span className="order-item-text"><span className="order-index">{index + 1}</span><RichInline text={item?.text ?? id} /></span>
              <span
                className="drag-handle"
                role="slider"
                tabIndex={0}
                aria-orientation="vertical"
                aria-valuemin={1}
                aria-valuemax={order.length}
                aria-valuenow={index + 1}
                aria-valuetext={`Position ${index + 1} of ${order.length}`}
                aria-label={`Reorder grip for ${item?.text ?? id}. Use ArrowUp, ArrowDown, Home, or End to move.`}
                title={inputMode === "desktop" ? "Drag row, or focus grip and press ArrowUp, ArrowDown, Home, or End" : "Drag from this handle, or focus grip and press ArrowUp, ArrowDown, Home, or End"}
                onPointerDown={inputMode === "mobile" ? (event) => beginMobilePointerFallbackDrag(event, id) : undefined}
                onTouchStart={inputMode === "mobile" ? (event) => beginTouchDrag(event, id) : undefined}
                onKeyDown={(event) => onHandleKeyDown(event, id)}
              >
                <span aria-hidden="true" className="drag-bar-grip" />
                <span className="drag-label">Drag</span>
              </span>
            </div>
          );
        })}
      </div>
      <div className="order-end-label bottom-label"><strong>Bottom</strong> = {behavior.bottomLabel}</div>
    </div>
  );
}

function MatchingInput({ question, response, onChange }: { question: Extract<Question, { type: "matching" }>; response: MatchingPair[]; onChange: (value: MatchingPair[]) => void }): ReactElement {
  const leftItems = getMatchingSide(question, "left");
  const rightItems = useMemo(() => getStableShuffledItems(getMatchingSide(question, "right"), question.id), [question]);
  function setPair(leftId: string, rightId: string): void {
    const without = response.filter((pair) => pair.leftId !== leftId);
    onChange(rightId ? [...without, { leftId, rightId }] : without);
  }
  if (!leftItems.length || !rightItems.length) {
    return <QuestionRenderWarning question={question} detail="This matching question needs valid left and right item lists." />;
  }
  return <div className="match-list">{leftItems.map((left) => <label key={left.id} className="match-row"><span><RichInline text={left.text} /></span><select value={response.find((pair) => pair.leftId === left.id)?.rightId ?? ""} onChange={(event) => setPair(left.id, event.currentTarget.value)}><option value="">Choose match...</option>{rightItems.map((right) => <option key={right.id} value={right.id}>{right.text}</option>)}</select></label>)}</div>;
}

function getStableShuffledItems<T extends { id: string }>(items: T[], seed: string): T[] {
  if (items.length < 2) return items;
  const shuffled = [...items];
  let state = hashString(seed + ":" + items.map((item) => item.id).join("|"));
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    state = nextShuffleState(state);
    const swapIndex = state % (index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  const unchanged = shuffled.every((item, index) => item.id === items[index]?.id);
  if (unchanged && shuffled.length > 1) shuffled.push(shuffled.shift() as T);
  return shuffled;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function nextShuffleState(value: number): number {
  return (Math.imul(value || 1, 1664525) + 1013904223) >>> 0;
}

function ConfidencePicker({ value, required, disabled, onChange }: { value: AnswerRecord["confidence"] | undefined; required: boolean; disabled?: boolean; onChange: (value: AnswerRecord["confidence"]) => void }): ReactElement {
  const levels = [1, 2, 3] as const;
  return (
    <div className="confidence-picker three-level" aria-label="Confidence rating" aria-disabled={disabled ? "true" : undefined}>
      {levels.map((item) => (
        <button key={item} type="button" disabled={disabled} className={value === item ? "selected" : ""} onClick={() => onChange(item)}>
          <strong>{item}</strong><span>{confidenceLabel(item)}</span>
        </button>
      ))}
      {required && !disabled && value === undefined ? <small className="required-note">Required</small> : null}
    </div>
  );
}

function SubmissionScreen({ finished, widgetMode, onNewQuiz }: { finished: FinishedSubmission; widgetMode: boolean; onNewQuiz: () => void }): ReactElement {
  const { submission, hostSubmitted } = finished;
  const gradeStatus = getFinishedGradeStatus(finished, widgetMode);
  const [recordedGrade, setRecordedGrade] = useState<GradePayload | null>(null);
  const [gradePollingDone, setGradePollingDone] = useState(false);

  useEffect(() => {
    if (!widgetMode) return;
    let cancelled = false;
    let attempts = 0;
    const poll = async () => {
      attempts += 1;
      const grade = await fetchGradeFromServer(submission.quizId, submission.sessionId, finished.recoveryToken).catch(() => null);
      if (cancelled) return;
      if (grade) {
        setRecordedGrade(grade);
        setGradePollingDone(true);
        return;
      }
      if (attempts >= 16) setGradePollingDone(true);
    };
    void poll();
    const interval = window.setInterval(() => {
      if (cancelled || attempts >= 16) {
        window.clearInterval(interval);
        return;
      }
      void poll();
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [widgetMode, submission.quizId, submission.sessionId, finished.recoveryToken]);

  return (
    <main className="shell narrow result-shell">
      <section className="card result-hero">
        <p className="eyebrow eyebrow-row">Quiz submitted <span className="version-chip">{WIDGET_VERSION_LABEL}</span></p>
        <h1>{getSubmissionHeadline(gradeStatus)}</h1>
        <p>{getSubmissionMessage(gradeStatus, hostSubmitted)}</p>

        <div className="submission-status-grid user-status-grid">
          <span>Answers saved</span>
          {submission.completion.requiredTotal > 0 ? <span>Required questions complete</span> : null}
          <span>{getGradeStatusLabel(gradeStatus)}</span>
        </div>

        {recordedGrade ? <GradeSummaryCard grade={recordedGrade} /> : widgetMode && !gradePollingDone ? <p className="muted compact-status">Waiting for feedback to appear...</p> : null}

        {finished.followUpAttempts && gradeStatus !== "grade_requested" ? (
          <p className="muted compact-status">{finished.followUpMessage ?? "Still trying to send your answers for feedback."}</p>
        ) : null}

        <div className="actions wrap">
          {!widgetMode ? <button type="button" onClick={onNewQuiz}>Start another quiz</button> : null}
        </div>
      </section>
    </main>
  );
}

function GradeSummaryCard({ grade }: { grade: GradePayload }): ReactElement {
  const percent = getGradePercent(grade);
  const hasNumeric = percent !== null;
  const scoreText = grade.score !== null && grade.score !== undefined && grade.maxScore !== null && grade.maxScore !== undefined
    ? String(grade.score) + "/" + String(grade.maxScore)
    : hasNumeric
      ? String(percent) + "%"
      : "";
  const ringStyle = hasNumeric ? { "--grade-percent": String(percent) } as React.CSSProperties : undefined;
  return (
    <section className={hasNumeric ? "grade-card grade-card-numeric" : "grade-card grade-card-qualitative"} aria-live="polite">
      <div className={hasNumeric ? "grade-ring" : "grade-ring qualitative"} style={ringStyle}>
        <span>{hasNumeric ? String(percent) + "%" : "✓"}</span>
      </div>
      <div>
        <p className="eyebrow">Grade ready</p>
        <h2>{grade.label || (hasNumeric ? "Graded" : "Feedback ready")}</h2>
        {scoreText ? <p className="grade-score-text">{scoreText}</p> : null}
        {grade.summary ? <p className="muted">{grade.summary}</p> : <p className="muted">ChatGPT recorded feedback for this submission.</p>}
      </div>
    </section>
  );
}

function getGradePercent(grade: GradePayload): number | null {
  if (typeof grade.percent === "number" && Number.isFinite(grade.percent)) return Math.max(0, Math.min(100, Math.round(grade.percent)));
  if (typeof grade.score === "number" && typeof grade.maxScore === "number" && Number.isFinite(grade.score) && Number.isFinite(grade.maxScore) && grade.maxScore > 0) {
    return Math.max(0, Math.min(100, Math.round((grade.score / grade.maxScore) * 100)));
  }
  return null;
}

function SubmissionReview({ submission }: { submission: SubmissionCapsule }): ReactElement {
  const answerMap = new Map(submission.answers.map((answer) => [answer.questionId, answer]));
  const keyMap = new Map((submission.answerKey ?? []).map((entry) => [entry.questionId, entry]));
  return (
    <section className="card stack review-panel">
      <p className="eyebrow">Review</p>
      <h2>Your submitted questions</h2>
      <p className="muted">Use this to review your work while or after ChatGPT grades in the chat.</p>
      <div className="review-list">
        {submission.questions.map((question, index) => {
          const answer = answerMap.get(question.id);
          const key = keyMap.get(question.id);
          return (
            <article className="review-item" key={question.id}>
              <div className="question-header"><span className="badge">Question {index + 1}</span><span className="badge subtle-badge">{formatQuestionType(question.type)}</span></div>
              <h3><RichInline text={question.prompt} /></h3>
              {question.multiTypingFields ? <p className="muted compact-status">Fields: {question.multiTypingFields.map((field) => field.label).join(", ")}</p> : null}
              <p><strong>Your answer:</strong> {formatAnswerForReview(answer?.response)}</p>
              {answer?.confidence ? <p className="muted compact-status">Confidence: {answer.confidence} ({confidenceLabel(answer.confidence)})</p> : null}
              {key ? <details><summary>Answer key / grading guide</summary><pre className="review-answer-key">{formatAnswerKeyForReview(key)}</pre></details> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function formatAnswerForReview(value: unknown): string {
  if (value === null || value === undefined || value === "") return "No response";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => typeof item === "object" ? JSON.stringify(item) : String(item)).join(" -> ");
  if (typeof value === "object") {
    const special = asSpecialResponse(value);
    if (special?.kind === "other") return `${special.text || "Other"}${special.selections?.length ? `; selected: ${special.selections.join(", ")}` : ""}`;
    if (special?.kind === "cancelled") return "Cancelled";
    return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${key}: ${String(item ?? "")}`).join("; ");
  }
  return String(value);
}

function formatAnswerKeyForReview(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function buildIssueReport(finished: FinishedSubmission, widgetMode: boolean): string {
  return JSON.stringify({
    kind: "betterquizzer.issue_report",
    widgetVersion: WIDGET_VERSION,
    buildId: BETTERQUIZZER_BUILD_ID,
    widgetMode,
    quizId: finished.submission.quizId,
    sessionId: finished.submission.sessionId,
    followUpStatus: finished.followUpStatus,
    followUpRequested: finished.followUpRequested,
    followUpAttempts: finished.followUpAttempts,
    hostSubmitted: finished.hostSubmitted,
    completion: finished.submission.completion,
    warnings: finished.submission.status?.warnings ?? [],
    message: finished.followUpMessage,
    createdAt: new Date().toISOString(),
  }, null, 2);
}

function getFinishedGradeStatus(finished: FinishedSubmission, widgetMode: boolean): SubmissionDeliveryStatus {
  if (finished.followUpStatus) return finished.followUpStatus;
  if (!widgetMode) return "submitted";
  return finished.submission.status?.followUpRequested ? "grade_requested" : "requesting_grade";
}

function getSubmissionHeadline(status: SubmissionDeliveryStatus): string {
  switch (status) {
    case "grade_requested":
      return "Submitted. Return to chat";
    case "requesting_grade":
    case "retrying_grade_request":
      return "Sending your answers...";
    case "grade_request_unavailable":
      return "Answers saved";
    case "grade_request_failed":
      return "Answers saved";
    default:
      return "Your answers were saved";
  }
}

function getSubmissionMessage(status: SubmissionDeliveryStatus, hostSubmitted: boolean): string {
  if (status === "grade_requested") return "Your answers are saved and ChatGPT has what it needs. Return to the chat for feedback.";
  if (status === "requesting_grade" || status === "retrying_grade_request") return "Your answers are saved. Feedback should appear in the chat shortly.";
  if (status === "grade_request_unavailable") return hostSubmitted
    ? "Your answers were submitted. Return to the chat if feedback does not appear automatically."
    : "Your answers are saved here. Return to the chat to continue.";
  if (status === "grade_request_failed") return "Your answers were saved, but the feedback request did not finish. Your work is not lost.";
  return "Your answers were saved.";
}

function getGradeStatusLabel(status: SubmissionDeliveryStatus): string {
  switch (status) {
    case "grade_requested":
      return "Feedback requested";
    case "requesting_grade":
      return "Sending to ChatGPT";
    case "retrying_grade_request":
      return "Still sending";
    case "grade_request_unavailable":
      return "Saved for review";
    case "grade_request_failed":
      return "Feedback request incomplete";
    default:
      return "Saved";
  }
}

function summarizeToolResult(result: ToolResultLike | null): ToolResultLike | null {
  if (!result) return null;
  const text = Array.isArray(result.content)
    ? result.content
        .map((item) => {
          if (item && typeof item === "object" && "text" in item) return String((item as { text?: unknown }).text ?? "");
          return "";
        })
        .filter(Boolean)
        .join("\n")
    : undefined;
  return {
    content: text ? [{ type: "text", text }] : undefined,
    structuredContent: result.structuredContent ? { ok: true } : undefined,
  };
}

type GradeRetryOptions = {
  submission: SubmissionCapsule;
  session: ReturnType<typeof createSession>;
  hostSubmitted: boolean;
  currentIndex: number;
  drafts: Record<string, DraftAnswer>;
  hostResult: ToolResultLike | null;
  launchId?: string;
  recoveryToken?: string;
  onUpdate: (finished: FinishedSubmission) => void;
};

async function requestChatGptGradeOnce(options: GradeRetryOptions): Promise<void> {
  setFollowUpDelivery(options, "requesting_grade", false, 0, "Asking ChatGPT to grade…");

  const result = await sendSubmissionFollowUp(buildAutoGradePrompt(options.submission), 8000);
  if (result.status === "sent") {
    setFollowUpDelivery(options, "grade_requested", true, 1, "Grade request sent.");
    return;
  }

  if (result.status === "unavailable") {
    setFollowUpDelivery(options, "grade_request_unavailable", false, 1, result.message);
    return;
  }

  setFollowUpDelivery(options, "grade_request_failed", false, 1, result.message ?? "ChatGPT grading request did not complete.");
}

function setFollowUpDelivery(options: GradeRetryOptions, status: SubmissionDeliveryStatus, followUpRequested: boolean, attempts: number, message?: string): void {
  options.submission.status = {
    ...(options.submission.status ?? { localSaved: true, hostSubmitted: options.hostSubmitted, followUpRequested: false, duplicateSubmission: false, warnings: [] }),
    localSaved: true,
    hostSubmitted: options.hostSubmitted,
    followUpRequested,
    warnings: uniqueWarnings([
      ...(options.submission.status?.warnings ?? []),
      ...(message && status !== "grade_requested" && status !== "requesting_grade" && status !== "retrying_grade_request" ? [message] : []),
    ]),
  };

  persistSubmissionState({
    status: status === "grade_requested" ? "grade_requested" : status === "grade_request_unavailable" || status === "grade_request_failed" ? "fallback_ready" : "requesting_grade",
    quizId: options.submission.quizId,
    launchId: options.launchId,
    recoveryToken: options.recoveryToken,
    currentIndex: options.currentIndex,
    drafts: options.drafts,
    session: options.session,
    submission: options.submission,
    hostResult: summarizeToolResult(options.hostResult),
    error: status === "grade_request_failed" || status === "grade_request_unavailable" ? message : undefined,
  });

  options.onUpdate({
    submission: options.submission,
    session: options.session,
    hostSubmitted: options.hostSubmitted,
    recoveryToken: options.recoveryToken,
    followUpRequested,
    followUpStatus: status,
    followUpAttempts: attempts,
    followUpMessage: message,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function uniqueWarnings(warnings: string[]): string[] {
  return [...new Set(warnings.filter(Boolean))];
}

function clampIndex(index: number, questionCount: number): number {
  return Math.max(0, Math.min(Math.max(0, questionCount - 1), index));
}

function sanitizeRestoredDrafts(value: unknown, quiz: QuizSpec): Record<string, DraftAnswer> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return keepDraftsForQuiz(value as Record<string, DraftAnswer>, quiz);
}

function keepDraftsForQuiz(drafts: Record<string, DraftAnswer>, quiz: QuizSpec): Record<string, DraftAnswer> {
  const questionById = new Map(quiz.questions.map((question) => [question.id, question]));
  const kept: Record<string, DraftAnswer> = {};
  for (const [questionId, draft] of Object.entries(drafts)) {
    const question = questionById.get(questionId);
    if (!question || !isDraftAnswerLike(draft)) continue;
    const sanitized = sanitizeDraftForQuestion(question, draft);
    // Keep saved confidence even if a restored draft is temporarily incomplete;
    // the picker stays locked until the answer is complete again.
    kept[questionId] = sanitized;
  }
  return kept;
}

function isDraftAnswerLike(value: unknown): value is DraftAnswer {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && typeof (value as { firstSeenAt?: unknown }).firstSeenAt === "number";
}

function sanitizeDraftForQuestion(question: Question, draft: DraftAnswer): DraftAnswer {
  const base: DraftAnswer = {
    response: null,
    confidence: normalizeConfidence(draft.confidence),
    firstSeenAt: Number.isFinite(draft.firstSeenAt) ? draft.firstSeenAt : Date.now(),
    lastUpdatedAt: typeof draft.lastUpdatedAt === "number" && Number.isFinite(draft.lastUpdatedAt) ? draft.lastUpdatedAt : undefined,
  };
  const response = draft.response;
  switch (question.type) {
    case "multiple_choice":
      return { ...base, response: typeof response === "number" ? response : asSpecialResponse(response) ?? null };
    case "multi_select":
      return { ...base, response: Array.isArray(response) ? response.filter((item): item is number => typeof item === "number") : asSpecialResponse(response) ?? null };
    case "true_false":
      return { ...base, response: typeof response === "boolean" ? response : null };
    case "fill_blank":
    case "short_answer":
    case "long_response":
      return { ...base, response: typeof response === "string" ? clampTextToLimit(response, getMaxChars(getResponseLimit(question))) : null };
    case "multi_typing":
    case "multi_write_vertical":
      return { ...base, response: sanitizeMultiTypingResponse(question, response) };
    case "text_select":
      return { ...base, response: sanitizeTextSelectResponse(question, response) };
    case "numeric":
      return { ...base, response: typeof response === "number" && Number.isFinite(response) ? response : typeof response === "string" ? response : null };
    case "ordering": {
      const restored = Array.isArray(response) ? response.filter((item): item is string => typeof item === "string") : [];
      return { ...base, response: restored.length ? normalizeOrderingResponse(restored, getOrderingItems(question)) : null };
    }
    case "matching":
      return { ...base, response: sanitizeMatchingPairs(question, response) };
    default:
      return base;
  }
}

function sanitizeMultiTypingResponse(question: Question & MultiTypingLike, response: unknown): Record<string, string> {
  const fields = getMultiTypingFields(question);
  const record = isMultiTypingResponse(response) ? response : {};
  const next: Record<string, string> = {};
  for (const field of fields) {
    const maxChars = getMaxChars(field.responseLimit ?? getResponseLimit(question));
    next[field.id] = clampTextToLimit(record[field.id] ?? "", maxChars);
  }
  return next;
}

function sanitizeMatchingPairs(question: Extract<Question, { type: "matching" }>, response: unknown): MatchingPair[] {
  if (!isMatchingPairs(response)) return [];
  const leftIds = new Set(getMatchingSide(question, "left").map((item) => item.id));
  const rightIds = new Set(getMatchingSide(question, "right").map((item) => item.id));
  const seenLeft = new Set<string>();
  return response.filter((pair) => {
    if (!leftIds.has(pair.leftId) || !rightIds.has(pair.rightId) || seenLeft.has(pair.leftId)) return false;
    seenLeft.add(pair.leftId);
    return true;
  });
}

function buildAnswerMeta(question: Question): Record<string, unknown> | undefined {
  if (question.type === "ordering") {
    const behavior = getOrderingBehavior(question);
    return {
      responseDirection: behavior.direction,
      visualOrder: "top_to_bottom",
      topLabel: behavior.topLabel,
      bottomLabel: behavior.bottomLabel,
      interaction: "drag_and_drop",
    };
  }
  if (question.type === "text_select") {
    const segments = getTextSelectSegments(question);
    return {
      selectionPolicy: getTextSelectPolicy(question),
      selectableSegmentIds: segments.filter((segment) => segment.selectable !== false).map((segment) => segment.id),
    };
  }
  return undefined;
}

function getOrderingBehavior(question: Extract<Question, { type: "ordering" }>): { direction: "top_to_bottom"; topLabel: string; bottomLabel: string } {
  const raw = (question as { orderingBehavior?: unknown }).orderingBehavior;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    const topLabel = typeof record.topLabel === "string" && record.topLabel.trim() ? record.topLabel.trim() : undefined;
    const bottomLabel = typeof record.bottomLabel === "string" && record.bottomLabel.trim() ? record.bottomLabel.trim() : undefined;
    if (topLabel && bottomLabel) return { direction: "top_to_bottom", topLabel, bottomLabel };
  }
  return inferOrderingBehavior(question.prompt);
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


function makeAnswerRecords(quiz: QuizSpec, drafts: Record<string, DraftAnswer>, startedAt?: string): AnswerRecord[] {
  return quiz.questions.map((question) => {
    const draft = drafts[question.id];
    const response = normalizeResponseForSubmission(question, draft?.response ?? null);
    const timeMs = safeElapsedMs(draft, startedAt);
    const meta = buildAnswerMeta(question);
    return { questionId: question.id, response, confidence: isQuestionAnswerComplete(question, draft) && isConfidenceRequiredForQuestion(question, normalizeDisplayPolicy(quiz.displayPolicy)) ? normalizeConfidence(draft?.confidence) : undefined, timeMs, ...(meta ? { meta, ...meta } : {}) };
  });
}

function normalizeResponseForSubmission(question: Question, response: AnswerResponse): AnswerResponse {
  if (question.type === "numeric") {
    if (typeof response === "number" && Number.isFinite(response)) return response;
    if (typeof response === "string") {
      const parsed = parseNumericResponse(response);
      return parsed ?? response.trim();
    }
    return null;
  }
  return response;
}

function safeElapsedMs(draft: DraftAnswer | undefined, startedAt?: string): number | undefined {
  if (!draft) return undefined;
  const now = Date.now();
  const firstSeenAt = clampDraftFirstSeenAt(draft.firstSeenAt, startedAt, now);
  const elapsed = Math.max(0, now - firstSeenAt);
  const sessionStartedAt = startedAt ? Date.parse(startedAt) : Number.NaN;
  const sessionElapsed = Number.isFinite(sessionStartedAt) ? Math.max(0, now - sessionStartedAt) : elapsed;
  return Math.min(elapsed, sessionElapsed, 2 * 60 * 60 * 1000);
}

function clampDraftFirstSeenAt(firstSeenAt: number, startedAt?: string, now = Date.now()): number {
  const sessionStartedAt = startedAt ? Date.parse(startedAt) : Number.NaN;
  const floor = Number.isFinite(sessionStartedAt) ? sessionStartedAt : now - 2 * 60 * 60 * 1000;
  if (!Number.isFinite(firstSeenAt)) return now;
  return Math.max(Math.min(firstSeenAt, now), floor);
}

function getSubmitIssue(quiz: QuizSpec, drafts: Record<string, DraftAnswer>, displayPolicy: DisplayPolicy, activityPolicy: ActivityPolicy, startedAt?: string): string | null {
  const records = makeAnswerRecords(quiz, drafts, startedAt);
  const completion = buildCompletionSummary(quiz, records, displayPolicy, activityPolicy);
  if (completion.isComplete) return null;
  return formatSubmitIssue(quiz, completion.missingRequiredQuestionIds, completion.missingRequiredConfidenceIds);
}

function formatSubmitIssue(quiz: QuizSpec, missingQuestions: string[], missingConfidence: string[]): string {
  const parts: string[] = [];
  if (missingQuestions.length) parts.push(`Answer ${formatQuestionList(quiz, missingQuestions)}.`);
  if (missingConfidence.length) parts.push(`Add confidence for ${formatQuestionList(quiz, missingConfidence)}.`);
  return parts.join(" ") || "Complete required items before submitting.";
}

function formatQuestionList(quiz: QuizSpec, questionIds: string[]): string {
  return questionIds.map((id) => {
    const index = quiz.questions.findIndex((question) => question.id === id);
    return index >= 0 ? `Question ${index + 1}` : id;
  }).join(", ");
}

function buildAutoGradePrompt(submission: SubmissionCapsule): string {
  const packet = buildCompactGradingPacket(submission);
  return [
    "Grade this BetterQuizzes submission now. Do not call tools, do not wait for more data, and do not recreate the quiz.",
    "Use only the compact JSON packet below. Reply quickly and concisely.",
    "Format: Score: x/y or case-dependent result; Mistakes/needs review; Targeted review. Keep the first grading reply under 120 words.",
    "Grade fill-blank and short text leniently for capitalization, spacing, and harmless punctuation.",
    "Grade skipped optional answers case-by-case: count them wrong or Needs review in strict knowledge checks when appropriate, omit them in casual practice/check-ins when more useful, and prioritize UX/debug findings over score in developer smoke tests. Treat confidence as a weak signal only.",
    JSON.stringify(packet),
  ].join("\n");
}

function buildCompactGradingPacket(submission: SubmissionCapsule): Record<string, unknown> {
  const questionMap = new Map(submission.questions.map((question) => [question.id, question]));
  const keyMap = new Map((submission.answerKey ?? []).map((entry) => [entry.questionId, entry as Record<string, unknown>]));
  return {
    kind: "betterquizzer.fast_grading_packet",
    version: WIDGET_VERSION,
    quizId: submission.quizId,
    title: limitForGrading(submission.title, 120),
    subject: limitForGrading(submission.subject, 80),
    mode: submission.mode,
    completion: submission.completion,
    items: submission.answers.map((answer) => {
      const question = questionMap.get(answer.questionId);
      const key = keyMap.get(answer.questionId);
      return {
        id: answer.questionId,
        type: question?.type,
        prompt: limitForGrading(question?.prompt, 240),
        required: question?.answerRequired ?? question?.required,
        response: compactForGrading(answer.response),
        confidence: answer.confidence,
        key: key ? compactForGrading(key.answer ?? key.expectedKeywords ?? key.rubric) : undefined,
        tolerance: key?.tolerance,
        unit: key?.unit,
      };
    }),
  };
}

function compactForGrading(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return limitForGrading(value, depth === 0 ? 360 : 160);
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => compactForGrading(item, depth + 1));
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>).slice(0, 16)) {
      result[key] = compactForGrading(nested, depth + 1);
    }
    return result;
  }
  return String(value);
}

function limitForGrading(value: unknown, maxChars: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length > maxChars ? text.slice(0, Math.max(0, maxChars - 1)) + "…" : text;
}


function isConfidenceRequiredForQuestion(question: Question, displayPolicy: DisplayPolicy): boolean {
  const record = question as Question & {
    requireConfidence?: boolean;
    confidenceRequired?: boolean;
    disableConfidence?: boolean;
    confidence?: boolean | "required" | "optional" | "disabled";
  };
  if (!displayPolicy.requireConfidence) return false;
  if (record.disableConfidence === true) return false;
  if (record.requireConfidence === false) return false;
  if (record.confidenceRequired === false) return false;
  if (record.confidence === false || record.confidence === "disabled") return false;
  return true;
}

function isQuestionRequired(question: Question, activityPolicy: ActivityPolicy): boolean {
  return question.answerRequired ?? question.required ?? activityPolicy.defaultAnswerRequired;
}

function getQuestionStatus(question: Question, draft: DraftAnswer | undefined, displayPolicy: DisplayPolicy, activityPolicy: ActivityPolicy, revealRequiredStatus = true): "ready" | "draft" | "empty" | "incomplete" | "optional" {
  const required = isQuestionRequired(question, activityPolicy);
  if (isQuestionDoneForNavigation(question, draft, displayPolicy)) return "ready";
  if (hasResponse(draft)) return required && revealRequiredStatus ? "incomplete" : "draft";
  return required && revealRequiredStatus ? "empty" : "optional";
}

function isReady(question: Question, draft: DraftAnswer | undefined, displayPolicy: DisplayPolicy, activityPolicy: ActivityPolicy): boolean {
  if (!isQuestionAnswerComplete(question, draft)) return false;
  if (displayPolicy.requireConfidence && normalizeConfidence(draft?.confidence) === undefined) return false;
  return true;
}

function isQuestionDoneForNavigation(question: Question, draft: DraftAnswer | undefined, displayPolicy: DisplayPolicy): boolean {
  const special = asSpecialResponse(draft?.response);
  if (special?.kind === "cancelled") return true;
  if (!isQuestionAnswerComplete(question, draft)) return false;
  if (displayPolicy.requireConfidence && normalizeConfidence(draft?.confidence) === undefined) return false;
  return true;
}

function hasMeaningfulText(value: string): boolean {
  const withoutFormatPlaceholders = value
    .replace(/<\/?(?:u|sub|sup)>/gi, "")
    .replace(/[*_`~]/g, "")
    .trim();
  return withoutFormatPlaceholders.length > 0;
}

function isQuestionAnswerComplete(question: Question, draft: DraftAnswer | undefined): boolean {
  if (!draft) return false;
  const response = draft.response;
  const special = asSpecialResponse(response);
  if (special?.kind === "cancelled") return true;
  switch (question.type) {
    case "multiple_choice":
      return typeof response === "number" || special?.kind === "other" && special.text.trim().length > 0;
    case "multi_select":
      return Array.isArray(response) && response.length > 0 || special?.kind === "other" && special.text.trim().length > 0;
    case "true_false":
      return typeof response === "boolean";
    case "fill_blank":
    case "short_answer":
    case "long_response":
      return typeof response === "string" && hasMeaningfulText(response);
    case "numeric":
      return typeof response === "number" && Number.isFinite(response) || typeof response === "string" && hasMeaningfulText(response);
    case "matching": {
      const leftItems = getMatchingSide(question, "left");
      const rightIds = new Set(getMatchingSide(question, "right").map((item) => item.id));
      const pairs = isMatchingPairs(response) ? response : [];
      return leftItems.length > 0 && leftItems.every((left) => pairs.some((pair) => pair.leftId === left.id && rightIds.has(pair.rightId)));
    }
    case "ordering": {
      const items = getOrderingItems(question);
      return items.length > 0 && Array.isArray(response) && response.length >= items.length;
    }
    case "multi_typing":
    case "multi_write_vertical": {
      if (!isMultiTypingResponse(response)) return false;
      const responseRecord = response as Record<string, string>;
      const fields = getMultiTypingFields(question as Question & MultiTypingLike);
      return fields.length > 0 && fields.every((field) => typeof responseRecord[field.id] === "string" && responseRecord[field.id].trim().length > 0);
    }
    case "text_select":
      return isTextSelectComplete(question, response);
    default:
      return hasResponse(draft);
  }
}

function hasResponse(draft: DraftAnswer | undefined): boolean {
  if (!draft) return false;
  const response = draft.response;
  if (response === null || response === undefined) return false;
  if (typeof response === "string") return response.trim().length > 0;
  if (Array.isArray(response)) return response.length > 0;
  const special = asSpecialResponse(response);
  if (special?.kind === "other") return special.text.trim().length > 0 || (special.selections?.length ?? 0) > 0;
  if (special?.kind === "cancelled") return true;
  if (isMultiTypingResponse(response)) return Object.values(response).some((value) => value.trim().length > 0);
  return true;
}

function asSpecialResponse(value: unknown): { kind: "other"; text: string; selections?: number[] } | { kind: "cancelled"; reason?: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.kind === "other") {
    const selections = Array.isArray(record.selections)
      ? record.selections.filter((item): item is number => typeof item === "number" && Number.isInteger(item) && item >= 0)
      : undefined;
    return { kind: "other", text: typeof record.text === "string" ? record.text : "", ...(selections ? { selections } : {}) };
  }
  if (record.kind === "cancelled") return { kind: "cancelled", reason: typeof record.reason === "string" ? record.reason : undefined };
  return null;
}

function isMatchingPairs(value: unknown): value is MatchingPair[] {
  return Array.isArray(value) && value.every((item) => item && typeof item === "object" && typeof (item as MatchingPair).leftId === "string" && typeof (item as MatchingPair).rightId === "string");
}

function normalizeConfidence(value: unknown): AnswerRecord["confidence"] | undefined {
  return value === 1 || value === 2 || value === 3 ? value : undefined;
}

function confidenceLabel(value: 1 | 2 | 3): string {
  return ["low", "medium", "high"][value - 1];
}

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

