# Official SDK Decision, Stage 11.1

## Decision

Stage 11.1 adopts a hybrid migration:

- Add official MCP SDK dependencies.
- Keep `mcp:sdk:stdio` as a compatibility command, but route it through the canonical BetterQuizzes stdio server so it cannot advertise a stale tool contract.
- Keep the proven handwritten HTTP `/mcp` server for deployment and host-trial testing.
- Keep `QuizSpec` and `SubmissionCapsule` unchanged.

## Rationale

The current HTTP server is small, understandable, and already passes the project’s contract tests. A full HTTP transport rewrite before real host testing would introduce risk without yet proving compatibility gains.

The SDK migration therefore starts where the risk is lowest: local stdio. This confirms the tool/resource model, Zod inputs, and widget metadata can live in official SDK patterns without destabilizing the deployable host package.

## SDK pieces now present

- `@modelcontextprotocol/sdk`
- `@modelcontextprotocol/ext-apps`
- `zod`
- `mcp/sdk-stdio-server.mjs`
- `scripts/sdk-dependency-check.mjs`
- `scripts/sdk-alignment-test.mjs`

## Keep stable

Do not change these in Stage 11.1:

- `QuizSpec` v2
- `SubmissionCapsule` v2
- neutral LLM-grades-after-submission product model
- Stage 9 host-trial scripts
- public HTTPS trial commands

## Migration trigger for HTTP

Migrate the HTTP server to official Streamable HTTP if any of these happen:

1. A real host rejects the current `/mcp` endpoint.
2. The official SDK’s HTTP transport becomes clearly easier to deploy than the current server.
3. Authentication, sessions, or protocol version negotiation become too complex for the handmade path.

## Next stage

Stage 11 should connect the hosted endpoint to a real host/dev environment and capture exact compatibility errors if any.
