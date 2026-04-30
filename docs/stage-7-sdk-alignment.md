# Stage 11.1: SDK Alignment + Host Connection Readiness

Stage 11.1 keeps the project dependency-light, but tightens the app contract so BetterQuizzes is shaped like a real MCP/ChatGPT Apps integration.

## What changed

- Added stricter MCP/App contract tests.
- Added `ping` support.
- Added `notifications/initialized` handling on HTTP and stdio paths.
- Added JSON-RPC batch request support for HTTP smoke/compatibility testing.
- Added expanded `.well-known/betterquizzer.json` and `.well-known/mcp-app.json` manifests.
- Added `/mcp-inspector.json` for easier tool/debug discovery.
- Added host-readiness checks that fail if critical widget/tool metadata disappears.
- Kept the widget UI neutral: BetterQuizzes collects answers; the LLM grades and teaches.

## Why the official SDK is not hard-required yet

This repo currently uses a small handwritten MCP-compatible layer so the student-facing app stays stable and easy to inspect. The code is now organized so the next migration can replace the transport/server plumbing with the official MCP TypeScript SDK without changing the React quiz UI or the shared SubmissionCapsule model.

## Compatibility target

BetterQuizzes exposes:

- `POST /mcp` as the remote MCP-style endpoint.
- `GET /healthz` for deployment health checks.
- `GET /.well-known/betterquizzer.json` for app metadata.
- `GET /.well-known/mcp-app.json` for host-oriented metadata.
- `GET /mcp-inspector.json` for local development/debugging.

Tools:

- `create_quiz`: receives a QuizSpec v2 and opens the widget.
- `submit_answers`: receives widget answers and returns a SubmissionCapsule.
- `inspect_quiz`: debugging/smoke-test helper.

Resource:

- `ui://widget/betterquizzer-stage11.html`
- MIME type: `text/html;profile=mcp-app`

## Verification

Run:

```bash
npm run verify
```

This runs:

1. TypeScript typecheck
2. Shared model tests
3. Production Vite build
4. Stdio MCP demo
5. HTTP smoke test
6. App contract test
7. Host readiness static checks
