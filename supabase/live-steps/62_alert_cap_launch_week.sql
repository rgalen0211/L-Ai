-- ALERT EMAILS FOR LAUNCH WEEK (Ryan's step, Ryan 15:46 'Alert cap 60 for launch week'; any time before Wednesday 08:30, e.g. in Tuesday's sitting; GEO 2026-11-23).
-- How many alert emails (the render PC offline, help requests, and the other ops alerts) may go out in one New York day. Built in as 20; for launch week 60,
-- so a busy help day cannot hold back the 'render PC is offline' email until tomorrow. Run the parts in the SQL Editor ONE AT A TIME (highlight a part, Run).
-- MIND THE MAIL ALLOWANCE: alerts and the sign-up emails go out through the SAME mail service (Resend). Its plan has its own daily limit (your Resend
-- dashboard): 60 alerts + the first wave's sign-up emails must fit under it, or sign-up emails are refused. If your plan's daily limit is under about
-- 60 + 2 x your FIRST WAVE number, tell CC1 before running part 2.

-- PART 1, read-only BEFORE check: the cap now (20 unless changed) and how many alert emails went out today.
select max_alert_mails_per_day as alert_cap_now,
       (select count(*) from public.ops_outbox where kind = 'alert' and (created_at at time zone 'EST5EDT')::date = (now() at time zone 'EST5EDT')::date) as alert_mails_today
  from public.ops_settings;

-- PART 2, the change for launch week: 60. It takes effect at the next minute's ops-tick.
update public.ops_settings set max_alert_mails_per_day = 60;

-- PART 3, AFTER check: must show 60.
select max_alert_mails_per_day as alert_cap_now from public.ops_settings;

-- PART 4, the UNDO, after launch week (or if CC1 says): back to the built-in 20.
update public.ops_settings set max_alert_mails_per_day = 20;
