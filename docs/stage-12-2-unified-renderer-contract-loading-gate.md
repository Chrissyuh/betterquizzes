# Stage 12.2: Unified Renderer Contract + Loading Gate

This patch applies the Stage 12.2 behavior on top of the Stage 12.1 renderer-certified package.

## What changed

1. **Loading gate for widget launches**
   - Widget mode now starts on `loading` unless the current launch already contains a certified quiz payload.
   - The widget shows `Loading quiz…` while waiting for the current tool-result payload.
   - The widget no longer auto-fetches `/api/quiz/latest` as a launch fallback.

2. **No stale bootstrap quiz**
   - `buildWidgetBootstrap()` now injects only:
     - `status: "loading"`
     - `widgetVersion`
     - `serverBase`
   - It does not inject `lastQuiz`.

3. **Safer host hydration**
   - Hydration prefers the current normalized output surfaces:
     - `toolResponseMetadata.quiz`
     - `toolOutput.structuredContent.quiz`
     - `toolOutput.quiz`
   - `widgetState` is not used as a quiz launch source.
   - `toolInput.quiz` is only accepted if explicitly marked normalized/certified.

4. **Shared render contract source**
   - Added `src/shared/renderContract.ts` with:
     - `normalizeQuizForRender()`
     - `prepareQuizForRender()`
     - `validateRenderableQuiz()`
     - `getRenderDiagnostics()`
   - The frontend calls the render contract before committing a quiz to state.

5. **Renderer crash guards**
   - Replaced unsafe `question.type.replaceAll("_", " ")` with `formatQuestionType(question.type)`.
   - Added a default unsupported-question renderer warning.
   - Choice rendering now accepts both string choices and object choices such as `{ "id": "A", "text": "Mars" }`.

6. **Prebuilt bundle patch**
   - Because dependencies were unavailable in this environment, the checked-in `dist/assets/index-XinejuK9.js` bundle was patched directly with the same loading-gate, hydration-order, and renderer-safety behavior.

## Verification run

- `node --check dist/assets/index-XinejuK9.js`
- `node scripts/test-shared.mjs`
- `node scripts/contract-test.mjs`

`npm run typecheck` / `npm run build` require installing the project dependencies. Dependency installation was not completed in this environment, so those checks should be rerun after `npm ci` in a normal dev environment.
