# Stage 11.9: Auto-Return and Compact Widget UI

Stage 11.9 focuses on making the ChatGPT embedded flow feel clean after the first successful end-to-end SubmissionCapsule test.

## Goals

- `create_quiz` opens the BetterQuizzes widget.
- `submit_answers` returns structured data only and does not reopen the widget UI.
- The widget saves the final SubmissionCapsule before any host call.
- The widget attempts a follow-up model message after submit so ChatGPT can continue grading without the user reprompting.
- The quiz UI is shorter and less visually noisy for a one-question-at-a-time embedded card.

## UI changes

- Removed the download quiz button from the quiz screen.
- Removed the objective preview panel.
- Removed the question-dot color legend.
- Question number navigation is square instead of wide.
- The status line is compressed to `Confidence required` only when confidence is required.
- Required incomplete questions are shown in a light red state.
- Previous and Next are grouped together, with Previous on the left.
- Submit is disabled until all required questions are complete.
- The confidence subtitle was removed.

## LLM-controlled customization additions

`activityPolicy` lets the LLM control whether the user may cancel, skip questions, and whether unanswered questions block submission.

```json
{
  "activityPolicy": {
    "allowCancel": true,
    "allowSkipQuestions": true,
    "defaultQuestionRequired": true,
    "submitRequiresAllRequired": true
  }
}
```

Per-question `required: false` lets the LLM make individual questions optional.

Multiple-choice and multi-select questions can add extra response affordances:

```json
{
  "id": "q1",
  "type": "multiple_choice",
  "prompt": "Pick the best answer.",
  "choices": ["A", "B", "C", "D"],
  "choiceBehavior": {
    "allowOther": true,
    "otherLabel": "Other..."
  }
}
```

The UI records `Other` responses as structured data, for example:

```json
{ "kind": "other", "text": "My custom answer" }
```

Unanswered questions remain blank rather than using a special `unsure` answer.

## Tool separation

Only `create_quiz` attaches the widget output template. `submit_answers` and `record_submission` remain widget-callable, but no longer attach the widget resource.
