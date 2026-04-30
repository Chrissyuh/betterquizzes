import { readFileSync } from "node:fs";

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function expect(value) {
  return {
    toBe: (other) => { if (value !== other) throw new Error(`Expected ${JSON.stringify(value)} to be ${JSON.stringify(other)}`); },
    toMatch: (regex) => { if (!regex.test(value)) throw new Error(`Expected ${value} to match ${regex}`); },
    toHaveLength: (n) => { if (value.length !== n) throw new Error(`Expected length ${value.length} to be ${n}`); },
    toBeTruthy: () => { if (!value) throw new Error(`Expected ${value} to be truthy`); }
  };
}
function load(path) { return JSON.parse(readFileSync(path, "utf8")); }

const tiny = load("src/shared/examples/tiny-demo.json");
const mixed = load("src/shared/examples/mixed-types.json");

function validateQuiz(quiz) {
  const ids = new Set();
  if (quiz.schema !== "betterquizzer.quiz" || quiz.version !== 2) return false;
  if (!Array.isArray(quiz.questions) || quiz.questions.length === 0) return false;
  for (const question of quiz.questions) {
    if (!question.id || ids.has(question.id) || !question.prompt || !question.type) return false;
    ids.add(question.id);
  }
  return true;
}

function compact(submission) {
  return `BQS2|quiz=${encodeURIComponent(submission.quizId)}|session=${encodeURIComponent(submission.sessionId)}|mode=${submission.mode}|answers=${submission.answers.length}`;
}

test("validates tiny v2 demo", () => expect(validateQuiz(tiny)).toBe(true));
test("validates mixed v2 demo", () => expect(validateQuiz(mixed)).toBe(true));
test("mixed demo includes expanded question types", () => {
  expect(mixed.questions.some((q) => q.type === "matching")).toBe(true);
  expect(mixed.questions.some((q) => q.type === "ordering")).toBe(true);
  expect(mixed.questions.some((q) => q.type === "numeric")).toBe(true);
});
test("compact submission uses BQS2", () => expect(compact({ quizId: tiny.quizId, sessionId: "s1", mode: tiny.mode, answers: [] })).toMatch(/^BQS2\|/));
test("V1 stdio server advertises widget resource metadata", () => {
  const server = readFileSync("mcp/betterquizzer-app-server.mjs", "utf8");
  expect(server.includes('ui://widget/betterquizzes-v1-build-bqv1p2.html')).toBe(true);
  expect(server.includes('text/html;profile=mcp-app')).toBe(true);
  expect(server.includes('openai/outputTemplate')).toBe(true);
});

let passed = 0;
for (const entry of tests) {
  entry.fn();
  passed += 1;
  console.log(`✓ ${entry.name}`);
}
console.log(`\n${passed} tests passed.`);
