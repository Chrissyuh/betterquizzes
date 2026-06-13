#!/usr/bin/env node
import { readFileSync } from "node:fs";

const app = readFileSync("src/App.tsx", "utf8");
const styles = readFileSync("src/styles.css", "utf8");
const remote = readFileSync("mcp/remote-server.mjs", "utf8");
const types = readFileSync("src/shared/types.ts", "utf8");
const render = readFileSync("src/shared/renderContract.ts", "utf8");
const submission = readFileSync("src/shared/submission.ts", "utf8");
const bridge = readFileSync("src/host/openaiBridge.ts", "utf8");

function assert(value, message) {
  if (!value) throw new Error(message);
}

assert(remote.includes('const VERSION = "V1"'), "server version must be V1");
assert(/const RESOURCE_URI = "ui:\/\/widget\/[^"\n]*betterquiz[^"\n]*";/.test(remote), "resource URI must cache-bust for V1 patch 2");
assert(remote.includes('const RESOURCE_URI = "ui://widget/betterquizzes-v70-review-gating.html"'), "review gating must use a v70 widget URI so ChatGPT does not reuse the v69 cached resource");
assert(remote.includes("betterquizzes-v69-review-polish.html"), "v69 review-polish URI must remain available as a compatibility alias");
assert(remote.includes("betterquizzes-v68-mobile-dot-fix.html"), "v68 mobile-dot-fix URI must remain available as a compatibility alias");
assert(remote.includes("betterquizzes-v67-screenshot-polish.html"), "v67 screenshot-polish URI must remain available as a compatibility alias");
assert(remote.includes("betterquizzes-v66-refresh-grace.html"), "v66 refresh-grace URI must remain available as a compatibility alias");
assert(remote.includes("betterquizzes-v65-final-hardening.html"), "v65 final-hardening URI must remain available as a compatibility alias");
assert(remote.includes("betterquizzes-v64-polish.html"), "v64 polish URI must remain available as a compatibility alias");
assert(remote.includes("betterquizzes-v63-uxfix.html"), "v63 UX-fix URI must remain available as a compatibility alias");
assert(remote.includes("betterquizzes-v62-fastload.html"), "v62 fast-load URI must remain available as a compatibility alias");
assert(remote.includes("betterquizzer-stage12-7-0-build-bq1270.html"), "12.7.0 alias must remain active");
assert(remote.includes("declaredQuestionCount"), "launch packet must declare expected question count");
assert(remote.includes("packetProgress"), "launch packet must include upload progress metadata");
assert(types.includes('"multi_write_vertical"'), "types must include multi_write_vertical");
assert(render.includes("MultiWriteVerticalQuestion"), "render contract must certify multi_write_vertical");
const supportedQuestionTypeBlock = render.slice(render.indexOf("const SUPPORTED_QUESTION_TYPES"), render.indexOf("const ORDERING_ITEM_TEXT_MAX_CHARS"));
assert(!supportedQuestionTypeBlock.includes('"text_select"') && !remote.includes('"text_select", "matching"'), "text_select must not be advertised or renderer-certified for launch");
assert(submission.includes("multi_write_vertical"), "submission capsule must understand multi_write_vertical");
assert(submission.includes("typeof response === \"string\" && response.trim().length > 0"), "numeric completion must accept attempted string answers so symbol-ending values can submit");
assert(app.includes("function MultiWriteVerticalInput"), "app must render multi-write vertical questions");
assert(app.includes("isQuestionAnswerComplete(question, draft)"), "confidence must be gated by complete question state");
assert(app.includes("Preserve confidence while a user temporarily clears or edits an answer"), "confidence should survive un-answer/re-answer edits");
assert(app.includes("disabled={!answerComplete || readOnly}"), "confidence picker must stay disabled until all question parts are complete");
assert(app.includes("function isConfidenceEnabledForQuestion") && app.includes("const confidenceEnabled = isConfidenceEnabledForQuestion(question, displayPolicy)"), "confidence visibility must be separate from confidence requirement");
assert(app.includes('record.confidence === true || record.confidence === "optional" || record.confidence === "required"'), "model-enabled confidence must show even when quiz-level confidence is inconsistent");
assert(app.includes('record.confidence === "optional") return false'), "optional confidence must not block ready/green completion");
assert(app.includes("isConfidenceRequiredForQuestion(question, displayPolicy) && normalizeConfidence(draft?.confidence) === undefined"), "completion must respect per-question confidence requirements");
assert(!app.includes("Answer this question to choose confidence.") && app.includes("Confidence unlocks after you answer."), "confidence locked copy must stay concise and non-demanding");
assert(app.includes("function OrderingInput") && app.includes("bqV61OrderingRebuild") && app.includes("data-ordering-mode") && app.includes("draggable={false}") && app.includes("moveByStep"), "ordering questions must support rebuilt separate desktop/mobile sorting with fallback controls");
assert(app.includes("x: 0,") && styles.includes("transform: translate3d(0, var(--drag-y, 0), 0)"), "ordering drag visual movement must be vertically clamped");
assert(app.includes("getClampedOrderingDragClientY") && app.includes("draggedMidY") && app.includes('document.visibilityState !== "visible"'), "ordering drag must clamp inside list bounds, switch by dragged-row midpoint, and end on focus/visibility loss");
assert(app.includes("questionIndex={currentIndex}") && app.includes("Question {questionIndex + 1} of {visibleTotal}"), "question cards must show a stable question number label");
assert(app.includes("suppressAutoScrollUntilRef") && app.includes("rail.scrollBy({ left: step * direction"), "question number rail must auto-scroll without fighting manual scroll");
assert(app.includes("const shouldShowQuestionNav = quiz.questions.length > 1 || Boolean(generationStatus)"), "question navigation must show when a one-question staged quiz expects more questions");
assert(app.includes("single-question-actions"), "one-question quizzes must not show prev/next controls");
assert(app.includes("const submitLooksReady = allQuestionsDone"), "submit button should look ready only when every question is complete");
assert(app.includes("incompleteSubmitPrompt") && app.includes("Submit anyway") && app.includes("Review unfinished"), "incomplete optional submissions must ask for confirmation");
assert(app.includes("panel-close-button") && app.includes("closeOnOutsidePointer") && app.includes('event.key === "Escape"') && styles.includes("background: #fff7ed") && styles.includes("grid-template-columns: repeat(2, minmax(0, 1fr))"), "incomplete submit warning must be soft, full-width, and dismissible");
assert(app.includes("function ReviewQuizScreen") && app.includes("buildReviewDraftsFromSubmission") && app.includes("readOnly") && app.includes("Back to results"), "submitted quizzes must support read-only review mode");
assert(app.includes("buildQuestionGradeMap") && app.includes("questionGradeMarks") && app.includes("question-grade-feedback"), "review mode must render per-question recorded grade feedback");
assert(styles.includes(".dot.grade-correct") && styles.includes(".dot.grade-incorrect") && styles.includes(".dot.grade-partially-correct") && styles.includes(".dot.grade-needs-review"), "review question dots must be color-coded by recorded grade status");
assert(styles.includes(".read-only-question-fieldset:disabled .match-row") && styles.includes(".read-only-question-fieldset:disabled .field-label textarea"), "read-only review mode must grey out non-choice answer surfaces");
assert(app.includes("reviewWaitingForGrade") && app.includes("Waiting for feedback...") && app.includes("Review submitted answers") && styles.includes(".review-loading-button"), "post-submit review must wait for grade feedback before enabling, with timeout fallback");
assert(app.includes("getFriendlyFollowUpMessage") && !app.includes("{finished.followUpMessage ?? \"Still trying to send your answers for feedback.\"}"), "post-submit page must avoid technical follow-up messages");
assert(!app.includes("Answers saved") && !app.includes("Feedback requested") && !app.includes("Waiting for feedback to appear"), "post-submit page must avoid the old technical status chips");
assert(app.includes("generation-status-strip") && app.includes("Questions are being added:"), "incremental generation must use a compact status strip");
assert(app.includes("planned-question") && styles.includes(".question-dots .planned-question"), "incremental generation must show planned question placeholders in the question bar");
assert(styles.includes("--bq-dot-size") && styles.includes("bq-question-number-fade-v69") && styles.includes("bq-planned-question-fade-v70") && styles.includes("V70 review gating and rail rollback"), "planned question placeholders must match real dot dimensions and loaded dots must keep the pre-V69 look");
assert(!app.includes("className=\"card question-card build-next-card\""), "incremental generation must not render the old end-card");
assert(app.includes("const [submitAttempted, setSubmitAttempted]") && app.includes("revealRequiredStatus={submitAttempted}"), "required validation styling must wait until submit is attempted");
assert(app.includes("disabled={submitting}") && !app.includes("disabled={submitting || !canSubmit}"), "submit must remain clickable so missing required items can show delayed feedback");
assert(app.includes("function RichInline"), "titles and prompts must support light formatting");
assert(app.includes("<u>") && remote.includes("Use <u>...</u> sparingly for critical negations"), "underline emphasis must be supported and advertised for critical negations");
assert(remote.includes("3 choices are fine") && remote.includes("5+ choices") && remote.includes("Avoid filler options"), "model guidance must allow 3 or 5+ meaningful answer choices");
assert(remote.includes("Do not add confidence by default") && remote.includes("use it only when certainty is useful"), "model guidance must keep confidence opt-in instead of default");
assert(app.includes("katex.renderToString") && app.includes("dangerouslySetInnerHTML"), "quiz display text must render LaTeX math safely through KaTeX");
assert(styles.includes("katex/dist/katex.min.css") || readFileSync("src/main.tsx", "utf8").includes("katex/dist/katex.min.css"), "KaTeX CSS must be loaded");
assert(remote.includes("LaTeX math using only \\\\(...\\\\)") && remote.includes("Do not use dollar-sign math delimiters"), "model instructions must allow explicit LaTeX delimiters and reject dollar delimiters");
assert(render.includes("COMPACT_CHOICE_TEXT_WARN_CHARS") && render.includes("compact display text"), "render contract must warn about long compact labels");
assert(remote.includes("v23NormalizeMatchingQuestion") && remote.includes("Matching canonical shape") && remote.includes("left:[{id,text}], right:[{id,text}], answer:[{leftId,rightId}]"), "builder tools must accept and describe canonical matching schema");
assert(types.includes("rightItemReuse?: \"allow_reuse\" | \"unique\"") && app.includes("isUniqueMatchingQuestion") && remote.includes("matchingBehavior:{rightItemReuse:'unique'}"), "matching must support opt-in one-to-one right-side answers");
assert(render.includes("normalizeMatchingQuestion") && render.includes("normalized legacy matching pairs to left/right/answer"), "render contract must normalize legacy matching pairs before finalization");
assert(remote.includes("REPAIR_QUESTION_INPUT_SCHEMA") && remote.includes('required: ["draftId", "repairedQuestion"]'), "repair_question must expose repairedQuestion in its input schema");
assert(remote.includes("SUPPORTED_QUESTION_TYPE_VALUES") && remote.includes("Use multi_select, not multiple_select"), "builder schemas must expose supported question types and the multiple_select correction");
assert(remote.includes("Unsupported question type:") && remote.includes("prepareQuizForRender({"), "add_question must validate renderer compatibility before storing questions");
assert(remote.includes("start_quiz with expectedQuestionCount") && remote.includes("Do not send chat progress/check-in messages while authoring"), "model instructions must prefer quiet staged authoring");
assert(remote.includes("globalThis.__betterQuizzesV23LatestDraftId") && remote.includes("Accepted question stored"), "add_question must store accepted questions continuously");
assert(remote.includes('name: "open_quiz"') && remote.includes("OPEN_TOOL_ANNOTATIONS") && remote.includes("idempotentHint: true"), "open_quiz must be a stable idempotent launch tool");
assert(remote.includes("v23SyncLaunchedDraft") && remote.includes('name: "add_first_question"') && remote.includes("launch exactly one widget"), "staged authoring must launch from add_first_question");
assert(!remote.includes('name: "finalize_quiz"') && remote.includes("Do not call open_quiz or finalize_quiz for normal assistant-authored quizzes"), "finalize_quiz must not be advertised in the normal model tool path");
assert(app.includes("fetchQuizUpdateForIncrementalBuild(quizId, recoveryToken ?? launchId)") && app.includes("No recovery token or launchId is available for token-scoped quiz updates") && app.includes("shouldPollForServerQuizUpdates(quiz, hydrationProgress)") && app.includes("setQuiz(serverQuiz)"), "widget must poll token-scoped stored quiz updates while questions are still generating");
assert(app.includes("serverUpdateWakeSignal") && app.includes("setServerUpdateWakeSignal") && app.includes("subscribeHostQuizPayload(() =>"), "host bridge updates must wake token-scoped quiz polling after later question tool calls");
assert(app.includes("SERVER_UPDATE_FAST_WINDOW_MS") && app.includes("lastServerUpdateAtRef") && app.includes("pointerdown") && app.includes("online"), "stored-quiz polling must stay fast after updates and wake on user/network activity");
assert(app.includes("HYDRATION_ERROR_GRACE_MS") && app.includes("SERVER_RECOVERY_TIMEOUT_MS + HYDRATION_ERROR_GRACE_MS"), "initial loading errors must get a short grace period before becoming visible");
assert(!app.includes("callHostOpenQuizForUpdates(quizId)") && !bridge.includes("getHostQuizPayloadFromToolResult"), "widget must not fall back to live host open_quiz calls for updates");
assert(app.includes("nextRevision > currentRevision") && app.includes("setLaunchId((currentLaunchId) => getRecoveredLaunchId(serverQuiz) ?? currentLaunchId)"), "widget must accept newer stored quiz revisions while answering");
assert(readFileSync("src/host/openaiBridge.ts", "utf8").includes("quiz.questions.length > expectedQuestionCount"), "widget must accept certified partial launch packets for staged generation");
assert(app.includes("submission.launchId = launchId") && app.includes("submission.quizRevision = quiz.metadata.quizRevision"), "submissions must carry stable launch/revision identity");
assert(app.includes("sendSubmissionFollowUp(buildAutoGradePrompt(submission, quiz), 4500)") && app.includes("kind: \"betterquizzer.fast_grading_packet\"") && app.includes("const richQuestionMap"), "submission follow-up must be self-contained when the host tool result is not visible after a chat interruption");
assert(app.includes("After grading, call record_grade exactly once") && app.includes("sessionId: submission.sessionId") && !app.includes("Grade this BetterQuizzes submission now. Do not call tools"), "automatic grading prompt must request record_grade and include sessionId");
assert(!app.includes('"/api/quiz/latest"') && app.includes("getRequestedRecoveryToken") && app.includes("SERVER_RECOVERY_TIMEOUT_MS"), "widget must not use latest-quiz as a generic ChatGPT hydration fallback");
assert(app.includes("describeHostBridgeState()") && app.includes("Server bases:"), "widget hydration failures must include useful technical recovery details");
assert(remote.includes("window.__BETTERQUIZZER_SERVER_BASES__=") && remote.includes("requestOrigin") && remote.includes("connectDomains"), "production widget bootstrap must include fallback server bases and CSP connect domains");
assert(!remote.includes("Do not use text_select/sentence-selection until after launch") && !remote.includes("Do not author text_select"), "active model guidance must not suggest text-select authoring or repair");
assert(bridge.includes('callHostJsonRpc("tools/call"') && bridge.includes('callHostJsonRpc("ui/message"'), "bridge must include JSON-RPC fallbacks for tools/call and ui/message");
assert(app.includes("parseNumericResponse"), "numeric input must preserve and parse decimal/fraction strings");
assert(app.includes("function formatPlainText"), "format buttons must not insert raw markdown/html tags into student answers");
assert(app.includes("stripTextFormatting"), "format buttons must be reversible and able to clear plain-text formatting");
assert(app.includes("format === \"plain\""), "format toolbar must include a clear-formatting control");
assert(app.includes("isFormatEquivalent"), "format buttons must toggle formatting back to plain text");
assert(app.includes("expandSelectionToEditableToken"), "format buttons must use safer current-token selection handling");
assert(styles.includes("V1 text-format button polish"), "text formatting toolbar polish CSS must be present");
assert(styles.includes(".format-toolbar .format-plain"), "format toolbar must style the clear-formatting control");
assert(app.includes("function formatWidgetVersion"), "version chip must not render vV1");
assert(!app.includes("v{WIDGET_VERSION}"), "version chip must not hard-prefix V1 with v");
assert(!app.includes("wrapFormattedText"), "format buttons must not store formatting markup in typed responses");
assert(app.includes("parsed ?? response.trim()"), "invalid numeric attempts must be preserved for LLM grading instead of turning into null");
assert(app.includes('case "numeric":') && app.includes('typeof response === "string"') && app.includes('hasMeaningfulText(response)'), "numeric confidence must unlock for attempted text, even if the last character is a symbol");
assert(styles.includes("V1 hard polish"), "CSS polish block must be present");
assert(styles.includes("resize: none"), "text areas must not expose side-resize glitch");
assert(styles.includes("grid-template-columns: repeat(3"), "confidence options must remain side-by-side");
assert(styles.includes("V1 variety + formatting polish"), "V1 variety and formatting CSS must be present");
assert(/\.quiz-layout\s*\{[\s\S]*?grid-template-columns:\s*1fr\s*;/.test(styles), "question navigation must move back above the question card");
assert(/\.top-bar\s+p\s*\{[\s\S]*?max-width:\s*none\s*;/.test(styles), "header subtitle must use the available width");
assert(!app.includes("Skip this quiz"), "skip quiz action must be removed from the widget");
assert(app.includes('"choice single-choice selected"'), "single-select choices must keep letter badges");
assert(!app.includes("TOOL_INPUT_FALLBACK_DELAY_MS") && !bridge.includes("allowUnsealedToolInput"), "widget must not accept unsealed tool input as a launch source");
assert(app.includes("HYDRATION_INTERRUPTED_MS"), "widget must not wait indefinitely when no quiz packet arrives");
assert(
  app.includes("Quiz did not finish loading") ||
    app.includes("Quiz launch interrupted") ||
    app.includes("The quiz did not arrive completely") ||
    app.includes("terminal recovery") ||
    app.includes("recover automatically"),
  "widget must show a terminal recovery state instead of loading forever"
);
assert(
  app.includes("bqV27OrderingDisplayOrder") ||
    app.includes("bqV27OrderingInitialOrder") ||
    app.includes("safeInitialOrder") ||
    app.includes("bqV26AvoidAlreadyCorrectOrdering") ||
    app.includes("response.length ? response : initialOrder") ||
    app.includes("Array.isArray(response) && response.length ? response : initialOrder"),
  "ordering list must use initialOrder for empty responses"
);
assert(styles.includes("V19: ordering repair and stronger staged loading"), "V19 stronger staged loading CSS must be present");
assert(styles.includes("bq-staged-dot-arrival-v19"), "question dots must have stronger staged arrival animation");
assert(styles.includes("bq-card-arrival-v19"), "question cards must have stronger arrival animation");
assert(styles.includes("bq-ai-ellipsis-v19"), "AI still-generating ellipsis animation must exist");
assert(styles.includes("bq-question-arrival-v46") && styles.includes("1.35s cubic-bezier"), "new questions must use slower V46 arrival animation");
assert(styles.includes("bq-question-arrival-v69") && styles.includes("1.55s cubic-bezier"), "new questions must use slower V69 arrival animation");
assert(!app.includes("Skip this quiz") && remote.includes("betterquizzes-v70-review-gating.html"), "skip removal and review gating must ship with a widget URI cache bust");
assert(!app.includes("quiz.description ? <RichBlock") && styles.includes("V68 screenshot polish"), "quiz descriptions must stay hidden and mobile screenshot compaction CSS must exist");

assert(remote.includes('name: "record_grade"'), "record_grade tool must be exposed");
assert(remote.includes("partially_correct") && remote.includes("Prefer omitting correct items") && remote.includes("normalizeGradeMark") && remote.includes("After grading, call record_grade exactly once"), "record_grade must document and normalize per-question review marks");
assert(remote.includes("const grades = new Map();"), "server must store recorded grades");
assert(remote.includes('url.pathname.startsWith("/api/grade/")') && remote.includes("requireQuizRecoveryAccess(url, quizId)"), "server must expose token-scoped grade polling endpoint");
assert(app.includes("fetchGradeFromServer"), "widget must poll for recorded grades");
assert(app.includes("GradeSummaryCard"), "widget must display recorded grades");
assert(styles.includes("V20: grade writeback"), "grade writeback CSS must be present");

console.log("V1 polish regression checks passed.");

// V9 stale submit-pipeline guards
const staleReqUse = 'required complete' + '). Use';
const staleNoPenalty = 'do not penalize' + ' blank non-required';
assert(!remote.includes(staleReqUse), 'submit tool must not emit stale required-count text');
assert(!remote.toLowerCase().includes(staleNoPenalty), 'submit tool must not use blanket no-penalty wording');
assert(!app.includes('submission.completion.requiredTotal > 0 ? <span>Required questions complete'), 'submission screen should not show the old required-completion status chip');
assert(!app.includes('More ' + 'options'), 'post-submit More options should be removed');
assert(remote.includes('case-by-case'), 'submit pipeline must use case-by-case grading wording');
