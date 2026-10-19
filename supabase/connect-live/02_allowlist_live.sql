-- LIVE redirect allowlist: the ONLY addresses a sign-in may return to. Run as the project owner in the SQL Editor AFTER the connect migration.
-- Exact addresses only. There is deliberately NO loopback row: live keeps loopback OFF (a program on a person's own computer is not offered).
-- Add a row later only when a vendor's real address is confirmed (see CONNECT-LIVE-PLAN.md, "unproven").
insert into public.connect_redirect_allowlist (redirect_uri, kind, label, enabled) values
  ('https://claude.ai/api/mcp/auth_callback',                    'exact', 'Claude',                          true),
  ('https://claude.com/api/mcp/auth_callback',                   'exact', 'Claude',                          true),
  ('https://chatgpt.com/connector_platform_oauth_redirect',      'exact', 'ChatGPT',                         true)
on conflict (redirect_uri) do update set kind = excluded.kind, label = excluded.label, enabled = excluded.enabled;

-- Make sure loopback is OFF, and say so.
update public.connect_redirect_allowlist set enabled = false where kind = 'loopback';

-- Check (every column aliased): exactly these rows are enabled, and no loopback row is.
select redirect_uri as address, kind as kind, label as shown_to_people_as, enabled as is_on
  from public.connect_redirect_allowlist order by kind, redirect_uri;
