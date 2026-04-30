# Stage 11.9: Submission Validation + UX Hardening

Stage 11.9 hardens the end-to-end ChatGPT widget flow after Stage 11.5 proved that the `SubmissionCapsule` can reach the model.

## Main fixes

- Builds one `SubmissionCapsule` and uses it as the single source of truth for widget state, host tool calls, and follow-up prompts.
- Adds `completion` to every submission:
  - required/optional counts
  - missing required question IDs
  - missing confidence IDs
  - `isComplete`
- Blocks final submit when `submitRequiresAllRequired` is true and required answers/confidence are missing.
- Shows a small disabled-submit explanation instead of only greying out the button.
- Adds a submission status timeline: saved locally, sent to BetterQuizzes, follow-up status.
- Adds a debug toggle for the full capsule JSON instead of always showing it.
- Keeps `submit_answers` UI-free so only `create_quiz` opens the widget.
- Clarifies confidence scale for the LLM: `1=low`, `2=medium`, `3=high`.
- Clarifies special answer handling:
  - `{ kind: "unsure" }` should be treated as unanswered but useful for confidence analysis.
  - `{ kind: "other", text }` should be graded semantically.

## Run

```bash
npm install --no-audit --no-fund
npm run build
set PUBLIC_BASE_URL=https://YOUR-NGROK-URL
npm run serve:prod
```

## Verify

```bash
npm run typecheck
npm run test
npm run build
npm run mcp:demo
npm run smoke:http
npm run contract:test
npm run host:readiness
npm run trial:local
npm run sdk:alignment
```

All of those checks passed during packaging.
