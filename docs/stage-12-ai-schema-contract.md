# Stage 12: AI-Facing Schema Contract

Stage 12 keeps the AI-facing contract aligned with the staged BetterQuizzes creation flow. Normal assistant-authored quizzes are built with draft-only `start_quiz`, rendered by one `add_first_question` launch packet, and then stored continuously by one storage-only `add_question` call per later question. If a stale ChatGPT session has not refreshed the `add_first_question` tool yet, the first `add_question` call is accepted as a compatibility launch instead of dead-ending the draft. `open_quiz` remains an idempotent recovery/reopen tool for staged drafts and stored quizzes, not the normal first-question launch path. `create_quiz` remains a compact legacy compatibility opener for complete user-supplied quiz packets, not the normal authoring path.

## Included

- Compact create_quiz.inputSchema for complete legacy quiz packets instead of the full nested QuizSpec v2 schema.
- Discriminated question schemas for supported question types.
- Short compatibility-only create_quiz description so model guidance does not compete with the builder flow.
- Draft-only start_quiz metadata; it does not advertise a widget output template before a renderable question exists.
- Machine-readable builder capabilities from start/add/repair responses, including supported question types and the canonical workflow.
- `add_first_question` validates renderer compatibility before storing the first question and returns a sealed widget launch packet. A first `add_question` call can also launch only as a stale-session compatibility path. Later `add_question` calls update the stored revision only and intentionally do not advertise widget metadata. Unsupported types such as `multiple_select` are rejected immediately with repair guidance; use `multi_select` for multiple-answer questions.
- Continuous draft storage after accepted `add_question` calls, including `quizId` and monotonic `quizRevision`.
- Read-only, non-destructive, non-open-world, idempotent `open_quiz` metadata with no required recovery arguments.
- Normalization for common aliases: options -> choices, stem/question/text -> prompt, correctAnswer/answerKey -> answer, object choices -> text choices.
- Server validation rejects quizzes the renderer cannot display.
- Widget launch tools return renderDiagnostics, renderableQuestionCount, unrenderableQuestions, warnings, normalizations, safeToPresentToUser, launchStatus, and the normalized quiz object.
- inspect_quiz returns render diagnostics too.
