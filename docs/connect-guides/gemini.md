# Google Gemini

**Gemini app** (US only, age 18+, personal Google account, English; not work or school accounts). On the web: Settings, Connected apps, custom apps, add by MCP URL: `<CONNECT_URL>`. If it asks for credentials ("Show more"), leave them empty and let it register. Sign in to Ryagram and press Allow. Gemini asks you to confirm anything that writes.

**Gemini CLI**: add to `~/.gemini/settings.json`:

    { "mcpServers": { "ryagram": { "httpUrl": "<CONNECT_URL>" } } }

then run `/mcp auth ryagram`.

Known unknowns: the app's redirect URL and whether a paid plan is needed are not documented. Ryan captures the redirect from the first attempt and adds it to the allowlist.
