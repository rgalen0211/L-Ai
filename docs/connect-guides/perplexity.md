# Perplexity

1. Plugins (sidebar), Add custom, Connector, MCP connector, Remote.
2. Name: Ryagram. URL: `<CONNECT_URL>`. Authentication: OAuth 2.0 (leave client id and secret empty). Transport: Streamable HTTP.
3. Save, Connect, sign in to Ryagram, check the address, Allow.

Enterprise: an admin must turn on "Allow members to add custom connectors".
Callbacks (on the allowlist): `https://www.perplexity.ai/rest/connections/oauth_callback` and the enterprise one, `https://enterprise.perplexity.ai/rest/connections/oauth_callback`.

Known unknowns: which plans have custom connectors (not stated officially); whether Perplexity uses PKCE.
