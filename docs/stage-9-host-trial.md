# Stage 11.1: Real Host Trial

Stage 11.1 turns BetterQuizzes from a real-host-ready package into a repeatable host-trial package.

The goal is not to add quiz features. The goal is to make it easy to prove this flow against a local server, a public HTTPS deployment, or a compatible connector host:

```text
LLM/tool host calls create_quiz
→ BetterQuizzes widget is hydrated with the QuizSpec
→ user answers questions and confidence ratings
→ widget/server returns a SubmissionCapsule
→ LLM grades, explains, and teaches
```

## What Stage 11.1 adds

- `trial:local`: starts a production server on a temporary local port, runs the full MCP/App host trial, and writes a report.
- `trial:public`: runs the same trial against `PUBLIC_BASE_URL` / `PUBLIC_ORIGIN` and requires HTTPS.
- `trial:probe`: runs the trial against `TRIAL_BASE_URL`, useful for any custom deployment.
- `trial:doctor`: validates that the package is ready for host trial work.
- `trial-reports/`: generated Markdown and JSON evidence from the trial.

## Local trial

Run:

```bash
npm run build
npm run trial:local
```

This checks:

- `/healthz`
- `/.well-known/mcp-app.json`
- `/connector-card.json`
- `/mcp initialize`
- `/mcp ping`
- `/mcp tools/list`
- `/mcp resources/list`
- `/mcp resources/read`
- `tools/call create_quiz`
- `tools/call inspect_quiz`
- `tools/call submit_answers`

It writes a report into `trial-reports/`.

## Public HTTPS trial

After deploying BetterQuizzes or exposing it with an HTTPS tunnel:

```bat
set PUBLIC_BASE_URL=https://YOUR-PUBLIC-HOST
npm run trial:public
```

Or with the older command name:

```bat
set PUBLIC_BASE_URL=https://YOUR-PUBLIC-HOST
npm run host:public:strict
```

The public test verifies that manifests and connector cards use the public HTTPS origin, not a localhost URL.

## Custom target trial

Use `TRIAL_BASE_URL` when you want to test a host without changing the public connector environment:

```bat
set TRIAL_BASE_URL=https://YOUR-PUBLIC-HOST
npm run trial:probe
```

## Manual connector trial checklist

After `trial:public` passes, test with a real compatible host/dev environment:

1. Use connector URL: `https://YOUR-PUBLIC-HOST/mcp`.
2. Ask the host/LLM to create a small quiz with `create_quiz`.
3. Confirm the BetterQuizzes widget appears.
4. Answer every question and set confidence.
5. Submit answers.
6. Confirm the model receives a `betterquizzer.submission` object.
7. Ask the model to grade, explain missed items, and generate follow-up practice.

## What success means

Stage 11.1 success means BetterQuizzes has repeatable evidence that the hosted MCP/App path works up to the connector boundary.

It does not mean BetterQuizzes is submitted as a public app or migrated to the official SDK implementation yet.
