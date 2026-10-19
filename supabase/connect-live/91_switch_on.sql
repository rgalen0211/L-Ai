-- LIVE: switch AI connections back ON after 90_switch_off.sql (existing tokens and permissions work again).
update public.connect_flags set connections_enabled = true where id;

select connections_enabled as switch_is_on,
       case when connections_enabled then 'ON: connections work' else 'OFF: every connect function refuses' end as meaning
  from public.connect_flags;
