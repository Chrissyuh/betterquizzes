#!/usr/bin/env node
import { readFileSync } from "node:fs";

const server = readFileSync("mcp/remote-server.mjs", "utf8");
function assert(value, message) { if (!value) throw new Error(message); }

assert(server.includes('const VERSION = "V1"'), "server version must be V1");
assert(server.includes('ui://widget/betterquizzes-v1-build-bqv1p1.html'), "widget URI must be versioned for V1");
assert(server.includes('CREATE_QUIZ_INPUT_SCHEMA'), "create_quiz must use a named input schema");
assert(server.includes('QUIZ_SPEC_SCHEMA'), "server must expose a QuizSpec schema");
assert(server.includes('QUESTION_SCHEMA'), "server must expose discriminated question schemas");
assert(server.includes('oneOf'), "question schema should be discriminated with oneOf");
assert(server.includes('MultipleChoiceQuestion'), "schema must include multiple choice shape");
assert(server.includes('ShortAnswerQuestion'), "schema must include short answer shape");
assert(server.includes('prepareQuizForRender'), "server must normalize and validate quizzes before rendering");
assert(server.includes('getRenderDiagnostics'), "server must return render diagnostics");
assert(server.includes('renderableQuestionCount'), "create_quiz must report renderable question count");
assert(server.includes('componentByQuestion'), "render diagnostics must include componentByQuestion");
assert(server.includes('normalizedFields'), "render diagnostics must include normalizedFields");
assert(server.includes('rendererCertified'), "render diagnostics must include rendererCertified");
assert(server.includes('canonical minimal example') || server.includes('Canonical minimal example'), "tool description should include canonical example guidance");
assert(!server.includes('"openai/outputTemplate": RESOURCE_URI,\n      "openai/widgetAccessible": true,\n      "openai/toolInvocation/invoking": "Submitting'), "submit_answers must not attach the widget output template");

console.log("V1 MCP/App contract static checks passed.");
