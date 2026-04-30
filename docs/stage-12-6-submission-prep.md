# Stage 12.6: Submission-prep cleanup

Stage 12.6 is the final broad cleanup pass before external publish/submission review.

## Done in this package

- Centralized version/build constants for the web widget.
- Bumped server/app/widget identity to 12.6.2 with a new cache-busted widget URI.
- Removed stale visible version strings from fallback paths.
- Replaced the old retry-loop naming with a one-shot ChatGPT grading handoff.
- Kept grading in ChatGPT only; no local first-pass grading is exposed in the widget.
- Hardened text response limits: AI-set max characters show counters; unlimited fields show none.
- Improved numeric parsing so invalid numeric input does not submit `NaN`.
- Made ordering controls more visible with a clear drag handle and mobile-sized fallback arrows.
- Added mobile-friendly layout rules, larger touch targets, sticky quiz navigation, and sticky submit actions.
- Added build/version diagnostics and issue-report metadata.
- Added Stage 12.6 static regression checks.

## Remaining before public submission

- Move from ngrok/dev tunnel to stable HTTPS hosting with a custom domain.
- Run a full ChatGPT connector reconnect and cache-bust test using the 12.6 resource URI.
- Do repeated live tests for create → answer → submit → ChatGPT grades without freezing.
- Polish drag-and-drop animation and mobile iframe quirks.
- Review final app listing copy, privacy copy, support/contact info, and icon.
- Run accessibility checks on keyboard navigation, screen reader labels, and focus states.
