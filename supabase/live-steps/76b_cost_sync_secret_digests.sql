-- LIVE STEP 76b: THE DIGESTS OF THE cost-sync SECRETS (READ-ONLY) (CONNECT 2026-11-26, from GEO's 19:04 idea). Changes NOTHING and NEVER prints a secret: it shows each Vault secret's NAME, LENGTH and the first 12 characters of its SHA-256 digest.
-- USE: compare the digest_start of cron_cost_sync with the SHA-256 digest the Supabase dashboard shows for the function secret COST_SYNC_SECRET (Edge Functions > Secrets shows names and digests, never values). Same start = the pair matches (then the 403 has another cause: send the grid to CC1); different or COST_SYNC_SECRET missing = THAT is the 403 (fix: proposals/CONNECT-COST-SYNC-403-1126.md).
-- A digest of a random 32-or-more-character secret does not reveal it. Do not paste the digests into a chat or a file anyway: they only need to be compared by eye.
select s.name as secret_name, length(s.decrypted_secret) as secret_length, left(encode(sha256(convert_to(s.decrypted_secret, 'UTF8')), 'hex'), 12) as digest_start
  from vault.decrypted_secrets s
 where s.name in ('cron_cost_sync', 'cron_ops_tick', 'cron_ops_digest')
 order by s.name;
