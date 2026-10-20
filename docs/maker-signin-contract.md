# Desktop app sign-in: the contract between the app, the site and the database (NEXT-CONNECT 98, r9 M1)

**Status: DRAFT for CC1, WEB and WORKER. Nothing here is live. The app side exists as a branch with a FAKE site; the real edge function and SQL do not exist yet.** Every name below is a proposal. The executable copy of this page is `tools/fake_ryagram_site.py`, and `tools/check-signin-client.py` is the test that holds both sides to it.

## 1. What the app does (tools/ryagram_signin.py, tools/desktop_maker.py)

The person presses **Sign in to Ryagram**. The app asks the site for a short code, shows it, and opens the approval page. The person approves **this computer** on the website while signed in there. The app then holds a narrow, opaque **node token** and nothing else. No password is ever typed into the app.

* The token is kept in the **Windows Credential Manager**: CRED_TYPE_GENERIC, persisted for this computer only (CRED_PERSIST_LOCAL_MACHINE, never the roaming kind), target `Ryagram/node/<site host>`. If the Credential Manager is missing the app refuses to sign in. **There is no file fallback.** Any program running as the person can read the entry, as it can read a browser cookie; the card says so.
* A small non-secret file in the work folder (`ryagram-account.json`) holds email, computer name, approved-until date, the local-compute flag and the time of the last successful check. It holds no token and no device secret (tested). **It is never put into a kit zip, a receipt or the activity log** (the log check proves the log; a kit builder must leave the work folder out).
* **Offline grace, 7 days.** The cached state pauses ONLY the "this computer renders my site films" node, and says so on the card. **Local clip films are never blocked by the account** (CC1 14:14: they are local and free, and a person who never signed in can always make them; blocking them would make signing in worse and teach people to sign out). It authorises nothing on the server, and the server always wins: a check that the site refuses signs the computer out at once.
* Off unless the maker is started with `--site https://.../node` (or `RYAGRAM_SITE`) and, if the approval page lives on another host, `--approval-host uselai.com`. With no site, the maker is exactly r8.

## 2. The HTTP API the app calls (the "node" edge function)

`{site}` is the node edge function's base address (https, or http only for 127.0.0.1 in tests). No redirect is followed. No secret ever travels in a URL.

| Call | Auth | Body | Success | Failure |
|---|---|---|---|---|
| `POST {site}/device/code` | none, rate-limited | `{computer_name, app}` | `{device_code, user_code, verification_uri, verification_uri_complete?, expires_in, interval}` | 429 `slow_down` when making codes too fast |
| `POST {site}/device/token` | none, the device secret in the BODY | `{device_code}` | `{node_token, expires_in, account:{email, computer_name, local_compute}}` | 400 `authorization_pending`, `slow_down`, `access_denied`, `expired_token` |
| `GET {site}/account` | `Authorization: Bearer <node token>` | none | `{account:{email, computer_name, local_compute, approved_until}}` | 401 `invalid_token` (removed or expired) |
| `POST {site}/signout` | bearer | `{}` | `{ok:true}` | 401 |

Shapes follow RFC 8628 (device authorization). **What the app refuses** (each one is a test with nothing stored): a `user_code` that is not 4+4 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0 O 1 I L); a `device_code` under 32 characters or with odd characters; an approval address that is not https (or local http) on the site host or a host the app was told about; an address with a password in it; `expires_in` over 15 minutes (cut back to 10); a `node_token` under 32 characters or with odd characters; a reply with no `account`; a reply over 100 KB. The app honours `interval` itself and adds 5 seconds on `slow_down`.

## 3. Server rules the fake keeps (CC1 13:20 and 13:34) and the real site must keep

1. A user code ends after **10 minutes**, works **once**, and is 8+ characters from the alphabet above. The device secret is 32+ random bytes and stored **hashed**.
2. Making codes and polling are **rate-limited**; polling faster than `interval` gets `slow_down` and a longer interval.
3. The node token is stored as **sha256 only**, is **never logged** (not the token, not the Authorization header), and is valid **only** on the node endpoints. Presented to the connector (`/connect`) or to PostgREST it is refused: audience separation, not just scope.
4. A removed computer's token is refused (401). Every approval sends an email. The account page lists every computer with Remove.
5. **CC1's six must-fails for the real SQL and edge function (13:48):** (a) `device_request_check` changes NOTHING, so an email scanner or link preview that opens `#/device?code=...` cannot claim, bind or use up a code; only `device_decide` does. (b) Expiry and single use are enforced in SQL, not by the greyed Approve button: `device_decide` on an expired, used or denied code is refused. (c) `device_decide` needs an APP session: a connected-AI (OAuth) token or a node token calling it is refused. (d) The node role has no grant that reaches credits, orders or the ledger, and the token is refused after 30 days. (e) Remove is immediate: the removed computer's very next node call is refused. (f) `approx_place` comes from the request's IP: the Privacy text says a rough place is kept with each signed-in computer, or it is not stored after approval.
6. `run_on` is set by the server from the account flag at submit, never from the request body (M3, not this branch). Upload paths are derived from the job id by the server, a signed URL covers that one path, and a per-FILE size cap is enforced (M3, not this branch; the per-tester quota was dropped on Ryan's 13:49 answer). Connect-your-AI is for invitees and Ryan only, decided on the server.

## 4. How WEB's approval page and WORKER's SQL fit

WEB 105 (`device-approval` 74382a0) calls four data functions that are PROPOSED NAMES; this is what the app side needs from each:

| WEB's call | What it must do | Note |
|---|---|---|
| `device_request_check(user_code)` | return `{state, computer_name, requested_at, rough_location, expires_at}` for a pending, unexpired code, otherwise a state of `expired` / `used` / `unknown` | `computer_name` comes from the app and is **untrusted text**; the page cuts it and shows it as text |
| `device_decide(user_code, approve)` | needs the signed-in session; approve or deny a pending code **once**; on approve, create the `node_tokens` row (hash only), mark the code used, send the email | the app collects the token on its next poll, once |
| `my_computers()` | list this person's non-revoked computers (name, last used, expires) | |
| `remove_computer(id)` | revoke it; the app's next `/account` check gets 401 | |

WORKER's M3 tables behind them: `device_codes` (user_code unique, device_hash, computer_name, ip_hash, state, expires_at, interval, next_poll_at, user_id, decided_at) and `node_tokens` (token_hash, user_id, computer_name, created_at, expires_at, last_used_at, revoked_at).

## 5. How to run the tests (no site, no account, no network beyond 127.0.0.1)

```
python tools/check-signin-client.py <scratch folder>                 # the client against the fake site (set RYAGRAM_TEST_REAL_STORE=1 to also write one throwaway entry into the real Credential Manager)
python tools/check-maker-signin.py <engine folder> <scratch folder>  # the page, in real Chrome, with a fake site and a fake store
```
