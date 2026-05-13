# Stage 12: AI-Facing Schema Contract

Stage 12 keeps the AI-facing contract aligned with the staged BetterQuizzes creation flow. Normal assistant-authored quizzes are built with `start_quiz`, stored continuously by one `add_question` call per question, and rendered by calling `open_quiz` immediately after the first accepted `add_question`. `open_quiz` is the read-only render tool for staged drafts and stored quizzes. `create_quiz` remains a compact legacy compatibility opener for complete user-supplied quiz packets, not the normal authoring path.

## Included

- Compact create_quiz.inputSchema for complete legacy quiz packets instead of the full nested QuizSpec v2 schema.
- Discriminated question schemas for supported question types.
- Short compatibility-only create_quiz description so model guidance does not compete with the builder flow.
- Continuous draft storage after accepted `add_question` calls, including `quizId` and monotonic `quizRevision`.
- Read-only, non-destructive, non-open-world, idempotent `open_quiz` metadata with no required launch arguments.
- Normalization for common aliases: options -> choices, stem/question/text -> prompt, correctAnswer/answerKey -> answer, object choices -> text choices.
- Server validation rejects quizzes the renderer cannot display.
- Widget launch tools return renderDiagnostics, renderableQuestionCount, unrenderableQuestions, warnings, and the normalized quiz object.
- inspect_quiz returns render diagnostics too.
