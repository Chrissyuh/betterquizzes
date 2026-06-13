# BetterQuizzes ChatGPT Acceptance Test

Use a fresh ChatGPT Developer Mode conversation connected to:

```text
https://quizzes.trybettertools.com/mcp
```

## Positive prompts

- Make me a 4-question biology quiz using BetterQuizzes. Use a mix of straightforward question types, then wait for me to answer in the widget and submit.
- Use BetterQuizzes to make a 4-question basic algebra practice quiz. Use multiple-choice, true/false, fill-in, and numeric questions. Then wait for me to answer and submit.
- Quiz me on Texas traffic signs using BetterQuizzes. Make 5 questions, then wait for me to answer in the widget and submit.
- Use BetterQuizzes to make a 2-question biology ordering quiz. One question should order mitosis phases, and one should order levels of biological organization from smallest to largest.
- Make me a 3-question BetterQuizzes vocabulary check about genetics. Include one matching question, one multi-select question, and one short-answer question.

Expected behavior:

- ChatGPT selects BetterQuizzes when the user explicitly asks for it.
- The tool flow is `start_quiz -> add_first_question -> add_question`.
- `add_first_question` opens exactly one widget.
- ChatGPT does not ask for extra permission to create the first question or later questions after the user requested the quiz.
- Later questions appear in the same widget; no duplicate loading widgets appear.
- After the reviewer answers and submits the widget, ChatGPT receives `submit_answers`, grades from the `SubmissionCapsule`, calls `record_grade`, and does not recreate the quiz. `record_grade.items` should use `questionId` plus `mark`/`status` values of `correct`, `incorrect`, `partially_correct`, or `needs_review`; include feedback mainly for incorrect, partial, or needs-review questions so review mode can highlight them.
- Run each positive prompt in a fresh web chat and at least one on mobile before resubmission.

## Negative prompts

- Explain photosynthesis to me in simple terms. Do not make a quiz.
- Make me flashcards about biology.
- Email my quiz score to my teacher.
- Use BetterQuizzes as my permanent class gradebook.
- Make a lesson plan about biology.

Expected behavior:

- Plain tutoring and flashcard prompts should not force BetterQuizzes unless the user asks for an interactive quiz.
- Emailing, publishing, and permanent gradebook requests should not invoke BetterQuizzes as an external messaging or durable records system.

## Notes to record

- Exact tools called.
- Whether the widget appeared after the first accepted question.
- Whether q2/q3 late additions appeared in the same widget.
- Whether any stale tool names or duplicate widgets appeared.
- Whether the grading reply used the submitted answers rather than the original quiz.
- Whether the same submitted test case passes on both ChatGPT web and mobile.
