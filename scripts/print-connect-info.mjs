#!/usr/bin/env node
const wantsPublic = process.argv.includes("--public");
const port = process.env.PORT || "8787";
const local = `http://127.0.0.1:${port}`;
const publicBase = (process.env.PUBLIC_BASE_URL || process.env.PUBLIC_ORIGIN || "").replace(/\/$/, "");
const base = wantsPublic && publicBase ? publicBase : local;

console.log(`BetterQuizzes Stage 12.1 connection card\n`);
console.log(`Web app:        ${base}/`);
console.log(`Health:         ${base}/healthz`);
console.log(`MCP endpoint:   ${base}/mcp`);
console.log(`App manifest:   ${base}/.well-known/mcp-app.json`);
console.log(`Connector card: ${base}/connector-card.json`);
console.log(`Inspector JSON: ${base}/mcp-inspector.json`);

if (wantsPublic) {
  if (!publicBase) {
    console.log(`\nPUBLIC_BASE_URL is not set. Set it to your HTTPS tunnel or deployed origin first.`);
    console.log(`Windows CMD example:`);
    console.log(`  set PUBLIC_BASE_URL=https://YOUR-TUNNEL-HOST`);
    console.log(`  npm run connect:chatgpt`);
  } else if (!publicBase.startsWith("https://")) {
    console.log(`\nWarning: ChatGPT connector testing needs HTTPS. Current PUBLIC_BASE_URL is not HTTPS.`);
  } else {
    console.log(`\nChatGPT connector setup values:`);
    console.log(`  Connector name: BetterQuizzes`);
    console.log(`  Description: Create interactive AI-generated study quizzes in ChatGPT with varied question types, confidence ratings, structured submissions, and AI grading.`);
    console.log(`  Connector URL: ${publicBase}/mcp`);
  }
} else {
  console.log(`\nFor a real ChatGPT connector/app test, expose the local server over HTTPS, set PUBLIC_BASE_URL, then run:`);
  console.log(`  npm run connect:chatgpt`);
  console.log(`  npm run host:public:strict`);
}
