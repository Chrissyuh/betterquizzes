# BetterQuizzes Stage 11.1: Deployment and Real-Host Readiness

Stage 11.1 turns the Stage 5 native-widget prototype into a deployable integration package.

## Stage 11.1 goal

BetterQuizzes should be runnable in three ways:

1. **Standalone web app** for normal browser testing.
2. **stdio MCP-style server** for local tool-client testing.
3. **HTTP deployment server** for hosted smoke tests and real host connection prep.

## What changed

### 1. Remote HTTP server

`mcp/remote-server.mjs` serves:

- `GET /` — the production BetterQuizzes web app from `dist/`
- `GET /healthz` — health/status JSON
- `GET /.well-known/betterquizzer.json` — simple integration manifest for humans/scripts
- `POST /mcp` — JSON-RPC endpoint supporting the same core tool methods

Supported JSON-RPC methods:

- `initialize`
- `tools/list`
- `resources/list`
- `resources/read`
- `tools/call`

Supported tools:

- `create_quiz`
- `submit_answers`
- `inspect_quiz`

### 2. HTTP smoke test

`scripts/smoke-http.mjs` starts the HTTP server on a random local port, then checks:

- health endpoint
- well-known manifest
- JSON-RPC initialize
- tool listing
- widget resource reading
- create_quiz
- submit_answers
- returned SubmissionCapsule shape

Run:

```bash
npm run smoke:http
```

### 3. Deployment files

Added:

- `Dockerfile`
- `.dockerignore`
- `deploy/render.yaml`
- `deploy/fly.toml`

These are starter deployment configs, not a promise that a platform account is already configured.

## Commands

Install:

```bash
npm install --no-audit --no-fund
```

Run all checks:

```bash
npm run verify
```

Run the app locally:

```bash
npm run dev
```

Build production assets:

```bash
npm run build
```

Run production HTTP server locally:

```bash
npm run serve:prod
```

Then visit:

```text
http://127.0.0.1:8787/
http://127.0.0.1:8787/healthz
http://127.0.0.1:8787/.well-known/betterquizzer.json
```

## Deployment sequence

1. Run `npm run verify` locally.
2. Deploy with Docker or a Node web-service host.
3. Confirm `/healthz` returns `ok: true`.
4. Confirm `/.well-known/betterquizzer.json` lists the MCP endpoint.
5. Configure the real MCP/App host to point at the hosted MCP endpoint when available.
6. Test a full flow:
   - create quiz
   - render widget resource
   - answer quiz
   - submit answers
   - LLM grades the SubmissionCapsule

## Design note

Stage 11.1 still keeps BetterQuizzes intentionally neutral:

- BetterQuizzes collects inputs.
- BetterQuizzes tracks confidence.
- BetterQuizzes packages a SubmissionCapsule.
- The LLM grades, explains, and teaches.

That keeps the app flexible across subjects and question types.
