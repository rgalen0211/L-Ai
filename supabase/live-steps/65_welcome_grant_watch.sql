-- WELCOME-CREDITS WATCH (Ryan's look, read-only; Wednesday once an hour RIGHT AFTER live step 58; GEO 11-23, CC1 17:48: this was step 58's row 12).
-- Its own file because it reads ryagram_private.welcome_credit_grants, which the welcome-credits undo (rollbacks/20261123000600_welcome_credits_rollback.sql) drops:
-- AFTER THAT UNDO, SKIP THIS STEP (it would only say the table does not exist); step 58 keeps working without it. Before A19 is applied it errors the same way: tell CC1.
-- Paste all, Run: one row, 'value' read against 'tell_cc1_if'. It changes nothing.
select 'verified sign-ups in the last 24 hours that got NO welcome credits' as what,
       (select count(*) from auth.users u
         where u.email_confirmed_at > now() - interval '24 hours'
           and not exists (select 1 from public.workers x where x.user_id = u.id)
           and not exists (select 1 from public.app_admins a where a.user_id = u.id)
           and not exists (select 1 from public.invite_redemptions r where r.email = lower(btrim(u.email)))
           and coalesce(u.raw_user_meta_data ->> 'adult_source', '') <> 'invite'
           and not exists (select 1 from ryagram_private.welcome_credit_grants g
                            where g.email_hash = encode(sha256(convert_to('ryagram-welcome:' || lower(btrim(u.email)), 'UTF8')), 'hex')))::text
         || ' (welcome setting now ' || coalesce((select (to_jsonb(o) ->> 'welcome_credits') from public.ops_settings o limit 1), 'missing') || ')' as value,
       'it is 1 or more while the setting is above 0: a welcome grant failed (Supabase, Logs, Postgres: a welcome warning); tell CC1, who names the repair step (never a hand grant: it would not record the address). Your own test sign-ups verified on Tuesday before A19 count here until 24 hours pass' as tell_cc1_if;
