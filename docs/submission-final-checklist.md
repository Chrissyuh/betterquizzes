# BetterQuizzes final submission checklist

Use this checklist immediately before submitting BetterQuizzes for review.

## Submit these values

- MCP server URL: `https://quizzes.trybettertools.com/mcp`
- Display name: `BetterQuizzes`
- Subtitle: `Interactive study quizzes`
- Category: `Education`
- Privacy Policy URL: `https://quizzes.trybettertools.com/privacy`
- Terms URL: `https://quizzes.trybettertools.com/terms`
- Support email: `support@trybettertools.com`
- Description: `BetterQuizzes helps students study with interactive ChatGPT-made quizzes, practice drills, diagnostic checks, and self-tests. It supports varied question types, confidence ratings, structured submissions, and ChatGPT grading feedback.`

## Upload or reference

- `chatgpt-app-submission.json`
- Square app icon from `public/app-icon.png`
- Optional light/dark logos from `public/logo-light.png` and `public/logo-dark.png`
- Screenshots or a short recording that shows quiz launch, answering, submission, and ChatGPT grading

## Manual release blocker

- Confirm `support@trybettertools.com` is a real working inbox that can receive external mail.

## Final checks

```powershell
npm run submission:readiness
$env:PUBLIC_BASE_URL='https://quizzes.trybettertools.com'; npm run host:contract:strict
$env:PUBLIC_BASE_URL='https://quizzes.trybettertools.com'; npm run host:public:strict
npm run verify
```

## Fresh ChatGPT QA

- Prompt: `Make me a biology quiz using BetterQuizzes.`
- Expected tool flow: `start_quiz -> add_first_question -> add_question -> submit_answers -> record_grade`
- Confirm exactly one widget opens.
- Confirm later questions appear in the same widget.
- Confirm the submitted answers produce a `SubmissionCapsule`.
- Confirm ChatGPT grades from the submitted answers and does not recreate the quiz.

Negative controls:

- `Explain photosynthesis.`
- `Make flashcards about biology.`
- `Email my quiz score to my teacher.`
- `Use BetterQuizzes as my permanent class gradebook.`
