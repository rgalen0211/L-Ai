-- LIVE: SWITCH EVERY AI CONNECTION OFF. One statement. Run in the SQL Editor as the project owner. Effective on the very next call.
-- Nothing signs in, registers, refreshes or calls a tool while this is off. Tokens and permissions are kept, so 91_switch_on.sql restores them.
update public.connect_flags set connections_enabled = false where id;

-- Check: the flag, and a tool-style probe that must now refuse (the second column says what the connector will do).
select connections_enabled as switch_is_on,
       case when connections_enabled then 'ON: connections work' else 'OFF: every connect function refuses' end as meaning
  from public.connect_flags;
