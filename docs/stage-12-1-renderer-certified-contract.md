# Stage 12.1 Renderer-Certified Schema Contract

Stage 12.1 tightens the AI-facing contract so server validation, model-visible schema, and widget rendering share the same assumptions.

## Main changes

- Canonical activity policy names are now `allowSkipQuiz`, `allowSkipQuestions`, `defaultAnswerRequired`, and `submitRequiresRequiredAnswers`. Legacy aliases are accepted but normalized.
- `create_quiz` returns `renderDiagnostics` with `rendererCertified`, `componentByQuestion`, and `normalizedFields`.
- Each advertised question type has renderer-facing checks. A quiz should not be reported as fully renderable unless the widget has a component for every question.
- The tool description includes answer-shape guidance for every supported type.
- The model is told to use safe-mode question types (`multiple_choice`, `fill_blank`, `short_answer`) unless the user requests a broader format.

## Canonical answer shapes

- `multiple_choice`: `answer` is a zero-based choice index.
- `multi_select`: `answer` is an array of zero-based choice indexes.
- `true_false`: `answer` is boolean.
- `numeric`: `answer` is number, optional `tolerance`.
- `fill_blank`: `answer` is string or string array, optional `acceptableAnswers`.
- `short_answer`: `answer` is string or string array, optional `acceptableAnswers` or `expectedKeywords`.
- `ordering`: `items` are `{ id, text }`; `answer` is ordered item ids.
- `matching`: `left` and `right` are `{ id, text }`; `answer` is `[{ leftId, rightId }]`.
