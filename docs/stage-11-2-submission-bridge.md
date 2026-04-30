# Stage 11.9: Submission Bridge Fix

Stage 11.9 fixes the second real ChatGPT connector issue: quiz creation and widget hydration worked, but submitting answers could hang because the widget was waiting on a host bridge/tool call that might not be exposed or might never resolve.

## Fixes

- `submit_answers` now uses a stricter JSON schema for `response` instead of an empty schema.
- `record_submission` is exposed as an alias for `submit_answers`.
- The widget time-boxes host tool calls so the submit button cannot spin forever.
- The widget time-boxes `sendFollowUpMessage` fallback calls.
- The widget saves the final `SubmissionCapsule` into widget state before attempting host submission.
- The widget saves final status as `submitted`, `fallback_ready`, or `failed`.
- If automatic handoff fails, the UI still moves to the submission screen and tells the user the capsule is saved.
- Local smoke, contract, and host-trial checks cover the alias and submission path.

## Intended behavior

1. ChatGPT calls `create_quiz`.
2. The BetterQuizzes widget opens directly to the quiz.
3. The user answers and rates confidence.
4. The widget creates a `SubmissionCapsule`.
5. The widget saves the capsule to widget state immediately.
6. The widget attempts `submit_answers` / `record_submission` through the host bridge.
7. If that fails, the widget attempts a follow-up prompt.
8. If that also fails, the widget stops loading and shows a fallback-ready submission screen.

## Why this matters

Even if a host does not expose widget tool calls correctly, BetterQuizzes should never trap the user in an endless submitting state. The answer data must remain recoverable by the LLM or by copy/download fallback.

## Re-test steps

```bat
npm install --no-audit --no-fund
npm run build
npm run smoke:http
npm run contract:test
npm run trial:local
```

For ChatGPT connector testing, restart the server with your public tunnel URL:

```bat
set PUBLIC_BASE_URL=https://YOUR-NGROK-URL
npm run serve:prod
```

Then reconnect/update the ChatGPT connector using:

```txt
https://YOUR-NGROK-URL/mcp
```
