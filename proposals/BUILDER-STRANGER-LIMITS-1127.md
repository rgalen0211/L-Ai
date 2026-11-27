# A stranger's limits, walked (BUILDER, Fri 11-27)

Claude's 08:05 order. Every limit was walked on a **local** test database running live main's code (f6312e3c). Nothing live was touched.

Six limits are right. One showed the wrong words. It is fixed on branch `builder-stranger-limits-1127`, and the new words are **FOR RYAN'S YES**.

| Limit | What the stranger sees on the site (exact words) | Credits end right? | Proof |
|---|---|---|---|
| **35 sign-ups a day** (`join_daily_max` 35) | "Sign-up is full for now. Please try again later." | No credits involved. The cap counts addresses, not tries. Someone already counted today still gets in. 24 hours later, a new address gets in. | `test_stranger_limits` 1 |
| **0 credits: a full film by request** | "The full render did not start because you do not have enough credits. Nothing was charged. Buying credits is not open yet." | Yes. The contact sheet and free preview still work. Nothing is held or charged, and no credit row is written. | `test_stranger_limits` 2 |
| **0 credits: the 7th preview of a project** | "This needs 1 credit and you have 0. Buying credits is not open yet." | Yes. Nothing is written. | `test_stranger_limits` 2 |
| **Free previews: 6 a project, 15 in any 24 hours** | Before a paid one, the page asks: "Your free previews are used up for now, so this one costs 1 credit. Go ahead?" When the limit is hit: "Your free previews are used up: each project gets 6, and 15 across all projects in any 24 hours. Start a new project if this one used its 6, or try again later." | Yes. Two projects of 6 plus 3 more makes 15 free. The next 3 cost 1 credit each, from what the account has. | `test_stranger_limits` 3 |
| **20 credits a day: a full film by request** | "The full render did not start because you reached today’s credit limit. Nothing was charged. You can request it again after 24 hours." | Yes. Only the first film's credits are held, and nothing else is charged. Tested with the cap at 10; it is the same rule as 20 with two films and a few previews. | `test_stranger_limits` 4a |
| **20 credits a day: a paid preview** | **Was (wrong):** "Something went wrong. Please try again, or ask us to help." **Now, on the branch:** "This did not start because you reached today’s credit limit. Nothing was charged. You can try again after 24 hours." | Yes. The refusal rolls the job and its hold back, so nothing is charged. | `test_stranger_limits` 4b, `stranger-limits-1127.test.mjs` |
| **A full film Ryan declines** | "The full render was not approved, so nothing was rendered and your credits were returned." | Yes. Every credit comes back, and nothing stays held. | `test_stranger_limits` 5a |
| **A full film never decided after 7 days** | "The full render was not approved in time, so it was cancelled and your credits were returned." | Yes. The hourly tick (`render_orders_tick`) expires it after 7 days, not before. Every credit comes back. | `test_stranger_limits` 5b |

## The one fix

The server refuses that preview with "daily_cap: you have reached today's credit limit. Try again tomorrow."

The page hides anything that looks like code. It read `daily_cap` as code, so it showed the generic error.

The page now says the cap in the order line's approved words. They say "after 24 hours", because the cap is any 24 hours, not a calendar day. The server's own "Try again tomorrow" is not changed, and the page replaces it.

## Tests

- `supabase/tests/test_stranger_limits.py`: 7 tests, every server answer asserted exactly, on a local Postgres.
- `tests/stranger-limits-1127.test.mjs`: 4 tests. It turns those answers into the page's words with the page's own functions. A planted check shows live main's code gives the generic error.
- Node: 2506 pass, 0 fail.
