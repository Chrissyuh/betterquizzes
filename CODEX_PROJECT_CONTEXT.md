\# BetterQuizzes Codex Project Context



You are working on BetterQuizzes, a ChatGPT app / MCP app that turns model-generated quiz packets into an interactive quiz-taking experience.



This is a real software repository, not a normal ChatGPT paste-code chat. Work like a careful engineer inside the repo.



\## Operating Model



Use this division of labor:



\- ChatGPT chat: planning, product decisions, explaining bugs, writing specs/prompts.

\- Codex: reading the repo, editing code, running tests, producing commits/PRs.

\- GitHub: source of truth for the codebase.

\- Render: deployment target. Render auto-deploys after commits/merges to the deployed branch.



Preferred workflow:



1\. Work on a branch for risky changes.

2\. Inspect the current code before editing.

3\. Identify the specific function/component/file causing the issue.

4\. Make the smallest direct code change that solves the actual bug.

5\. Run validation before calling the change ready.

6\. Commit only after validation passes.

7\. Merge/push to main only when ready for Render auto-deploy.

8\. Use Render as the final integration test, not the first test.

9\. After deployment, manually test web, ChatGPT desktop, iOS, and Android where relevant.



\## Hard Rules



1\. Do not generate giant patch scripts unless explicitly asked.

2\. Do not patch patched patches.

3\. Do not use broad regex rewrites across large files unless there is no safer option.

4\. Do not edit unrelated systems while fixing a specific bug.

5\. Do not “fix” tests by weakening them unless the tested behavior has actually changed intentionally.

6\. Do not claim a bug is fixed until the relevant tests pass.

7\. Do not push directly to main for risky changes.

8\. Preserve working behavior unless the task explicitly says to remove it.

9\. Prefer direct, readable edits in the actual source files.

10\. Explain what you changed, why, and what validation you ran.



\## Project Summary



BetterQuizzes is an interactive quiz app for ChatGPT.



It receives structured quiz data from MCP tools / ChatGPT tool calls, renders the quiz in a widget/web UI, captures answers, preserves draft/submission state, supports multiple question types, and can send a grade/submission packet back to the model.



The app should feel like a polished educational product, not a generic AI-generated webpage.



\## Current Main Goals



1\. Make quiz rendering reliable inside ChatGPT.

2\. Keep the website version working, including `/privacy` and `/terms`.

3\. Keep the ChatGPT widget version clean and focused.

4\. Support a wide variety of question types.

5\. Make ordering questions work extremely well.

6\. Make model-facing tool instructions so clear that ChatGPT reliably generates valid quiz packets.

7\. Keep deployment through Render reliable.

8\. Keep GitHub as the source of truth.



\## Supported / Important Question Types



Inspect the current schemas and renderer before assuming exact details, but the project includes or has included support for:



\- multiple choice

\- multi-select

\- matching

\- ordering

\- numeric

\- fill blank

\- short answer

\- long answer

\- multi-write vertical

\- text-select

\- other related structured quiz formats



\## Key Files To Understand Before Editing



Always inspect relevant files before making changes.



Core UI:



\- `src/App.tsx`

\- `src/styles.css`



Host / ChatGPT bridge:



\- `src/host/openaiBridge.ts`



Shared logic:



\- `src/shared/types.ts`

\- `src/shared/schemas.ts`

\- `src/shared/renderContract.ts`

\- `src/shared/submission.ts`

\- `src/shared/compactSubmission.ts`

\- `src/shared/version.ts`



Examples:



\- `src/shared/examples/`

\- `public/examples/`

\- `dist/examples/`



MCP / app servers:



\- `mcp/remote-server.mjs`

\- `mcp/betterquizzes-app-server.mjs`

\- `mcp/betterquizzer-app-server.mjs`

\- `mcp/sdk-stdio-server.mjs`



Validation scripts:



\- `scripts/test-shared.mjs`

\- `scripts/contract-test.mjs`

\- `scripts/v1-regression.mjs`

\- `scripts/host-readiness.mjs`

\- `scripts/host-trial-doctor.mjs`

\- `scripts/sdk-alignment-test.mjs`

\- `scripts/deploy-package-check.mjs`



Deployment:



\- `deploy/render.yaml`

\- `deploy/fly.toml`

\- `Dockerfile`

\- `.env.example`



\## Validation Commands



Before declaring a code change ready, run the relevant validation. For most meaningful changes, run the full set:



```bash

npm run typecheck

npm run build



node --check mcp/remote-server.mjs

node --check mcp/betterquizzes-app-server.mjs

node --check mcp/betterquizzer-app-server.mjs

node --check mcp/sdk-stdio-server.mjs



node scripts/test-shared.mjs

node scripts/contract-test.mjs

node scripts/v1-regression.mjs

node scripts/host-readiness.mjs

node scripts/host-trial-doctor.mjs

node scripts/sdk-alignment-test.mjs

node scripts/deploy-package-check.mjs

