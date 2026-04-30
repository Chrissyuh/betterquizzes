# Stage 11.9: Widget Stability + Cache Busting

Stage 11.9 fixes the blank/white widget failure mode seen during real ChatGPT testing.

## Changes

- Versioned widget resource URI: `ui://widget/betterquizzer-stage12.html`
- Visible widget version label: `v12.0`
- Error boundary around the React app
- Non-blank fallback HTML before React mounts
- Global error and unhandled-rejection fallback UI
- `Cache-Control: no-store` headers in the HTTP server
- Reduced widget state size after submission by storing a summarized host result instead of the full duplicated tool response
- Submit flow now moves to the stable submission screen before attempting follow-up messaging
- Manual `Ask ChatGPT to grade` button on the submission screen
- Quiz-level `choiceBehavior` now applies to multiple-choice and multi-select questions unless overridden per question

## Why

The server/tool path was working, but ChatGPT could still show a blank embedded UI when an old widget bundle was cached or when the frontend hit an error. This stage makes the widget visibly versioned and fail-visible instead of blank.

## Test commands

```bash
npm run typecheck
npm run test
npm run build
npm run mcp:demo
npm run smoke:http
npm run contract:test
npm run host:readiness
npm run trial:local
npm run sdk:alignment
```
