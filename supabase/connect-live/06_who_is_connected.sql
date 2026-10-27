-- READ-ONLY. Who has an assistant connected right now, what it calls itself, what it may do, when it connected and when it was last used.
-- This shows email addresses: look at it, do not paste it into a chat. Run in the SQL Editor as the project owner. Every column is named.
select u.email as person, c.name as assistant_calls_itself, g.scopes as may_do, g.created_at as connected_at,
       (select max(t.last_used_at) from public.connect_tokens t where t.owner_id = g.owner_id and t.client_id = g.client_id) as last_used_at
  from public.connect_grants g
  join auth.users u on u.id = g.owner_id
  join public.connect_clients c on c.client_id = g.client_id
 where g.revoked_at is null
 order by g.created_at desc;
