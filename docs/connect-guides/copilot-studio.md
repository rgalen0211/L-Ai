# Microsoft Copilot Studio

Needs a Copilot Studio tenant with maker access. Consumer Microsoft Copilot cannot do this (see not-possible.md).

1. Open your agent, Tools, Add a tool, New tool, Model Context Protocol.
2. Server name: Ryagram. Description: "Make data films with Ryagram: projects, story check, contact sheet, preview, links" (the agent uses this text to decide when to call it). URL: `<CONNECT_URL>`.
3. Authentication: OAuth 2.0, Dynamic discovery. Create. Copilot Studio then shows a callback URL: send it to Ryan to add to the allowlist, then Connect.
4. Turn on generative orchestration for the agent.

Alternative: import the OpenAPI description at `<CONNECT_BASE>/openapi.json` as a REST API tool (Copilot Studio converts it to OpenAPI v2).

Known unknowns: the licence needed, the callback value, tool-count limits (none documented). A data policy that blocks connectors also blocks this.
