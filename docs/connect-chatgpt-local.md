# Connecting BetterQuizzes Stage 11.1 Locally

## 1. Build and run locally

```bash
npm install --no-audit --no-fund
npm run verify
npm run serve:prod
```

Local endpoints:

- Web app: `http://127.0.0.1:8787/`
- Health: `http://127.0.0.1:8787/healthz`
- MCP endpoint: `http://127.0.0.1:8787/mcp`
- App manifest: `http://127.0.0.1:8787/.well-known/mcp-app.json`

## 2. Expose over HTTPS for real host testing

Real remote MCP clients generally require an HTTPS-reachable server. Use a tunnel or deploy to Render/Fly/etc.

Examples of tunnel targets:

```text
https://YOUR-TUNNEL.example/mcp
https://YOUR-DEPLOYED-APP.example/mcp
```

## 3. What to test in a host

Ask the host/model to create a quiz, then verify this flow:

1. `start_quiz` is selected by the model.
2. `add_question` is called once per assistant-authored question.
3. The first accepted `add_question` launches the BetterQuizzes widget, and later `add_question` calls update the stored quiz.
4. User answers questions and gives confidence.
5. Widget calls `submit_answers`.
6. Model receives a SubmissionCapsule.
7. Model grades the answers and gives targeted teaching.

## 4. Current limitation

Stage 11.1 is host-ready and SDK-aligned, but not submitted as a public ChatGPT App. The next step is real-host testing with an HTTPS endpoint, then replacing the handmade transport layer with the official MCP SDK if needed by the target host.
