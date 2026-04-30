# Stage 11.9: Model Instruction Hardening

Stage 11.9 makes the connector much clearer for the AI model. The goal is to prevent a fresh chat from getting lost, thinking too long, outputting raw JSON, recreating quizzes during grading, or mishandling confidence/blank answers.

## Model flow

1. Call `create_quiz` once with a complete QuizSpec v2.
2. Stop and let the user answer in the widget.
3. After submission, grade from the `SubmissionCapsule` returned by `submit_answers`.
4. Do not call `create_quiz` again while grading.

## Quiz creation rules

- `multiple_choice` and `multi_select` need non-empty `choices` arrays.
- `matching` needs `left` and `right` arrays.
- `ordering` needs an `items` array.
- If unsure, use `fill_blank`, `short_answer`, or `long_response`.
- Include answer keys when `includeAnswerKeyInSubmission` is true.

## Grading rules

- Use the SubmissionCapsule as the source of truth.
- Use `answerKey` if present.
- Do not penalize blank non-required questions unless the activity instructions say to.
- Confidence is 1=low, 2=medium, 3=high, and only a weak signal.
- `response.kind=other` should be graded semantically.
