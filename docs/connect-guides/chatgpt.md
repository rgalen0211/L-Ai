# ChatGPT

**Check first.** OpenAI's documentation confirms adding a custom MCP server for Business and Enterprise/Edu workspaces. For Free, Plus and Pro we found no current official statement, so we do not promise it. Open ChatGPT, Settings, Apps (or Connectors, or Plugins). If there is an "add custom MCP server" option (sometimes behind Developer mode) you can use it. If not, ChatGPT cannot connect to Ryagram on your plan.

1. Settings, Apps/Connectors, Create (custom MCP). Name: Ryagram. URL: `<CONNECT_URL>`. Authentication: OAuth.
2. Accept the risk notice for a custom server.
3. Create, Connect, sign in to Ryagram, check the address, Allow.
4. In a chat, add Ryagram from the + menu and ask "show my Ryagram credits".
5. ChatGPT asks you to confirm write actions (saving a story, starting a sheet). Read what it will do before you confirm.

Do not use a Custom GPT with Actions: OpenAI is retiring custom GPTs (December 2026) and Actions do not carry over.

Known unknowns: which personal plans show the option. Redirects `https://chatgpt.com/connector_platform_oauth_redirect` and the per-server `https://chatgpt.com/connector/oauth/<id>` (copy that one from ChatGPT and give it to Ryan for the allowlist).
