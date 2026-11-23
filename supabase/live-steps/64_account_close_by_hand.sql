-- CLOSE ONE ACCOUNT BY HAND (Ryan's step; AFTER 20261123000700_account_close_by_hand.sql is applied; GEO 2026-11-23, CC1 17:07).
-- For a person who pressed 'Delete my account' while having credit history (every verified stranger since the 8 welcome credits). Their files and
-- uploads are already gone, their email is already out of support and invite rows, and their login is already blocked. This ends the login for good:
-- the email and phone are removed from it, the password and sign-in links emptied, their own metadata cleared, live sessions ended; the ban stays;
-- the credit ledger (the financial record) is NOT touched. It CANNOT be undone for that person.
-- Run the parts in the SQL Editor ONE AT A TIME (highlight a part, Run). Live step 58's row 11 counts the requests still open.

-- PART 1, read-only: the open requests, oldest first (copy the owner_id of the one to close).
select owner_id, requested_at, reason from public.account_deletion_requests where closed_at is null order by requested_at;

-- PART 2, the close, for ONE owner_id from part 1 (replace <owner_id> with it, keep the quotes). It refuses, changing nothing, if that account has no open request.
select public.account_close_by_hand('<owner_id>');

-- PART 3, read-only check for that owner_id: closed_at is set, the request has no email, and the login has no email.
select r.closed_at is not null as request_closed, r.email is null as request_has_no_email,
       (select u.email is null from auth.users u where u.id = r.owner_id) as login_has_no_email
  from public.account_deletion_requests r where r.owner_id = '<owner_id>';
