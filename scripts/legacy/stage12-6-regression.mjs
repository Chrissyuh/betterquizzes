#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function currentDistBundle() {
  const files = readdirSync("dist/assets").filter((file) => /^index-.*\.js$/.test(file)).sort();
  if (!files.length) throw new Error("No built BetterQuizzes JS bundle found in dist/assets");
  return `dist/assets/${files[files.length - 1]}`;
}

const DIST_JS = currentDistBundle();

function assertIncludes(path, needle, label = needle) {
  const text = read(path);
  if (!text.includes(needle)) {
    throw new Error(`${path} is missing ${label}`);
  }
}

function assertExcludes(path, needle, label = needle) {
  const text = read(path);
  if (text.includes(needle)) {
    throw new Error(`${path} still includes ${label}`);
  }
}

assertIncludes("src/App.tsx", "requestChatGptGradeOnce", "automatic grade handoff function");
assertIncludes("src/App.tsx", "shouldAcceptHydratedQuiz", "same-id completeness replacement");
assertIncludes("src/App.tsx", "grade_requested", "grade requested delivery state");
assertExcludes("src/App.tsx", "Manual follow-up available", "manual follow-up default copy");
assertExcludes("src/App.tsx", "askChatGptToGrade", "manual grade button handler");

assertIncludes("src/host/openaiBridge.ts", "isCompleteRenderableLaunch", "sealed launch validation");
assertIncludes("src/host/openaiBridge.ts", "getExpectedQuestionCount", "expected question count gate");
assertExcludes("src/host/openaiBridge.ts", "bridge.widgetState", "widgetState launch hydration");

for (const path of ["mcp/remote-server.mjs", "mcp/betterquizzes-app-server.mjs", "mcp/sdk-stdio-server.mjs"]) {
  assertIncludes(path, 'kind: "betterquizzer.launch"', "sealed launch packet");
  assertIncludes(path, 'kind: "betterquizzer.submission"', "sealed submission packet");
  assertIncludes(path, "complete: true", "complete packet flag");
}

assertIncludes(DIST_JS, "requestChatGptGradeOnce", "compiled automatic grade handoff function");
assertIncludes(DIST_JS, "isCompleteRenderableLaunch", "compiled sealed launch validation");
assertIncludes(DIST_JS, "shouldAcceptHydratedQuiz", "compiled hydration replacement");
assertExcludes(DIST_JS, "Manual follow-up available", "compiled manual follow-up default copy");
assertExcludes(DIST_JS, "Debug: widgetRoute", "compiled loading debug line");

console.log("Stage 12.6 regression checks passed.");

// Legacy launch/draft/ordering checks.
assertIncludes("src/App.tsx", "STABLE_LAUNCH_MS", "stable launch barrier");
assertIncludes("src/App.tsx", "pendingLaunchRef", "pending launch stability state");
assertIncludes("src/App.tsx", "HYDRATION_ERROR_DELAY_MS", "delayed hydration errors");
assertIncludes("src/App.tsx", "getPersistedDraftState", "draft restore bridge read");
assertIncludes("src/App.tsx", "betterquizzer.answer_state", "answer state persistence");
assertIncludes("src/App.tsx", "responseDirection: behavior.direction", "ordering response direction metadata");
assertExcludes("src/App.tsx", "Your order is submitted from top to bottom.", "removed ordering visual direction copy");
assertIncludes("src/host/openaiBridge.ts", "source === \"chatgpt-widget\"", "stricter widget-only launch gate");
assertIncludes("src/host/openaiBridge.ts", "summaryRecord.kind !== \"betterquizzer.launch\"", "sealed widget launch required");
assertIncludes("src/shared/renderContract.ts", "normalizeOrderingBehavior", "ordering label normalization");
assertIncludes("src/shared/submission.ts", "response arrays are visual top-to-bottom order", "ordering grading instruction");
assertIncludes(DIST_JS, "STABLE_LAUNCH_MS", "compiled stable launch barrier");
assertIncludes(DIST_JS, "betterquizzer.answer_state", "compiled answer persistence");
assertExcludes(DIST_JS, "Your order is submitted from top to bottom.", "compiled removed ordering copy");


const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const remoteServer = readFileSync(new URL("../mcp/remote-server.mjs", import.meta.url), "utf8");

function assertStatic(condition, message) {
  if (!condition) throw new Error(message);
}

assertStatic(appSource.includes('const WIDGET_VERSION = BETTERQUIZZER_VERSION'), "Widget version constant must be 12.7.0.");
assertStatic(appSource.includes("buildCompactGradingPacket"), "Auto-grade handoff must include a compact grading packet.");
assertStatic(appSource.includes("one-turn grading handoff") && appSource.includes("not a standing instruction"), "Auto-grade prompt must be self-contained and one-shot.");
assertStatic(!appSource.includes("Your order is submitted from top to bottom."), "Ordering helper text should not mention submitted top-to-bottom copy.");
assertStatic(!appSource.includes("Top: "), "Ordering labels should not prefix Top:.");
assertStatic(!appSource.includes("Bottom: "), "Ordering labels should not prefix Bottom:.");
assertStatic(appSource.includes("responseLimit"), "Text response limits should be supported.");
assertStatic(remoteServer.includes("betterquizzer-stage12-7-0-build-bq1270.html"), "Widget resource URI should cache-bust for 12.7.0.");
assertStatic(remoteServer.includes("responseLimit.maxChars"), "Create quiz instructions should mention AI-configurable response limits.");

console.log("Stage 12.6 publish-candidate checks passed.");


// Stage 12.6 submission-prep hardening.
assertStatic(appSource.includes('BETTERQUIZZER_BUILD_ID'), 'Issue reports should include the build id.');
assertStatic(appSource.includes('requestChatGptGradeOnce'), 'Auto grading should be a one-shot ChatGPT handoff.');
assertStatic(!appSource.includes('requestGradeWithRetries'), 'Retry-loop naming should be removed from the widget source.');
assertStatic(!appSource.includes('createObjectiveGradePreview'), 'Widget should not expose local first-pass grading.');
assertStatic(!remoteServer.includes('stage: "12.1"'), 'Manifest stage must not be stale.');
assertStatic(remoteServer.includes('stage: "12.7.0"'), 'Manifest stage must be 12.7.0.');
console.log('Stage 12.6 submission-prep checks passed.');
