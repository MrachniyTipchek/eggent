## Eggent v0.1.5 - Web Fetch for Direct Links

Patch release focused on direct-link handling via a dedicated web fetch tool.

### Highlights

- Added new `web_fetch` tool for opening and reading specific URLs.
- Added HTML-to-text extraction, JSON/text handling, timeout, and response-size limits for stable fetch behavior.
- Kept `search_web` focused on discovery; direct links now use `web_fetch`.
- Updated chat tool output UI with `Web Fetch` label and target URL preview.
- Updated request-flow documentation and tool prompts for the new split.
- Version bump to `0.1.5` across package metadata and `GET /api/health`.

### Upgrade Notes

- No migration required.
- Existing search behavior is preserved.
- For URL-specific tasks, call `web_fetch` directly.

### Links

- Full release snapshot: `docs/releases/0.1.5-web-fetch-direct-links.md`
- Installation and update guide: `README.md`
