# Claude (claude.ai, Claude Desktop, phone)

Plans: Free (one custom connector), Pro, Max, Team, Enterprise. On Team and Enterprise only an owner or admin can add a connector; each member then connects themselves.

1. Settings, Connectors, Add custom connector.
2. Name: Ryagram. URL: `<CONNECT_URL>`. Leave client id and secret empty (Claude registers itself).
3. Add, then Connect. Sign in to Ryagram, check the address shown, press Allow.
4. In a chat, turn the Ryagram connector on and ask: "Using Ryagram, show my credits."
5. Claude asks before using each tool the first time. "Allow always" is fine for reading tools; keep asking for anything that saves or renders.

Test (Ryan): ask for credits; create a project; save the example story from get_story_schema; make a contact sheet; check status; get a link.

Known unknowns: the callback `https://claude.ai/api/mcp/auth_callback` (it may become claude.com) must be on the Ryagram allowlist. Claude cannot edit a connector's sign-in settings after adding it: remove and add again.
