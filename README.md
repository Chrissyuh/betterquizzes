# BetterQuizzes V1

## Brand naming note

The public app/brand name is **BetterQuizzes**. The internal schema strings such as `betterquizzer.quiz`, `betterquizzer.launch`, and `betterquizzer.submission` are intentionally preserved for compatibility with existing saved quizzes, widget state, and regression tests.

BetterQuizzes is an MCP-powered quiz widget. For assistant-authored quizzes, the model builds a draft with `start_quiz`, adds the first question with `add_first_question`, and that accepted first question launches exactly one widget. If a stale ChatGPT session has not refreshed the `add_first_question` tool yet, the first `add_question` call is accepted as a compatibility launch. Later accepted questions use storage-only `add_question`, so they fade into the same widget while it polls for new revisions without opening duplicate widgets. The widget collects answers, confidence, timing, completion state, and submission state, then returns a `SubmissionCapsule` for ChatGPT to grade.

## V1 focus

V1 is the public release package for BetterQuizzes. It includes the latest polish work: model guidance, one-question quiz layout, title/prompt formatting, loading recovery, and broad question-type coverage.

Included in this package:

- submitted quiz restore behavior
- ordering questions count as complete only after the user opens the ordering question
- confidence stays locked until all required parts of a question are complete
- confidence buttons are compact, side-by-side, and grey until the current question is actually complete
- single-select multiple-choice keeps A/B/C/D letter badges, while multi-select uses checkbox-style markers
- the `Question X of Y` label is removed
- layout/progress bars use the full available width instead of leaving a dead right margin
- loading now shows animated progress/status feedback before the quiz packet arrives
- stable text boxes without side-resize scrollbar flicker
- formatting controls for bold, italic, underline, subscript, and superscript appear below single text boxes
- multi-part writing inputs no longer show formatting controls
- drag-and-drop ordering works from a right-side handle instead of a busy top/left handle
- `multi_write_vertical` question type
- `text_select` question type with selectable words embedded inline inside the passage
- launch packet question-count/progress metadata
- numeric input accepts decimals and fractions while typing

## Windows quick start

```bat
cd %USERPROFILE%\Downloads\betterquizzes-v1-final-proposal-fix
npm install --no-audit --no-fund
npm run build
set PUBLIC_BASE_URL=https://energize-service-spruce.ngrok-free.dev
npm run serve:prod
```

Open locally:

```text
http://127.0.0.1:8787/
http://127.0.0.1:8787/healthz
http://127.0.0.1:8787/.well-known/mcp-app.json
http://127.0.0.1:8787/connector-card.json
```

## Useful commands

```bat
npm run build
npm run serve:prod
npm run v1:regression
npm run contract:test
npm run host:readiness
npm run host:contract:strict
npm run submission:readiness
```

`submission:readiness` is a final release gate. It should fail until `https://app.betterquizzes.com` resolves, the hosted manifest advertises that domain, and the legal pages use a real support email instead of the placeholder.

## Core flow

```text
start_quiz
  -> add_first_question for the first question
     (or first add_question only for stale sessions missing add_first_question)
  -> opens BetterQuizzes widget
add_question
  -> stores later questions while the widget polls
  -> user answers
submit_answers
  -> returns SubmissionCapsule
  -> ChatGPT grades and teaches
```

## Main files

```text
src/App.tsx
src/shared/types.ts
src/shared/schemas.ts
src/shared/renderContract.ts
src/shared/submission.ts
src/host/openaiBridge.ts
mcp/remote-server.mjs
```
