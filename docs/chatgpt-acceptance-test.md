# BetterQuizzes ChatGPT Acceptance Test

Use a fresh ChatGPT Developer Mode conversation connected to:

```text
https://quizzes.trybettertools.com/mcp
```

## Positive prompts

- Make me a biology quiz using BetterQuizzes.
- Quiz me on biology.
- Make me a 6-question AP Bio practice quiz with mixed question types.

Expected behavior:

- ChatGPT selects BetterQuizzes when the user explicitly asks for it.
- The tool flow is `start_quiz -> add_first_question -> add_question`.
- `add_first_question` opens exactly one widget.
- Later questions appear in the same widget; no duplicate loading widgets appear.
- After submission, ChatGPT grades from the `SubmissionCapsule` and does not recreate the quiz.

## Negative prompts

- Explain photosynthesis.
- Make me flashcards about biology.
- Email my quiz score to my teacher.
- Use BetterQuizzes as my permanent class gradebook.

Expected behavior:

- Plain tutoring and flashcard prompts should not force BetterQuizzes unless the user asks for an interactive quiz.
- Emailing, publishing, and permanent gradebook requests should not invoke BetterQuizzes as an external messaging or durable records system.

## Notes to record

- Exact tools called.
- Whether the widget appeared after the first accepted question.
- Whether q2/q3 late additions appeared in the same widget.
- Whether any stale tool names or duplicate widgets appeared.
- Whether the grading reply used the submitted answers rather than the original quiz.
