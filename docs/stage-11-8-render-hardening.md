# Stage 11.9: Question Renderer Hardening

Stage 11.9 fixes the real ChatGPT widget crash where a question renderer assumed an array existed and the widget showed:

```txt
Cannot read properties of undefined (reading 'map')
```

Changes:

- Visible widget version updated to `v12.0`.
- Widget resource URI changed to `ui://widget/betterquizzer-stage12.html` to bust host caching.
- Multiple-choice and multi-select renderers no longer assume `choices` exists.
- Ordering and matching renderers no longer assume `items`, `left`, or `right` exists.
- A malformed single question now shows a readable local setup warning instead of crashing the entire widget.
- The submission screen duplicate heading was removed.

This is a stability patch before public-host/app-store work.
