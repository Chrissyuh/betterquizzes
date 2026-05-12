#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const server = spawn(process.execPath, ["mcp/betterquizzes-app-server.mjs"], { stdio: ["pipe", "pipe", "inherit"] });
let nextId = 1;
let buffer = Buffer.alloc(0);
const pending = new Map();

server.stdout.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    const header = buffer.slice(0, headerEnd).toString("utf8");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) throw new Error(`Bad header: ${header}`);
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + length) return;
    const body = buffer.slice(bodyStart, bodyStart + length).toString("utf8");
    buffer = buffer.slice(bodyStart + length);
    const message = JSON.parse(body);
    const resolver = pending.get(message.id);
    if (resolver) {
      pending.delete(message.id);
      resolver(message);
    }
  }
});

function request(method, params = {}) {
  const id = nextId++;
  const message = { jsonrpc: "2.0", id, method, params };
  const body = JSON.stringify(message);
  server.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  return new Promise((resolve) => pending.set(id, resolve));
}

async function main() {
  console.log("→ initialize");
  console.log(await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "stage12-demo", version: "0.1.0" } }));
  console.log("→ tools/list");
  const tools = await request("tools/list");
  console.log(tools.result.tools.map((tool) => ({ name: tool.name, ui: tool._meta?.ui?.resourceUri })));
  console.log("→ resources/list");
  console.log(await request("resources/list"));
  console.log("→ resources/read");
  const resource = await request("resources/read", { uri: "ui://widget/betterquizzer-stage12-1.html" });
  console.log({ mimeType: resource.result.contents[0].mimeType, chars: resource.result.contents[0].text.length });
  console.log("→ start_quiz/add_question/finalize_quiz");
  const quiz = JSON.parse(readFileSync("src/shared/examples/tiny-demo.json", "utf8"));
  const started = await request("tools/call", { name: "start_quiz", arguments: { title: quiz.title, topic: quiz.subject, expectedQuestionCount: quiz.questions.length } });
  const draftId = started.result.structuredContent.draftId;
  for (const question of quiz.questions) {
    await request("tools/call", { name: "add_question", arguments: { draftId, question } });
  }
  const created = await request("tools/call", { name: "finalize_quiz", arguments: { draftId, quizId: quiz.quizId } });
  console.log(created.result.structuredContent);
  console.log("→ submit_answers");
  const submitted = await request("tools/call", {
    name: "submit_answers",
    arguments: {
      quizId: created.result.structuredContent.quizId,
      sessionId: "demo-session",
      answers: [
        { questionId: "q1", response: 2, confidence: 3 },
        { questionId: "q2", response: "Paris", confidence: 3 },
        { questionId: "q3", response: "A short check of knowledge.", confidence: 3 }
      ]
    }
  });
  console.log({ schema: submitted.result.structuredContent.submission.schema, answers: submitted.result.structuredContent.submission.answers.length });
  server.kill();
}

main().catch((error) => {
  console.error(error);
  server.kill();
  process.exit(1);
});
