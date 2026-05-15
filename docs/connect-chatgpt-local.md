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

1. `start_quiz` is selected by the model and creates a draft without opening the widget.
2. `add_first_question` is called once for the first assistant-authored question and returns the widget launch packet immediately.
3. `open_quiz` is available only as an idempotent recovery/reopen tool if the first launch packet is lost.
4. Later storage-only `add_question` calls update the stored quiz one question at a time while the widget polls the token-scoped quiz endpoint for new revisions. These later calls do not advertise a widget output template and must not open duplicate widgets.
5. User answers questions and gives confidence.
6. Widget calls `submit_answers`.
7. Model receives a SubmissionCapsule.
8. Model grades the answers and gives targeted teaching.

## 4. Current limitation

Stage 11.1 is host-ready and SDK-aligned, but not submitted as a public ChatGPT App. The next step is real-host testing with an HTTPS endpoint, then replacing the handmade transport layer with the official MCP SDK if needed by the target host.
