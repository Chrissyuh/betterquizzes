#!/usr/bin/env node
// Canonical stdio compatibility entrypoint.
//
// The old SDK stdio prototype drifted from the deployed HTTP/stdout contract
// and could advertise stale creation tools. Keep this path as a stable command
// alias, but route it through the same BetterQuizzes stdio server used by
// mcp:stdio so every entrypoint exposes the add_first_question launch
// contract.
import "./betterquizzes-app-server.mjs";
