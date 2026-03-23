# Web Fetch Tool

Fetch a specific web page by URL and return readable page content.

## When to Use

- The user provides a direct link and asks to read/summarize it
- You need content from one known page, not broad discovery
- You must verify details from a specific source URL

## Best Practices

- Pass a full `http(s)` URL
- Prefer `web_fetch` for direct links, `search_web` for discovery
- If fetch fails, explain the error and ask for another link if needed
- Quote or summarize only the relevant sections in your final response
