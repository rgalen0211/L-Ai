-- LIVE STEP 72b: EXPORT THE TAX ANSWERS (READ-ONLY) (CONNECT 2026-11-26; RENDERER 16:06 finding 3). Changes NOTHING. Run it and SAVE the result (the SQL Editor's Download CSV) BEFORE you ever run the rollback of migration 20261123000900, because that rollback DROPS the table of answers.
-- WHAT IT SHOWS: one row per person who answered the 'business or personal use, and where are you' question: their account id (no email, no name), use, country, state, the Ohio county they chose (Ohio business only), the ZIP kept for pre-filling, and the date they answered. After real sales these rows are your record of why a customer was or was not charged Ohio tax.
-- PERSONAL DATA, READ THIS FIRST (CC1 16:12): the result is customers' account ids with their state, county and ZIP. Ryan saves it ONLY into his own export folder (the one the sessions never open). NEVER into Ryagram-logs, a session's folder, a chat, MAILBOX or git, and NO session runs this step or reads its output: Ryan runs it himself in the SQL Editor.
-- PART 1 (read-only): how many answers there are, by use and place.
-- PART 2 (read-only): every answer, newest first (this is the one to save).

-- PART 1 (read-only)
select count(*) as answers, count(*) filter (where use = 'business') as business, count(*) filter (where use = 'personal') as personal,
       count(*) filter (where state = 'OH') as in_ohio, count(*) filter (where state = 'OH' and use = 'business') as ohio_business
  from public.account_tax_profile;

-- PART 2 (read-only)
select owner_id, use, country, state, county, zip, answered_at
  from public.account_tax_profile
 order by answered_at desc;
