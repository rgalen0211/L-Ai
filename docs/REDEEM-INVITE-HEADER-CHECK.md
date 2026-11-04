# redeem-invite: which client-address header does the real project receive?

**For Ryan.** It takes about 10 minutes, changes no data, and needs no key or secret. The results you report back are only letters (below), never addresses.

## Why this matters

The sign-up form's guess limit is "10 wrong codes an hour from one address". It counts by an address taken from a request header, and the visitor can write some of those headers themselves. A guesser who can change the counted address on every try gets unlimited guesses (only the 300-an-hour site-wide cap would be left).

- **Live today** (main, 4c6f48d): `cf-connecting-ip`, else the **first** `X-Forwarded-For` entry. The first entry is the one the visitor writes, so the live version can be fooled.
- **On the features train** (`cloud-site-features-1103`, ca8cf10): `cf-connecting-ip`, else the **last** `X-Forwarded-For` entry. That entry is the one the platform's own proxy adds, the same rule as creator-beta and the desktop sign-in function.

The new rule is only right if the real Supabase project behaves as expected. This check finds out.

## Step 1: send one harmless request with three made-up addresses

Run this once from your own computer, with your project ref in place of `<ref>`. The ref is in your project URL and is not a secret.

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X OPTIONS "https://<ref>.supabase.co/functions/v1/redeem-invite" -H "Origin: https://uselai.com" -H "Access-Control-Request-Method: POST" -H "X-Forwarded-For: 203.0.113.99" -H "CF-Connecting-IP: 203.0.113.98" -H "X-Real-IP: 203.0.113.97"
```

- It should print **204**.
- An `OPTIONS` request is only the browser's "may I?" question. The function answers it before it reads anything or calls the database (`redeem.ts`: `if (req.method === "OPTIONS") return ...`), so no code is used, no guess is counted and nothing is written.
- `203.0.113.x` addresses are reserved for documentation and belong to nobody. They are the "forged" values: 99 in X-Forwarded-For, 98 in CF-Connecting-IP, 97 in X-Real-IP.

## Step 2: read what arrived, in the Logs Explorer (read-only)

Open Supabase Dashboard → your project → **Logs → Logs Explorer**, paste this query and run it:

```sql
select timestamp, r.method, h.cf_connecting_ip, h.x_forwarded_for, h.x_real_ip
from function_edge_logs
  cross join unnest(metadata) as m
  cross join unnest(m.request) as r
  cross join unnest(r.headers) as h
where r.method = 'OPTIONS'
  and timestamp > timestamp_sub(current_timestamp(), interval 30 minute)
order by timestamp desc
limit 5
```

- The Logs Explorer only reads logs; it cannot change anything.
- If it says one of the three header fields does not exist, delete that field from the `select` line and run it again. Then count that header as "—" (absent) below. The logs keep only some headers, so "absent" here means "not shown", which is still a usable answer.
- Look only at the row for your request, at the time you ran Step 1.

## Step 3: turn what you see into letters (do not paste any address anywhere)

First open any "what is my IP" page in your browser, and keep it to yourself. Then, for each of the three headers, write one letter:

| Letter | Meaning |
|---|---|
| **R** | your real address (the one the "what is my IP" page shows); for X-Forwarded-For, look only at its **last** entry |
| **F** | one of the made-up `203.0.113.x` values from Step 1 |
| **P** | some other address that is not yours (a proxy inside the platform) |
| **—** | absent, or not shown in the logs |

Send back three letters, for example "cf = R, xff-last = R, x-real-ip = —". If you can, also say whether the forged `203.0.113.99` appears **anywhere** in X-Forwarded-For (first, last, or not at all).

## Step 4: what the letters mean

| What you see | Meaning | What to do |
|---|---|---|
| **cf = R** (whatever the others show) | The platform sets CF-Connecting-IP itself, and the code uses it first. | **Safe to redeploy** the features train as it is. Set nothing. |
| **cf = —**, and **xff-last = R** (the forged 99 shows first, or not at all) | The proxy adds your real address at the end, and the code takes the last entry. | **Safe to redeploy** as it is. Set nothing. |
| **cf = F** (your forged 98 got through) and **xff-last = R** | A visitor can write CF-Connecting-IP, so the code must not trust it. | **Change first:** set the function secret `REDEEM_CALLER_HEADER` to `xff-last`, then redeploy. |
| **cf = — or F**, **xff-last = F or —**, and **x-real-ip = R** | The proxy does not add to X-Forwarded-For, but it sets X-Real-IP. | **Change first:** set `REDEEM_CALLER_HEADER` to `x-real-ip`, then redeploy. |
| **cf = R**, but you want to be strict about X-Forwarded-For too | Optional hardening only. | You may set `REDEEM_CALLER_HEADER` to `cf-connecting-ip`, so X-Forwarded-For is never used. |
| **Only P**, or no R anywhere | The function cannot see the visitor's address on this platform. Counting by P would put every visitor in one shared count (10 wrong codes an hour for everybody). | **Do not change a setting.** Tell CLOUD-SITE / CC1. Redeploying the features train is still no worse than what is live, but the per-address limit gives no protection until this is solved; the site-wide 300-an-hour cap still applies. |

To be extra sure, repeat Steps 1-3 once from another network (for example a phone hotspot): R should change to the new network's address, and the letters should stay the same.

## The code for the bad cases (already on branch `cloud-site-1103f`, OFF unless set)

- `supabase/functions/redeem-invite/redeem.ts` has `callerIp(headers, mode)`, and `index.ts` passes the function secret `REDEEM_CALLER_HEADER` to it:

  | `REDEEM_CALLER_HEADER` | The address counted |
  |---|---|
  | not set (the default), empty or unknown | `cf-connecting-ip`, else the last X-Forwarded-For entry: exactly the features-train rule |
  | `cf-connecting-ip` | only CF-Connecting-IP |
  | `x-real-ip` | only X-Real-IP |
  | `xff-last` | only the last X-Forwarded-For entry (CF-Connecting-IP ignored) |

- **Unset, nothing changes.** Setting it is a change to the live project, and it is yours to make: Dashboard → Edge Functions → Secrets (or `npx supabase secrets set REDEEM_CALLER_HEADER=xff-last --project-ref <ref>`), then redeploy `redeem-invite` from a tree that has this branch.
- Tests: `tests/redeem-invite-caller-header.test.mjs` covers every mode. A forged header never changes the counted caller in any mode, unset is the default rule, and an unknown value falls back to the default. The existing `tests/redeem-invite*.test.mjs` still pass.

## Also worth knowing

- **creator-beta** (`apply.ts`) and the desktop sign-in function **node** (`router.ts`) use the same default rule, and supabase/README.md already asks for this check for creator-beta ("Creator beta"). The same letters answer all three.
- The film report form's limits (`report_film_page`, in SQL) use the same rule too, and supabase/README.md ("HARD GATE before the report form is switched on") has its own device-by-device check.
- If you end up needing `xff-last` or `x-real-ip` here, those two functions need the same change (not made; say if you want it).
