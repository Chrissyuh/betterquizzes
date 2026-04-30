# Stage 11.9: Confidence + Skip Simplification

Stage 11.9 simplifies the answer/confidence model after real ChatGPT widget testing.

## Changes

- Confidence is now a 3-point scale: `1=low`, `2=medium`, `3=high`.
- `guess` and `unsure` were removed from confidence.
- `Unsure` is no longer injected as a special answer option.
- `Other` remains available when the LLM enables it.
- Questions now prefer `answerRequired` over the older `required` flag.
- Blank answers are treated as blank/unanswered. The LLM decides how to interpret them based on activity context.
- Confidence only applies to answered questions.
- The quiz-level button is now labeled `Skip quiz` and remains in the widget header.
- LLM instructions now say to use confidence carefully, as a weak signal rather than proof.

## Recommended schema direction

```json
{
  "activityPolicy": {
    "defaultQuestionRequired": true,
    "submitRequiresAllRequired": true,
    "allowCancel": true
  },
  "displayPolicy": {
    "requireConfidence": true
  },
  "questions": [
    {
      "id": "q1",
      "type": "multiple_choice",
      "prompt": "...",
      "answerRequired": true
    }
  ]
}
```

Older `required` fields still work for backward compatibility.
