-- READ-ONLY. IS THE REVIEW ACCOUNT READY? (CONNECT 2026-11-10; NEXT-CONNECT 208 (a), CC1 10:29 order C.)
-- A directory reviewer signs in with ONE account and runs every tool. This checks that account against every gate, one line each, PASS or FAIL, and says what to do about a FAIL. Run it the morning of a review, and after you fill the account.
--
-- HOW: in the Supabase SQL Editor of the live project, replace REVIEW-ACCOUNT-EMAIL-HERE below with the review account's email (inside the quotes, nothing else), paste the whole file, Run. The last row says ALL REQUIRED GATES PASS or how many failed.
-- WHAT IT DOES: it creates one throw-away function that lives only in your editor session (it disappears when the session ends; it is never in the database proper), reads some rows, and changes NOTHING. It never prints the email or any person's data: only the words below and PASS or FAIL.
-- A gate whose table is not on your database yet (a window step you have not applied) says NOT APPLICABLE, never FAIL.
create or replace function pg_temp.review_account_check(p_email text) returns table (n int, gate text, result text, if_not text)
language plpgsql as $$
declare
  uid uuid; cnt int; r boolean; failed int := 0;
  g record;
begin
  select count(*) into cnt from auth.users where lower(email) = lower(btrim(p_email));
  if cnt <> 1 then
    return query select 1, 'the review account exists (exactly one account has that email)', 'FAIL', 'Check the email you typed above; make the account first (the same steps as your own test account).';
    return query select 99, 'RESULT', 'FAIL: the account was not found, nothing else was checked', 'Fix the email and run again.';
    return;
  end if;
  select id into uid from auth.users where lower(email) = lower(btrim(p_email));
  return query select 1, 'the review account exists (exactly one account has that email)', 'PASS', '';
  for g in
    select * from (values
      (2, true,  'it is NOT an administrator',                                        'select not exists (select 1 from public.app_admins where user_id = $1)',                                  'Use an account that is not in app_admins: an administrator is refused by the connector.'),
      (3, true,  'it is NOT a worker',                                                'select not exists (select 1 from public.workers where user_id = $1)',                                     'Use an account that is not in workers: a worker is refused by the connector.'),
      (4, true,  'it is ACTIVE, not on the waiting list',                             'select ryagram_private.account_active($1)',                                                               'Approve it (your approve step for accounts); a waiting account is refused by the whole gate.'),
      (5, true,  'it is invited to the connector (its invite row is on)',             'select exists (select 1 from public.connect_access where user_id = $1 and enabled)',                      'Invite it (the same one-line step as your own test account).'),
      (6, true,  'the connector itself accepts the account (all of the above, as the connector checks them)', 'select ryagram_private.connect_person_ok($1)',                                       'One of the gates above is a FAIL: fix that one.'),
      (7, true,  'the connector is switched ON (the master switch)',                  'select (select connections_enabled from public.connect_flags where id)',                                   'Run 91_switch_on.sql.'),
      (8, true,  'it has a film (not archived) with a saved story',                   'select exists (select 1 from public.projects p join public.versions v on v.project_id = p.id where p.owner_id = $1 and p.archived_at is null and v.story_spec <> ''{}''::jsonb)', 'Make a film in the account and save a story.'),
      (9, true,  'it has a FINISHED contact sheet',                                   'select exists (select 1 from public.jobs where owner_id = $1 and job_type = ''contact_sheet'' and state = ''complete'')',  'Make a contact sheet in the account and wait for it to finish (the house PC must be on).'),
      (10, true, 'it has a FINISHED preview',                                         'select exists (select 1 from public.jobs where owner_id = $1 and job_type = ''preview'' and state = ''complete'')',        'Make a preview in the account and wait for it to finish.'),
      (11, true, 'it has a clip film whose track list is SHARED with the AI (the tick)', 'select exists (select 1 from public.edit_drafts where owner_id = $1 and mode = ''compilation'' and ai_visible)',          'In the Ryagram app tick "Let my AI see my track list" on a clip film.'),
      (12, true, 'nothing is waiting or running for it right now',                    'select not exists (select 1 from public.jobs where owner_id = $1 and state in (''queued'', ''claimed'', ''running'', ''validating'', ''uploading''))', 'Wait for the running job to finish, or cancel it in the app.'),
      (13, false, 'a film has its look card drawn (the editor panel shows the film''s real colours)', 'select exists (select 1 from public.film_card_requests where owner_id = $1 and state = ''answered'')', 'Only if the editor is in the listing: open a data film in the editor with the worker on and wait for the card.')
    ) as t(n, required, gate, q, if_not)
  loop
    begin
      execute g.q into r using uid;
    exception when undefined_table or undefined_function or undefined_column then
      r := null;                                                      -- that step of the window is not applied on this database
    end;
    if r is null then
      return query select g.n, g.gate, 'NOT APPLICABLE', 'That part of the window is not applied on this database yet.';
    elsif r then
      return query select g.n, g.gate, 'PASS', '';
    else
      if g.required then failed := failed + 1; end if;
      return query select g.n, g.gate, case when g.required then 'FAIL' else 'FAIL (optional)' end, g.if_not;
    end if;
  end loop;
  return query select 99, 'RESULT', case when failed = 0 then 'ALL REQUIRED GATES PASS' else failed || ' REQUIRED GATE(S) FAIL' end, case when failed = 0 then 'The account is ready to be handed to a reviewer.' else 'Fix the FAIL lines, then run this again.' end;
end $$;

select * from pg_temp.review_account_check('REVIEW-ACCOUNT-EMAIL-HERE') order by n;
