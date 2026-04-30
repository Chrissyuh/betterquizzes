# BetterQuizzes V1 formatting + numeric completion fix

This patch keeps the public release version as **BetterQuizzes V1** and cache-busts the widget resource with `bqv1p1`.

Fixes:
- Formatting toolbar no longer inserts raw Markdown/HTML tags into typed student answers.
- Formatting buttons transform selected/current-word text using plain Unicode characters instead.
- Numeric questions now count as attempted when the field has text, even if the last character is a symbol like `/` or `.`.
- Invalid numeric attempts are preserved in the submission capsule for LLM grading instead of being converted to `null`.
