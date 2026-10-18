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

## Checked by a test
`tests/connect.test.mjs` fails if any file in the repo contains `alter role connect_runner ... password '<anything but the placeholder>'`, or a
`postgresql://` connection string with a password in it.
