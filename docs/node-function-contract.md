# The `node` edge function: contract with WORKER's SQL (NEXT-CONNECT 100, r9 M4)

**DRAFT for CC1 and WORKER. Nothing is deployed or applied.** `supabase/functions/node-core/` is the logic (runs under Node in tests and Deno on Supabase), `supabase/functions/node/` is the thin Deno entry and the real database mapping, `supabase/functions/node-core/fake.ts` is an in-memory copy of the SQL rules, and `tests/node-function.test.mjs` is the proof (20 tests, 26 deliberate breakages all fail it). It is the connector's twin: an opaque token, hashed, resolved to a person inside the database, no Supabase session in the app.

## 1. Calls (the app's contract is in `tools/ryagram_signin.py` on `maker-r9-signin-id`)

| Route | Auth | Database function (role `node_runner`) |
|---|---|---|
| `POST /device/code` | none, 6 a minute per caller | `node_hit`, `node_device_begin` |
| `POST /device/token` | none, one poll per 4 s per code | `node_hit`, `node_device_state`, `node_device_exchange`, `node_account` |
| `GET /account` | `Bearer rgn_...` | `node_account` |
| `POST /signout` | bearer | `node_signout` |
| `POST /node/claim` | bearer | `node_claim` |
| `POST /node/heartbeat` | bearer | `node_heartbeat` |
| `POST /node/state` | bearer | `node_report_state` (a node may set only running, validating, uploading, complete, failed) |
| `POST /node/retry` | bearer | `node_retry` |
| `POST /node/artifact` | bearer | `node_register_artifact`, then a signed upload URL for the path it returns |

Everything else is 404. There is no route to the job list, credits, orders, projects or any other account.

## 2. Against WORKER's SQL: r9-node-draft rev3 (3ce2c65)

Aligned. The function calls exactly these, as `node_runner`: `node_device_begin(device_hash, user_code, computer_name)` (jsonb: user_code, expires_in, interval), `node_device_exchange(device_hash, token_hash)` (jsonb: the state, the interval on slow_down, and on ok the expires_in and account; the database owns the states and the poll interval, and mints the token once from the hash we give it), `node_account`, `node_signout`, `node_claim`, `node_heartbeat`, `node_report_state`, `node_retry`, `node_register_artifact`. The email arrives masked by the database (s***@example.com) and is passed on as is. Rev3 also pins a job to the TOKEN that claimed it, so a second computer of the same person cannot touch it (tested here as "one computer, one job").

**Still requested from WORKER (one function):** `node_hit(p_caller text, p_bucket text, p_max int, p_window int) returns boolean`, a copy of `connect_anon_hit` for the node role, so making codes is limited PER CALLER (6 a minute) and polling per caller (120 a minute). Rev3 only caps the whole table at 500 waiting codes, which one caller could fill. Without it the function cannot rate-limit by caller. CC1's MED-1 (the grant test) then counts ten node functions: the nine above plus `node_hit`.

## 3. Rules and where each is proven (all in `tests/node-function.test.mjs`)

* The token is `rgn_` + 43 characters; anything else (junk, a Supabase JWT, a connector `rga_`/`rgr_` token) is refused **before any database call**; a token in a URL is never read (even a valid one).
* The database receives only SHA-256 of the device secret and of the token. Errors are fixed sentences chosen by error code; the database's text is never sent and nothing is logged.
* The upload path is **derived by the database from the job** and returned; the request never names a path; the function signs exactly that path; a per-file cap (`NODE_MAX_FILE_BYTES`, default 200 MB) is enforced before the database is asked, and the database's own per-kind limit still applies.
* The job must be held by the caller (owner and holder both), a job row is cut to the fields a node needs (no worker ids, lease or `run_on`), and a request body that names an owner changes nothing.
* Codes: 8 characters from an alphabet without 0 O 1 I L (rejection sampling, no bias), 10 minutes, one use; polling faster than the interval gets `slow_down` and a longer interval; a denied code says `access_denied`.
* No CORS headers: a web page cannot call this function.

## 4. One decision that is not mine: the upload key

Supabase can sign an upload URL only with a key. The connector's rule is "no Supabase key in the function". Here the function must hold ONE key (`NODE_UPLOAD_KEY`) to sign the path the database returned. On the Free plan the only key that can do it is the service-role key. Options for CC1 and Ryan: (a) accept that key inside this one function (it is never read from a request and never sent to the app); (b) a second tiny function `node-upload` that holds the key and signs only for a one-time ticket the database issued; (c) the node uploads through a database-issued short-lived storage grant, if Supabase offers one on Free. I built (a) behind an injected `storage` object so (b) or (c) is a swap, and I recommend (b) before anything goes live. **Not a Ryan row yet: nothing is deployed.**

## 5. Ryan rows this will need (none applied)

Create role `node_runner` and apply WORKER's SQL (WORKER/CC1 first); set the five secrets (`NODE_DB_URL`, `NODE_APPROVAL_URL`, `NODE_SALT`, `NODE_UPLOAD_KEY`, optional `NODE_MAX_FILE_BYTES`); `supabase functions deploy node --no-verify-jwt`; set the tester flag for Sam (WEB 114). Each is a typed-OK step.
