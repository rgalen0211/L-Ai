# Connector directory submission checklist (CONNECT, NEXT-CONNECT 165, punch P8)

Draft, 2026-10-30. **Submitting is Ryan's: nothing here is sent anywhere.** The words in the two listing files are drafts for Ryan (and the attorney for privacy and terms). The reasoning behind every item is in `proposals/CONNECT-DIRECTORY-LISTINGS.md` (the gap numbers G1 to G14 below are from it).

Files in this folder: `tools.json` (the 17 tools with their hints and a written justification; generated from the live tool list), `anthropic-listing.json`, `openai-listing.json`.
Keep them honest: `node tools/connect-directory.mjs --check` (also run by `tests/directory-manifests.test.mjs`) fails when a tool is added, renamed, hidden or given another hint, or when a listing leaves the vendors' limits. After a connector change: `node tools/connect-directory.mjs --write`, then write the justification of any new tool.

## A. Before either portal (Ryan, in this order)
- [ ] **Domain (G1).** Decide the connector's permanent address (the paper suggests `mcp.uselai.com`, a small forwarder in front of the function). OpenAI never lets the origin change between versions, so decide before the first submission. Then update `server.url` in both listing files and the OAuth metadata base, and re-test the sign-in with Claude and ChatGPT.
- [ ] **Invite wall (G10).** Keep it for the first submission (a stranger who adds the connector sees "This account is not enabled for AI connections") or open the connector to every signed-in account first.
- [ ] **Privacy and terms (G4).** The privacy policy page must cover connected AI assistants (draft section in the paper); the attorney reads it; WEB puts it on `privacy-policy.html`. Terms are at `terms/terms.html`.
- [ ] **Docs page (G6).** Make `connect-ai/` public (today it is `noindex`) and link it from Account > Connected AIs and the footer.
- [ ] **Support mailbox (G7).** Confirm `ryagram@uselai.com` receives mail and is watched; both portals ask for a contact.
- [ ] **Hints (decision a).** The three editor tools (`set_look`, `edit_tracks`, `undo_my_changes`) are `destructiveHint: false` today. Say yes or no to marking them destructive; if yes, CONNECT changes the registry and runs `--write`.
- [ ] **Reviewer accounts (G5).** Two accounts (one per vendor), invited to connect an AI, sign-in with no email code or magic link, each with a project, a saved story and a finished contact sheet. The credentials go into the vendors' portals only, never into this repository, the board or a log.
- [ ] **Redirect rows (G9).** Check the live `connect_redirect_allowlist` has the claude.ai callback; after OpenAI's portal shows its callback URL, add that exact URL (do not guess it).
- [ ] **Cold-start check (G13, G14).** Time the discovery and token answers from outside against the new domain (the vendors want an answer in 10 seconds); check Streamable HTTP and `Origin` with the MCP Inspector. A Ryan/CC1 row: CONNECT does not call the live functions.

## B. Anthropic first (any paid Claude plan; listed as Community after an automatic scan)
1. Open claude.ai/directory/manage and choose the MCP connector form.
2. Fill the fields from `anthropic-listing.json`: name, one-liner (200), description (2000), 1 to 5 categories, documentation URL, privacy policy URL, support contact, icon, permanent URL slug, company name and website, use cases, what a person needs before connecting, data-handling answers.
3. Server: the address, Streamable HTTP, OAuth 2.0 (PKCE S256, dynamic client registration). Callback for claude.ai and Claude Desktop: `https://claude.ai/api/mcp/auth_callback`; Claude Code uses a loopback.
4. Tools: the portal reads them from the live server. Check each against `tools.json` (title, read-only or destructive).
5. Test account: the reviewer account's credentials and a short instruction, in the portal only.
6. Tick the compliance acknowledgements, read the whole form back once, then press submit (Ryan).
7. Reply to any reviewer mail the same day (mcp-review@anthropic.com for escalation).

## C. OpenAI second (verified Platform organisation; no EU data residency project)
1. Verify the individual or business in the Platform Dashboard; owner or `api.apps.write`.
2. Serve the domain-verification token at `/.well-known/openai-apps-challenge` on the MCP host (needs the custom domain, A above).
3. Fill the fields from `openai-listing.json`: displayName (30), shortDescription (30), longDescription (4000), developer name, category, four https URLs, logo, up to 3 default prompts, country availability, release notes.
4. For each tool enter the three hints and the justification from `tools.json`.
5. Enter the 5 positive and 3 negative test cases, the demo account (credentials in the portal only) and the demo recording URL.
6. Register the portal's OAuth callback in `connect_redirect_allowlist` (A above) before submitting.
7. Submit (Ryan); approval comes by email, then press Publish. OpenAI re-scans the live server daily; a new tool is held until approved.

## D. After a listing exists
- Any connector change: `--check` first (the vendors re-scan the live tool list).
- The privacy section, the docs page and the support mailbox must stay true.
- Keep the reviewer accounts alive and filled.

## E. What is not made yet (so nobody assumes it)
The logo (square, at least 48 px), screenshots if MCP Apps are used, the demo recording, the reviewer accounts, the custom domain, the privacy section on the live page, the public docs page.
