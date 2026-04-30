# Stage 5: Native ChatGPT/App Widget Prototype

## Goal

Stage 5 makes BetterQuizzes native-ready. The product can still run as a normal web app, but it now also understands the ChatGPT Apps-style widget environment.

## Architecture

```txt
LLM / ChatGPT host
  ↓ calls create_quiz
MCP app server
  ↓ returns structuredContent + _meta.quiz + UI resource URI
BetterQuizzes iframe widget
  ↓ user answers + confidence
Widget calls submit_answers
  ↓
MCP app server returns SubmissionCapsule
  ↓
LLM grades, explains, and teaches
```

## Key files

```txt
src/host/openaiBridge.ts          Widget bridge wrapper
src/App.tsx                       Standalone + widget-capable quiz UI
mcp/betterquizzer-app-server.mjs  MCP-style app server
mcp/demo-client.mjs               Local stdio demo client
```

## Tool contract

### create_quiz

Input:

```json
{ "quiz": { "schema": "betterquizzer.quiz", "version": 2, "questions": [] } }
```

Output:

- `structuredContent`: small model-visible summary
- `_meta.quiz`: full quiz for the widget
- `_meta.ui.route`: initial UI route

### submit_answers

Input:

```json
{
  "quizId": "demo",
  "sessionId": "session-123",
  "answers": [
    { "questionId": "q1", "response": 2, "confidence": 4 }
  ]
}
```

Output:

- `structuredContent.submission`: full `SubmissionCapsule` for grading
- `_meta.returnPrompt`: ready-to-send follow-up prompt

## Why no explanations in the UI?

The app is intentionally neutral. It should not become a second teacher that conflicts with the LLM. It collects clean structured interaction data and lets the LLM decide how to grade, explain, and follow up.

## Stage 5 limitations

This is a local stdio/server prototype, not a submitted ChatGPT App. The server follows the Apps SDK shape: widget resource, tool metadata, `_meta.ui.resourceUri`, `structuredContent`, and hidden `_meta`. A production app still needs deployment, auth decisions, official connection testing, and submission review.
