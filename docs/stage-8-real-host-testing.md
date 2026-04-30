# Stage 11.1: Real HTTPS Host Testing

Stage 11.1 turns BetterQuizzes from host-ready into real-host-test-ready.

The key goal is to make one deployable server produce everything a connector/app host needs:

- the web app at `/`
- health check at `/healthz`
- MCP endpoint at `/mcp`
- app manifest at `/.well-known/mcp-app.json`
- connector helper at `/connector-card.json`
- inspector metadata at `/mcp-inspector.json`

## Local verification

```bash
npm install --no-audit --no-fund
npm run verify
```

## Local production server

```bash
npm run build
npm run serve:prod
```

Open:

- `http://127.0.0.1:8787/`
- `http://127.0.0.1:8787/healthz`
- `http://127.0.0.1:8787/.well-known/mcp-app.json`
- `http://127.0.0.1:8787/connector-card.json`

## HTTPS tunnel workflow

ChatGPT-style connector testing requires a public HTTPS `/mcp` endpoint. For local development, expose the production server through an HTTPS tunnel.

Terminal 1:

```bash
npm run build
npm run serve:prod
```

Terminal 2, after your tunnel is running:

```bash
set PUBLIC_BASE_URL=https://YOUR-TUNNEL-HOST
npm run connect:chatgpt
npm run host:public:strict
```

The connector URL is:

```text
https://YOUR-TUNNEL-HOST/mcp
```

## Deployment workflow

For a deployed host, set `PUBLIC_BASE_URL` to the production HTTPS origin.

Example:

```text
PUBLIC_BASE_URL=https://betterquizzer.example.com
```

Then run:

```bash
npm run host:public:strict
```

## What the public host smoke test checks

`npm run host:public:strict` checks:

- `/healthz`
- `/.well-known/mcp-app.json`
- `/connector-card.json`
- `/mcp initialize`
- `/mcp tools/list`
- `/mcp resources/read`
- HTTPS origin correctness
- public manifest endpoint correctness

## Important behavior

BetterQuizzes still stores quiz data only in server memory for this MVP. This means a restart clears stored quizzes. That is intentional for the prototype because it avoids accounts, databases, and durable student records.
