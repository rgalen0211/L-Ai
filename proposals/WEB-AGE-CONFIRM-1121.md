# Age confirmation (18 or over), WEB 11-21

Ryan 11:30: a stranger confirms they are 18 or over before they can sign up.

## What the site does now (site only)

A required tick box, "I am 18 or older." (DRAFT FOR RYAN wording), on the Create an account form and on the invite-code form (the two ways a stranger makes an account). Unticked: the error line says "Tick the box to say you are 18 or older.", focus goes to the box, and no request is sent (the page checks before the call, and `ryagramWaiting.signUp` refuses again if it is not given `true`). The row is a 44 px tap target and works by keyboard.

## What it does NOT do

The confirmation is NOT stored. The terms are not stored either: nothing in the join function, the invite redemption or the tables records a terms acceptance (the page only shows a notice that the Terms and Privacy Policy are drafts). `join` reads `body.email` alone and drops any other field; `redeem-invite` takes `code` and `email`. The site words never say the tick is recorded.

## What CONNECT / GEO would need (no number, not built)

`supabase/functions/join/join.ts` (and `redeem-invite`): accept `over18` (the boolean `true`; reject the request with 400 "Confirm you are 18 or older." when it is not exactly `true`, so the block holds even if the page is bypassed), and pass it to the reserve/invite step. Store it with the account: a migration adding `over18_confirmed_at timestamptz` (set to `now()` when the account row or the waiting row is created) on the table the join reserve writes (the waiting/accounts row), and put `over18: true` into the invited user's `user_metadata` in the `invite` call so it survives to the confirmed account. Then `app-data.js` `joinWaiting` sends `{ email, over18: true }` and the redeem call adds `over18: true`; the page words can then say it is kept. Until then the page-only block is all there is.
