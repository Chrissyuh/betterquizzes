# Stage 12: AI-Facing Schema Contract

Stage 12 fixes the main AI-side reliability issue: create_quiz now exposes the exact nested QuizSpec v2 schema the widget can render.

## Included

- Complete create_quiz.inputSchema instead of quiz: object / any.
- Discriminated question schemas for supported question types.
- Canonical example embedded in the tool description.
- Normalization for common aliases: options -> choices, stem/question/text -> prompt, correctAnswer/answerKey -> answer, object choices -> text choices.
- Server validation rejects quizzes the renderer cannot display.
- create_quiz returns renderDiagnostics, renderableQuestionCount, unrenderableQuestions, warnings, and the normalized quiz object.
- inspect_quiz returns render diagnostics too.
