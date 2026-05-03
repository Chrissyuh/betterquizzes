#!/usr/bin/env node
import { readFileSync } from "node:fs";

const app = readFileSync("src/App.tsx", "utf8");
const styles = readFileSync("src/styles.css", "utf8");
const remote = readFileSync("mcp/remote-server.mjs", "utf8");
const types = readFileSync("src/shared/types.ts", "utf8");
const render = readFileSync("src/shared/renderContract.ts", "utf8");
const submission = readFileSync("src/shared/submission.ts", "utf8");

function assert(value, message) {
  if (!value) throw new Error(message);
}

assert(remote.includes('const VERSION = "V1"'), "server version must be V1");
assert(remote.includes("betterquizzes-v1-build-bqv1p1.html"), "resource URI must cache-bust for V1 patch 2");
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
assert(app.includes("onDragStart"), "ordering questions must support drag-and-drop");
assert(!app.includes("Question {currentIndex + 1} of"), "question count label must stay removed");
assert(app.includes("quiz.questions.length > 1 ? <QuestionNav"), "one-question quizzes must not show question navigation");
assert(app.includes("single-question-actions"), "one-question quizzes must not show prev/next controls");
assert(app.includes("function RichInline"), "titles and prompts must support light formatting");
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
assert(app.includes('case "numeric":\n      return typeof response === "number" && Number.isFinite(response) || typeof response === "string" && hasMeaningfulText(response);'), "numeric confidence must unlock for attempted text, even if the last character is a symbol");
assert(styles.includes("V1 hard polish"), "CSS polish block must be present");
assert(styles.includes("resize: none"), "text areas must not expose side-resize glitch");
assert(styles.includes("grid-template-columns: repeat(3"), "confidence options must remain side-by-side");
assert(styles.includes("V1 variety + formatting polish"), "V1 variety and formatting CSS must be present");
assert(styles.includes(".quiz-layout {\n  grid-template-columns: 1fr;"), "question navigation must move back above the question card");
assert(styles.includes(".top-bar p {\n  max-width: none;"), "header subtitle must use the available width");
assert(styles.includes(".skip-quiz-button {\n  min-height: 44px;"), "skip button must be large enough to tap");
assert(app.includes('"choice single-choice selected"'), "single-select choices must keep letter badges");
assert(app.includes("TOOL_INPUT_FALLBACK_DELAY_MS"), "widget must recover from interrupted ChatGPT tool responses using complete tool input after a grace period");
assert(app.includes("HYDRATION_INTERRUPTED_MS"), "widget must not wait indefinitely when no quiz packet arrives");
assert(app.includes("Quiz launch interrupted"), "widget must show a terminal recovery state instead of loading forever");
assert(!app.includes("Still connected"), "verbose loading status text should stay removed");
assert(!app.includes("Getting your quiz ready"), "verbose loading explainer should stay removed");
assert(app.includes('"choice multi-choice selected"'), "multi-select choices must use checkbox markers");
assert(!app.includes('selectedChoice ? "✓" : label'), "single-select choices must not replace letters with checkmarks");

assert(!app.includes("required complete ✓"), "submission screen must not show numeric required-complete chip");
assert(!app.includes("0/0 required complete"), "submission screen must not show 0/0 required complete");
assert(app.includes("submission.completion.requiredTotal > 0"), "required-complete chip must only render when required questions exist");
assert(!remote.includes("do not penalize blank non-required"), "remote submission handoff must not use blanket non-penalty wording");
assert(remote.includes("Grade case-by-case") || remote.includes("case-by-case"), "remote submission handoff must use case-by-case grading wording");

assert(remote.includes("V13_UX_INSTRUCTIONS"), "server must include V13 subjective-confidence and other-choice UX instructions");
assert(app.includes("isConfidenceRequiredForQuestion"), "widget must support per-question confidence disabling");
assert(app.includes("special.selections"), "multi-select Other must preserve selected choices");
assert(app.includes('return "ready";') || app.includes('if (answerComplete && confidenceComplete) return "ready";'), "completed optional questions must become ready/green");
assert(styles.includes("V13 UX: radio/circle"), "choice marker shape CSS must be present");
assert(types.includes("disableConfidence?: boolean"), "question type must support disabling confidence");
assert(submission.includes("questionRequiresConfidence"), "submission completion must respect question-level confidence disabling");

assert(styles.includes("V15: fade in newly-added questions"), "newly-added questions must fade in");
assert(styles.includes("bq-question-fade-in"), "question card fade animation must exist");
assert(styles.includes("bq-question-dot-fade-in"), "question nav dot fade animation must exist");

console.log("V1 polish regression checks passed.");

// V9 stale submit-pipeline guards
const staleReqUse = 'required complete' + '). Use';
const staleNoPenalty = 'do not penalize' + ' blank non-required';
assert(!remote.includes(staleReqUse), 'submit tool must not emit stale required-count text');
assert(!remote.toLowerCase().includes(staleNoPenalty), 'submit tool must not use blanket no-penalty wording');
assert(app.includes('submission.completion.requiredTotal > 0 ? <span>Required questions complete'), 'submission screen should only mention required completion when required questions exist');
assert(!app.includes('More ' + 'options'), 'post-submit More options should be removed');
assert(remote.includes('case-by-case'), 'submit pipeline must use case-by-case grading wording');
