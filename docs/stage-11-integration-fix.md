# Stage 11.1: ChatGPT Integration Fix

Stage 11.1 fixes the first real ChatGPT connector trial issues:

- `create_quiz` worked, but the embedded widget sometimes opened the standalone sample menu instead of the created quiz.
- The widget could show stale state from an earlier quiz.
- `submit_answers` was treated as app-private, so the model side could not reliably receive the SubmissionCapsule.

## Fixes

1. `create_quiz` now includes the full QuizSpec in both `structuredContent` and `_meta`.
2. Widget HTML now receives a server-bootstrap fallback payload for the most recently created quiz.
3. The React widget searches bridge metadata, tool output, tool input, widget state, and server bootstrap data for a QuizSpec.
4. Embedded mode no longer falls back to the standalone sample/import screen. If no payload arrives, it shows a visible hydration error.
5. Quiz changes remount the runner by quiz ID, clearing stale draft state.
6. The question card now shows `Question X / Y`, making hydration bugs easier to see.
7. `submit_answers` is model/app visible and remains widget-accessible.
8. Widget submission now sends the full SubmissionCapsule as a fallback in addition to quizId/sessionId/answers.
9. The server can accept a fallback SubmissionCapsule if the in-memory quiz cannot be found.

## Test target

After connecting the updated app to ChatGPT, this should happen:

1. ChatGPT calls `create_quiz`.
2. The widget opens directly to the generated quiz, not the sample menu.
3. The widget shows all generated questions.
4. The user submits answers and confidence.
5. `submit_answers` returns a `betterquizzer.submission` capsule to the model.
6. The model grades, explains, and gives follow-up review.
