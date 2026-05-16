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
assert(remote.includes("betterquizzer-stage12-7-0-build-bq1270.html"), "12.7.0 alias must remain active");
assert(remote.includes("declaredQuestionCount"), "launch packet must declare expected question count");
assert(remote.includes("packetProgress"), "launch packet must include upload progress metadata");
assert(types.includes('"multi_write_vertical"'), "types must include multi_write_vertical");
assert(types.includes('"text_select"'), "types must include text_select");
assert(render.includes("MultiWriteVerticalQuestion"), "render contract must certify multi_write_vertical");
assert(render.includes("TextSelectQuestion"), "render contract must certify text_select");
assert(submission.includes("multi_write_vertical"), "submission capsule must understand multi_write_vertical");
assert(submission.includes("text_select"), "submission capsule must understand text_select");
assert(submission.includes("typeof response === \"string\" && response.trim().length > 0"), "numeric completion must accept attempted string answers so symbol-ending values can submit");
assert(app.includes("function MultiWriteVerticalInput"), "app must render multi-write vertical questions");
assert(app.includes("function TextSelectInput"), "app must render text-select questions");
assert(app.includes("isQuestionAnswerComplete(question, draft)"), "confidence must be gated by complete question state");
assert(app.includes("Preserve confidence while a user temporarily clears or edits an answer"), "confidence should survive un-answer/re-answer edits");
assert(app.includes("disabled={!answerComplete}"), "confidence picker must stay disabled until all question parts are complete");
assert(app.includes("function OrderingInput") && app.includes("bqV61OrderingRebuild") && app.includes("data-ordering-mode") && app.includes("draggable={false}") && app.includes("moveByStep"), "ordering questions must support rebuilt separate desktop/mobile sorting with fallback controls");
assert(app.includes("questionIndex={currentIndex}") && app.includes("Question {questionIndex + 1} of {visibleTotal}"), "question cards must show a stable question number label");
assert(app.includes("const shouldShowQuestionNav = quiz.questions.length > 1 || Boolean(generationStatus)"), "question navigation must show when a one-question staged quiz expects more questions");
assert(app.includes("single-question-actions"), "one-question quizzes must not show prev/next controls");
assert(app.includes("const submitLooksReady = allQuestionsDone"), "submit button should look ready only when every question is complete");
assert(app.includes("incompleteSubmitPrompt") && app.includes("Submit anyway") && app.includes("Review unfinished"), "incomplete optional submissions must ask for confirmation");
assert(app.includes("generation-status-strip") && app.includes("Questions are being added:"), "incremental generation must use a compact status strip");
assert(app.includes("planned-question") && styles.includes(".question-dots .planned-question"), "incremental generation must show planned question placeholders in the question bar");
assert(!app.includes("className=\"card question-card build-next-card\""), "incremental generation must not render the old end-card");
assert(app.includes("const [submitAttempted, setSubmitAttempted]") && app.includes("revealRequiredStatus={submitAttempted}"), "required validation styling must wait until submit is attempted");
assert(app.includes("disabled={submitting}") && !app.includes("disabled={submitting || !canSubmit}"), "submit must remain clickable so missing required items can show delayed feedback");
assert(app.includes("function RichInline"), "titles and prompts must support light formatting");
assert(app.includes("<u>") && remote.includes("Use <u>...</u> sparingly for critical negations"), "underline emphasis must be supported and advertised for critical negations");
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
assert(!app.includes("callHostOpenQuizForUpdates(quizId)") && !bridge.includes("getHostQuizPayloadFromToolResult"), "widget must not fall back to live host open_quiz calls for updates");
assert(app.includes("nextRevision > currentRevision") && app.includes("setLaunchId((currentLaunchId) => getRecoveredLaunchId(serverQuiz) ?? currentLaunchId)"), "widget must accept newer stored quiz revisions while answering");
assert(readFileSync("src/host/openaiBridge.ts", "utf8").includes("quiz.questions.length > expectedQuestionCount"), "widget must accept certified partial launch packets for staged generation");
assert(app.includes("submission.launchId = launchId") && app.includes("submission.quizRevision = quiz.metadata.quizRevision"), "submissions must carry stable launch/revision identity");
assert(!app.includes('"/api/quiz/latest"') && app.includes("getRequestedRecoveryToken") && app.includes("SERVER_RECOVERY_TIMEOUT_MS"), "widget must not use latest-quiz as a generic ChatGPT hydration fallback");
assert(app.includes("describeHostBridgeState()") && app.includes("Server bases:"), "widget hydration failures must include useful technical recovery details");
assert(remote.includes("window.__BETTERQUIZZER_SERVER_BASES__=") && remote.includes("requestOrigin") && remote.includes("connectDomains"), "production widget bootstrap must include fallback server bases and CSP connect domains");
assert(remote.includes('type !== "text_select"') && remote.includes("Text-select questions need segments") && remote.includes("Do not use choices for text_select"), "draft validator must not reject text_select as a choice question");
assert(remote.includes("Do not use text_select for a single obvious sentence") && remote.includes("at least three plausible selectable segments"), "text_select quality guardrails must reject one-obvious-phrase questions");
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
assert(/\.skip-quiz-button\s*\{[\s\S]*?min-height:\s*44px\s*;/.test(styles), "skip button must be large enough to tap");
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

assert(remote.includes('name: "record_grade"'), "record_grade tool must be exposed");
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
assert(app.includes('submission.completion.requiredTotal > 0 ? <span>Required questions complete'), 'submission screen should only mention required completion when required questions exist');
assert(!app.includes('More ' + 'options'), 'post-submit More options should be removed');
assert(remote.includes('case-by-case'), 'submit pipeline must use case-by-case grading wording');
