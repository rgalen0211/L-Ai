# Compilations for every user: the server half

BUILDER, 2026-11-27. Branch `builder-compilations-server-1127`, on top of `builder-dept-switches-1127`. Nothing is live.

## What a person gets

With the `compilations` switch on for their account, a person can:

- save a "find every time X says Y" request from the site (WEB's page), or have their AI save it (CONNECT's tool);
- sign in their own computer, as testers already can;
- see their computer's progress on the site: planning, matching, building, then done or failed, with counts only.

The film is made on the person's own computer and stays there. The site never receives a video, a sound, a path or a transcript. No credits are used.

## What is in the branch

- **Migration `20261127000250_department_switches.sql`** (the switches branch): the top bar shows a department as working for an account whose switch is on. The switch names are `compilations`, `games` and `perfectCity`.
- **Migration `20261127000300_compilations_for_everyone.sql`**:
  - the rule `compilations_on`: the account's `compilations` switch, or the department opened for everyone (step 82a). A worker account is never on.
  - `my_compilation_set(project, request)` and `my_compilation_get(project)` for the site. They refuse anything that holds a file, a path or a link, and allow 60 saves an hour.
  - `compilation_runs` and `node_compilation_report`, for the computer's progress. A run holds counts only. One build runs at a time per account, and at most 30 start a day.
  - `device_decide`: an account with compilations on may approve its own computer. That computer cannot claim any render job.
- **The `node` edge function** gets a new route, `POST /node/compilation-report`.
- **Live steps:**
  - 82, then 81: each is a read-only check that says STOP before and PASS after.
  - 82a: opens a department for everyone; 82d is its undo.
- **Rollbacks:** undo 0300 first, then 0250. The 0250 rollback refuses in words if done in the wrong order.

## Ryan's order

1. Step 82. Paste migration 0250. Step 82 again: PASS.
2. Step 81. Paste migration 0300. Step 81 again: PASS.
3. Redeploy the `node` function from the merged head, so the computer can report progress.
4. Turn the switch on for a TEST account with `admin_account_switch_set` in the app. An administrator account sees no departments at all.
5. Walk it once WEB's page and FACES' maker are in.
6. Later, open it for everyone with 82a. The undo is 82d.

## Proof

- New SQL suites:
  - `test_department_switches.py`: 7 of 7, with 3 planted faults caught;
  - `test_compilations_for_everyone.py`: see the DONE post for the count; 8 planted faults caught on the first version.
- The suites that load every migration are green.
- Node: 2510 pass, 0 fail.
