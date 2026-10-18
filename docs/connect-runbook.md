# Connect runbook: the secrets rule

**A secret is never in a repo, a migration, a script argument, a log, a commit message, or a chat.** That includes the password of the database
role `connect_runner`, which can act as a person whenever it holds a live token.

## Where the password lives
- The file that sets it is **`D:\Ryagram-scratch\secrets-staging\connect_runner_login.sql`** (a template with a placeholder). That folder is
  **outside every repository** and nobody but the project owner opens it. For the live project use a separate copy,
  `connect_runner_login_LIVE.sql`, in the same folder.
- The owner edits the file, pastes it into that project's SQL Editor, and runs it. The file is then left with the password in it only as long
  as the owner wants; rotating means editing it again.
- The connection string is built by the owner and saved only as the Edge secret `CONNECT_DB_URL` (Dashboard, Edge Functions, Secrets).
- Anyone working in the repo (including AI sessions) does not open `secrets-staging`, and no tool is pointed at it.

## If a password may have been seen
Run the login file again with a new password and update `CONNECT_DB_URL`. The old one stops working at once.

## Before running any test: `npm ci` first
A fresh checkout has no `node_modules`. Run `npm ci` once in the repository root (it installs exactly the versions in `package-lock.json`: 
`ajv` 8.17.1, `@modelcontextprotocol/sdk` 1.32.1 and `@supabase/supabase-js` 2.117.2, all devDependencies, nothing ships), then `node --test tests/*.test.mjs` 
and `node tools/connect_predeploy_check.mjs`. Without it the Ajv, MCP-client and tool tests fail on a missing module. Use `npm ci`, not `npm install`: 
it never changes the lock file.

## Checked by a test
`tests/connect-tools.test.mjs` fails if any file in the repo contains `alter role connect_runner ... password '<anything but the placeholder>'`, or a
`postgresql://` connection string with a password in it.

## What the first real run taught us (2026-10-18, proof project) - read this before deploying
These are the things that only showed up when the real function met the real platform, and what to do about each.

1. **"Function failed to start" (BOOT_ERROR) on the platform.** Three causes, in this order of how we found them:
   - the Ajv import must be `npm:ajv@8.17.1/dist/2020.js` (with `.js`); the type-check passes without it and the platform does not;
   - the platform's bundler is not asked to understand JSON import attributes, so the story schema is a plain generated module
     (`supabase/functions/_shared/story_schema.ts`, compared to the worker's export by a test);
   - deploy with **`--use-api`** (`npx.cmd supabase functions deploy connect --project-ref <ref> --no-verify-jwt --use-api`).
   Before deploying, run the entry file under Deno on your own computer: `deno run -A supabase/functions/connect/index.ts` must print "Listening".
   The log that explains a boot error is in the dashboard under Edge Functions, connect, Logs.
2. **The issuer address was wrong ("edge-runtime.supabase.com").** Inside the platform the request's own Host is an internal name, so the address
   the function advertises must never come from the request. It comes from the Edge setting `CONNECT_PUBLIC_URL`
   (`https://<ref>.supabase.co/functions/v1/connect`), or, if that is missing, from the platform's own `SUPABASE_URL`. If a client says the
   issuer or resource does not match, look at `<address>/.well-known/openid-configuration` first.
3. **"This sign-in request has expired. Start again from your assistant."** A sign-in request used to live 10 minutes; a person reading the
   consent page took about 15. It now lives **30 minutes**, and the consent check returns `expires_at` so the page can show a countdown.
   If it still happens: close the page, go back to the assistant, remove the connector and add it again (or press Connect again) to get a fresh request.
4. **One request id decides once.** Opening an old consent link after pressing Allow or Deny gives the same expired message; that is correct.
5. **The password rule.** A real password in a repo file is a leak even if it is never committed: an editor or a tool can show it to whoever reads
   the repo. The login file lives in `D:\Ryagram-scratch\secrets-staging`, outside every repo.
6. **Test on the real thing before a person does.** `tools/connect_e2e.mjs` runs the real MCP client against the deployed function; it found the
   issuer problem and the double-encoded story before Claude did.
7. **A full render is never started from a connection.** The tool exists so an assistant can be told why; it is refused every time whatever
   it sends, and the consent page says "it cannot spend your credits" because that is true.
