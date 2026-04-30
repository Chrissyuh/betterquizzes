# Stage 11.1: Official SDK Migration

Stage 11.1 moves BetterQuizzes from a purely handmade MCP-style prototype toward an official SDK-backed foundation while preserving the Stage 9 working host-trial path.

## Goal

Keep the product behavior stable:

```text
LLM creates QuizSpec
→ BetterQuizzes widget opens
→ user answers + confidence + timing
→ BetterQuizzes returns SubmissionCapsule
→ LLM grades, explains, and teaches
```

Improve the implementation foundation:

```text
Official SDK dependencies added
Official SDK stdio entrypoint added
Zod schemas used for SDK tool inputs
MCP Apps widget metadata preserved
Proven HTTP /mcp server kept as deployment path
Stage 9 host-trial reports kept
```

## Why not rip out the HTTP server yet?

The Stage 9 handmade HTTP server already passes:

- HTTP smoke tests
- MCP/App contract tests
- host-readiness checks
- local host-trial reports

Replacing it all at once would risk breaking the deployable path before the real host connection test. Stage 11.1 therefore uses a safer migration pattern:

1. Add the official SDK dependencies.
2. Add an SDK-based stdio server.
3. Keep the proven HTTP server unchanged except for Stage 11.1 metadata.
4. Add SDK dependency/alignment tests.
5. Move HTTP transport to the official SDK only after a real host demands it or after the stdio SDK path proves stable.

## New SDK entrypoint

```bash
npm run mcp:sdk:stdio
```

This starts `mcp/sdk-stdio-server.mjs`, which uses:

- `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`
- `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`
- `zod` input schemas

It registers the same core primitives:

- `create_quiz`
- `submit_answers`
- `inspect_quiz`
- `ui://widget/betterquizzer-stage11.html`

## New Stage 11.1 checks

```bash
npm run sdk:dependencies
npm run sdk:alignment
```

`npm run verify` now includes both checks.

## Completion standard

Stage 11.1 is complete when:

```text
npm install --no-audit --no-fund
npm run verify
npm run mcp:sdk:stdio     # starts without import errors after build
npm run trial:local
```

## Stage 11 target

Stage 11 should be a real compatible-host connection trial. If the host refuses the current HTTP transport shape, migrate `mcp/remote-server.mjs` to an official `StreamableHTTPServerTransport` implementation.
