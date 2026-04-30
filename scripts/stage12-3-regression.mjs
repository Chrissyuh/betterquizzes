#!/usr/bin/env node
import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

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

assertIncludes("src/App.tsx", "requestChatGptGradeOnce", "automatic grade retry loop");
assertIncludes("src/App.tsx", "shouldAcceptHydratedQuiz", "same-id completeness replacement");
assertIncludes("src/App.tsx", "grade_requested", "grade requested delivery state");
assertExcludes("src/App.tsx", "Manual follow-up available", "manual follow-up default copy");
assertExcludes("src/App.tsx", "askChatGptToGrade", "manual grade button handler");

assertIncludes("src/host/openaiBridge.ts", "isCompleteRenderableLaunch", "sealed launch validation");
assertIncludes("src/host/openaiBridge.ts", "getExpectedQuestionCount", "expected question count gate");
assertExcludes("src/host/openaiBridge.ts", "bridge.widgetState", "widgetState launch hydration");

for (const path of ["mcp/remote-server.mjs", "mcp/betterquizzer-app-server.mjs", "mcp/sdk-stdio-server.mjs"]) {
  assertIncludes(path, 'kind: "betterquizzer.launch"', "sealed launch packet");
  assertIncludes(path, 'kind: "betterquizzer.submission"', "sealed submission packet");
  assertIncludes(path, "complete: true", "complete packet flag");
}

assertIncludes("dist/assets/index-XinejuK9.js", "requestChatGptGradeOnce", "compiled automatic grade retry loop");
assertIncludes("dist/assets/index-XinejuK9.js", "isCompleteRenderableLaunch", "compiled sealed launch validation");
assertIncludes("dist/assets/index-XinejuK9.js", "shouldAcceptHydratedQuiz", "compiled hydration replacement");
assertExcludes("dist/assets/index-XinejuK9.js", "Manual follow-up available", "compiled manual follow-up default copy");
assertExcludes("dist/assets/index-XinejuK9.js", "Debug: widgetRoute", "compiled loading debug line");

console.log("Stage 12.3 regression checks passed.");
