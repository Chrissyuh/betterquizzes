# Stage 11.9: Widget Hydration Lockdown

Stage 11.9 fixes the real ChatGPT connector issue where the embedded UI could fall back to the standalone sample menu instead of opening the quiz created by `create_quiz`.

## Fixes

- The MCP widget resource now forces widget mode with `window.__BETTERQUIZZER_FORCE_WIDGET__ = true`.
- Widget mode never shows the sample/import menu.
- If host metadata is missing, the widget fetches the latest created quiz from the BetterQuizzes server.
- The server exposes:
  - `GET /api/quizzes`
  - `GET /api/quiz/latest`
  - `GET /api/quiz/:quizId`
- Built-in sample quizzes are preloaded into the server map, so sample submissions such as `tiny-demo-v2` no longer fail with “No stored quiz.”
- `submit_answers` can use `submission.answers` if the host drops the top-level `answers` field.
- The widget CSP now allows the configured public origin so server fallback fetches can work inside the embedded app.

## Expected embedded behavior

If BetterQuizzes is opened as a ChatGPT widget:

1. Try host-provided quiz metadata.
2. Try server bootstrap payload.
3. Try `GET /api/quiz/latest` or `GET /api/quiz/:quizId`.
4. Show an explicit hydration/loading error if all hydration paths fail.
5. Never show standalone sample sets.

## Test focus

After deploying this version, create a quiz from ChatGPT and verify:

- The widget opens directly to the quiz.
- The sample menu does not appear inside ChatGPT.
- All questions are visible through navigation.
- Submitting answers ends the UI flow instead of hanging.
- If a sample quiz is completed, the server can still build a SubmissionCapsule.
